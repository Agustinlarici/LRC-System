import { createHash } from 'node:crypto';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getProductionSalesOrders, getItemAttributesForArticles } from './dynamics-client.js';

// ─── Sync ordini Business Central → prod_order (incrementale via row_sig) ─────

function rowSig(fields: (string | null)[]): string {
  return createHash('md5').update(fields.map(f => f ?? '').join('|')).digest('hex');
}

export interface OrderSyncStats {
  rows_seen:          number;
  rows_upserted:      number;
  rows_marked_absent: number;
}

export async function syncProductionOrders(): Promise<OrderSyncStats> {
  const [{ id: logId }] = await db`
    INSERT INTO prod_sync_log (sync_type, status) VALUES ('bc_orders', 'running') RETURNING id
  `;

  try {
    const lines = await getProductionSalesOrders();

    const now = new Date();
    const byRowSig = new Map<string, ReturnType<typeof buildRow>>();
    function buildRow(l: (typeof lines)[number]) {
      return {
        codice_articolo:       l.codice_articolo,
        commessa:               l.commessa,
        description:            l.description,
        description_extension:  l.description_extension,
        ubicazione:             l.ubicazione,
        planned_shipment_date:  l.planned_shipment_date,
        shipment_date:          l.shipment_date,
        fa_posting_date:        l.fa_posting_date,
        present_now:            true,
        last_seen_at:           now,
        row_sig: rowSig([
          l.codice_articolo, l.commessa, l.description, l.description_extension,
          l.ubicazione, l.planned_shipment_date, l.shipment_date, l.fa_posting_date,
        ]),
      };
    }
    // BC puede devolver varias righe indistinguibili con nuestros campos
    // (mismo articolo+commessa+descripción+fechas) → mismo row_sig. Se
    // deduplica ANTES de insertar: un solo INSERT no puede tocar la misma
    // fila en conflicto dos veces ("ON CONFLICT DO UPDATE... second time").
    for (const l of lines) {
      const row = buildRow(l);
      byRowSig.set(row.row_sig, row);
    }
    const values = [...byRowSig.values()];

    let upserted = 0;
    const seenSigs: string[] = [];
    const BATCH = 500;

    for (let i = 0; i < values.length; i += BATCH) {
      const chunk = values.slice(i, i + BATCH);
      const rows = await db`
        INSERT INTO prod_order ${db(chunk)}
        ON CONFLICT (row_sig) DO UPDATE SET
          present_now   = TRUE,
          last_seen_at  = EXCLUDED.last_seen_at,
          updated_at    = now()
        RETURNING row_sig
      `;
      upserted += rows.length;
      seenSigs.push(...rows.map(r => r.row_sig as string));
    }

    // Righe non più presenti in questo giro → present_now = FALSE (non si cancella nulla)
    const absentResult = seenSigs.length > 0
      ? await db`
          UPDATE prod_order
          SET present_now = FALSE, updated_at = now()
          WHERE present_now = TRUE AND row_sig <> ALL(${seenSigs})
        `
      : await db`UPDATE prod_order SET present_now = FALSE, updated_at = now() WHERE present_now = TRUE`;

    const stats: OrderSyncStats = {
      rows_seen:          lines.length,
      rows_upserted:      upserted,
      rows_marked_absent: absentResult.count ?? 0,
    };

    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'done',
          rows_upserted = ${stats.rows_upserted}, rows_marked_absent = ${stats.rows_marked_absent}
      WHERE id = ${logId}
    `;

    return stats;
  } catch (err) {
    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'error', error_message = ${(err as Error).message}
      WHERE id = ${logId}
    `.catch(() => {});
    throw err;
  }
}

// ─── Sync attributi BC → prod_item_attribute ──────────────────────────────────
// Full refresh per gli articoli attualmente presenti in prod_order+forecast:
// più semplice e robusto di un merge incrementale, e il volume per articolo
// è piccolo (poche decine di attributi ciascuno).

export async function syncItemAttributes(): Promise<{ rows: number; articles: number }> {
  const [{ id: logId }] = await db`
    INSERT INTO prod_sync_log (sync_type, status) VALUES ('item_attributes', 'running') RETURNING id
  `;

  try {
    const articles = await db<{ codice_articolo: string }[]>`
      SELECT DISTINCT codice_articolo FROM prod_order WHERE present_now = TRUE
      UNION
      SELECT DISTINCT codice_articolo FROM edi_ferrari_delins
      WHERE (tipo_documento = 'Forecast' OR tipo_schedulazione = 'Forecast') AND codice_articolo <> ''
    `;
    const codes = articles.map(a => a.codice_articolo);
    if (codes.length === 0) {
      await db`
        UPDATE prod_sync_log SET finished_at = now(), status = 'done', rows_upserted = 0
        WHERE id = ${logId}
      `;
      return { rows: 0, articles: 0 };
    }

    const attributes = await getItemAttributesForArticles(codes);

    await db.begin(async (txRaw) => {
      const tx = txRaw as unknown as typeof db;
      // Rimuove solo gli attributi degli articoli appena letti (non tocca gli altri)
      await tx`DELETE FROM prod_item_attribute WHERE codice_articolo = ANY(${codes})`;
      if (attributes.length > 0) {
        const BATCH = 500;
        const values = attributes.map(a => ({
          codice_articolo:          a.codice_articolo,
          item_attribute_id:        a.item_attribute_id,
          item_attribute_value_id:  a.item_attribute_value_id,
          value:                    a.value,
        }));
        for (let i = 0; i < values.length; i += BATCH) {
          await tx`INSERT INTO prod_item_attribute ${tx(values.slice(i, i + BATCH))}`;
        }
      }
    });

    // Assicura un nome (anche solo di default) per ogni Item Attribute ID nuovo,
    // cosi' l'admin lo trova gia' in lista pronto per essere rinominato.
    const distinctIds = [...new Set(attributes.map(a => a.item_attribute_id))];
    if (distinctIds.length > 0) {
      await db`
        INSERT INTO prod_item_attribute_label (item_attribute_id, categoria_label)
        SELECT id, 'Attributo #' || id
        FROM UNNEST(${distinctIds}::int[]) AS id
        ON CONFLICT (item_attribute_id) DO NOTHING
      `;
    }

    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'done', rows_upserted = ${attributes.length}
      WHERE id = ${logId}
    `;

    return { rows: attributes.length, articles: codes.length };
  } catch (err) {
    logger.error({ err }, 'programma-produzione: item attribute sync failed');
    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'error', error_message = ${(err as Error).message}
      WHERE id = ${logId}
    `.catch(() => {});
    throw err;
  }
}
