import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getShippedPairsSince } from '../edi/dynamics-client.js';

export interface ForecastCloserStats {
  candidates_checked: number;
  closed:             number;
}

interface CandidateRow {
  codice_articolo: string;
  commessa:        string;
  descrizione:     string | null;
}

/**
 * Chiude i Forecast EDI (edi_ferrari_delins) che risultano già spediti in BC
 * anche se non sono mai diventati un ordine Confermato — restano altrimenti
 * per sempre nel foglio come Forecast "fantasma". Una coppia (codice,
 * commessa) si chiude solo se:
 *   1. non compete con un ordine Confermato ancora aperto (present_now = TRUE)
 *   2. risulta già spedita nella query BC "EOS CWS Shipment Line" (la stessa
 *      usata dal modulo WebDDT per generare i DESADV a Ferrari)
 * Il risultato va in prod_forecast_chiuso (vedi commento sulla tabella in
 * migrate-programma-produzione.sql) — non tocca edi_ferrari_delins, che viene
 * ricreato da zero ad ogni sync EDI.
 */
export async function closeShippedForecasts(): Promise<ForecastCloserStats> {
  const [{ id: logId }] = await db`
    INSERT INTO prod_sync_log (sync_type, status) VALUES ('forecast_chiusi', 'running') RETURNING id
  `;

  try {
    const candidates = await db<CandidateRow[]>`
      SELECT DISTINCT ON (d.codice_articolo, d.commessa)
        d.codice_articolo, d.commessa, d.descrizione
      FROM edi_ferrari_delins d
      WHERE (d.tipo_documento = 'Forecast' OR d.tipo_schedulazione = 'Forecast')
        AND d.codice_articolo <> ''
        AND d.commessa <> ''
        AND NOT EXISTS (
          SELECT 1 FROM prod_order po
          WHERE po.present_now     = TRUE
            AND po.commessa        = d.commessa
            AND po.codice_articolo = d.codice_articolo
        )
        AND NOT EXISTS (
          SELECT 1 FROM prod_forecast_chiuso fc
          WHERE fc.codice_articolo = d.codice_articolo AND fc.commessa = d.commessa
        )
    `;

    if (candidates.length === 0) {
      await db`
        UPDATE prod_sync_log SET finished_at = now(), status = 'done', rows_upserted = 0 WHERE id = ${logId}
      `;
      return { candidates_checked: 0, closed: 0 };
    }

    const shipped    = await getShippedPairsSince();
    const shippedSet = new Set(shipped.map(s => `${s.article_code} ${s.lsa_task_no}`));

    const toClose = candidates.filter(c => shippedSet.has(`${c.codice_articolo} ${c.commessa}`));

    if (toClose.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < toClose.length; i += BATCH) {
        await db`
          INSERT INTO prod_forecast_chiuso ${db(toClose.slice(i, i + BATCH))}
          ON CONFLICT (codice_articolo, commessa) DO NOTHING
        `;
      }
    }

    const stats: ForecastCloserStats = { candidates_checked: candidates.length, closed: toClose.length };

    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'done', rows_upserted = ${stats.closed}
      WHERE id = ${logId}
    `;

    return stats;
  } catch (err) {
    logger.error({ err }, 'programma-produzione: chiusura forecast spediti fallita');
    await db`
      UPDATE prod_sync_log
      SET finished_at = now(), status = 'error', error_message = ${(err as Error).message}
      WHERE id = ${logId}
    `.catch(() => {});
    throw err;
  }
}
