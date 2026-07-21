import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { syncProductionOrders, syncItemAttributes } from './order-sync.js';
import { runKeywordEngine, runColorEngine } from './keyword-engine.js';
import { buildFoglio } from './sheet.js';
import { validateSpmaFile } from '../../lib/mime-check.js';
import {
  importAree, importAreaArticoli, importKeywordRules,
  importColorKeywords, importItemAttributeLabels, importArticleInfo,
} from './config-import.js';

export const programmaProduzioneRoutes = new Hono();

const MODULE = 'programma_produzione' as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'ID non valido' });
  }
  return id;
}

async function readUploadedFile(c: Context): Promise<Buffer> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'Richiesta multipart non valida' });
  }
  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'File mancante (campo "file")' });
  const buffer = Buffer.from(await file.arrayBuffer());
  validateSpmaFile(buffer, file.name);
  return buffer;
}

// ─── Aree di montaggio ────────────────────────────────────────────────────────

programmaProduzioneRoutes.get('/aree', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, code, description FROM prod_area_montaggio ORDER BY description`;
  return c.json(rows);
});

programmaProduzioneRoutes.post('/aree', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    code:        z.string().min(1).max(50),
    description: z.string().min(1).max(255),
  }));
  const [row] = await db`
    INSERT INTO prod_area_montaggio (code, description) VALUES (${body.code}, ${body.description})
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
    RETURNING id, code, description
  `;
  return c.json(row, 201);
});

programmaProduzioneRoutes.delete('/aree/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM prod_area_montaggio WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

programmaProduzioneRoutes.get('/aree/:id/articoli', requireModule(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const rows = await db`
    SELECT id, article_code FROM prod_area_article WHERE area_id = ${id} ORDER BY article_code
  `;
  return c.json(rows);
});

programmaProduzioneRoutes.put('/aree/:id/articoli', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({ articleCodes: z.array(z.string().min(1)) }));
  const codes = [...new Set(body.articleCodes.map(s => s.trim()).filter(Boolean))];

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    await tx`DELETE FROM prod_area_article WHERE area_id = ${id}`;
    if (codes.length > 0) {
      const values = codes.map(article_code => ({ area_id: id, article_code }));
      await tx`INSERT INTO prod_area_article ${tx(values)}`;
    }
  });

  return c.json({ status: 'updated', count: codes.length });
});

programmaProduzioneRoutes.post('/aree/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importAree(buffer));
});

programmaProduzioneRoutes.post('/aree/:id/articoli/import-excel', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const buffer = await readUploadedFile(c);
  return c.json(await importAreaArticoli(id, buffer));
});

// ─── Foglio di lavoro (vista finale per l'operatore) ──────────────────────────

// Vista globale: TUTTI gli ordini con data di ingresso in linea registrata,
// senza bisogno di nessuna area di montaggio configurata.
programmaProduzioneRoutes.get('/foglio', requireModule(MODULE), async (c) => {
  const rows = await buildFoglio(null);
  return c.json({ area: null, rows });
});

programmaProduzioneRoutes.get('/aree/:id/foglio', requireModule(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));

  const area = await db`SELECT id, code, description FROM prod_area_montaggio WHERE id = ${id}`;
  if (area.length === 0) throw new HTTPException(404, { message: 'Area non trovata' });

  const assigned = await db<{ article_code: string }[]>`
    SELECT article_code FROM prod_area_article WHERE area_id = ${id}
  `;
  const rows = await buildFoglio(assigned.map(a => a.article_code));
  return c.json({ area: area[0], rows });
});

// ─── Regole parole chiave (caratteristiche) ───────────────────────────────────

const KeywordRuleSchema = z.discriminatedUnion('modo', [
  z.object({
    modo:                    z.literal('simple'),
    prefissoCommessa:        z.string().min(1).max(10),
    categoria:               z.string().min(1).max(100),
    caratteristicaDerivata:  z.string().min(1).max(150),
    parolaChiave:            z.string().min(1).max(150),
    note:                    z.string().optional(),
  }),
  z.object({
    modo:                    z.literal('proximity'),
    prefissoCommessa:        z.string().min(1).max(10),
    categoria:               z.string().min(1).max(100),
    caratteristicaDerivata:  z.string().min(1).max(150),
    parolaAncora:            z.string().min(1).max(150),
    parolaObiettivo:         z.string().min(1).max(150),
    distanzaMaxCaratteri:    z.number().int().positive(),
    note:                    z.string().optional(),
  }),
]);

programmaProduzioneRoutes.get('/keyword-rules', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT id, prefisso_commessa, categoria, caratteristica_derivata, modo,
           parola_chiave, parola_ancora, parola_obiettivo, distanza_max_caratteri,
           note, active
    FROM prod_keyword_rules
    ORDER BY prefisso_commessa, categoria
  `;
  return c.json(rows);
});

programmaProduzioneRoutes.post('/keyword-rules', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, KeywordRuleSchema);

  const [row] = body.modo === 'simple'
    ? await db`
        INSERT INTO prod_keyword_rules
          (prefisso_commessa, categoria, caratteristica_derivata, modo, parola_chiave, note)
        VALUES
          (${body.prefissoCommessa}, ${body.categoria}, ${body.caratteristicaDerivata}, 'simple', ${body.parolaChiave}, ${body.note ?? null})
        RETURNING *
      `
    : await db`
        INSERT INTO prod_keyword_rules
          (prefisso_commessa, categoria, caratteristica_derivata, modo,
           parola_ancora, parola_obiettivo, distanza_max_caratteri, note)
        VALUES
          (${body.prefissoCommessa}, ${body.categoria}, ${body.caratteristicaDerivata}, 'proximity',
           ${body.parolaAncora}, ${body.parolaObiettivo}, ${body.distanzaMaxCaratteri}, ${body.note ?? null})
        RETURNING *
      `;

  return c.json(row, 201);
});

programmaProduzioneRoutes.put('/keyword-rules/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, KeywordRuleSchema);

  const [row] = body.modo === 'simple'
    ? await db`
        UPDATE prod_keyword_rules SET
          prefisso_commessa       = ${body.prefissoCommessa},
          categoria                = ${body.categoria},
          caratteristica_derivata  = ${body.caratteristicaDerivata},
          modo                     = 'simple',
          parola_chiave            = ${body.parolaChiave},
          parola_ancora            = NULL,
          parola_obiettivo         = NULL,
          distanza_max_caratteri   = NULL,
          note                     = ${body.note ?? null}
        WHERE id = ${id}
        RETURNING *
      `
    : await db`
        UPDATE prod_keyword_rules SET
          prefisso_commessa       = ${body.prefissoCommessa},
          categoria                = ${body.categoria},
          caratteristica_derivata  = ${body.caratteristicaDerivata},
          modo                     = 'proximity',
          parola_chiave            = NULL,
          parola_ancora            = ${body.parolaAncora},
          parola_obiettivo         = ${body.parolaObiettivo},
          distanza_max_caratteri   = ${body.distanzaMaxCaratteri},
          note                     = ${body.note ?? null}
        WHERE id = ${id}
        RETURNING *
      `;

  if (!row) throw new HTTPException(404, { message: 'Regola non trovata' });
  return c.json(row);
});

programmaProduzioneRoutes.put('/keyword-rules/:id/active', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({ active: z.boolean() }));
  const [row] = await db`
    UPDATE prod_keyword_rules SET active = ${body.active} WHERE id = ${id} RETURNING id, active
  `;
  if (!row) throw new HTTPException(404, { message: 'Regola non trovata' });
  return c.json(row);
});

programmaProduzioneRoutes.delete('/keyword-rules/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM prod_keyword_rules WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

programmaProduzioneRoutes.post('/keyword-rules/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importKeywordRules(buffer));
});

// ─── Parole chiave colore ──────────────────────────────────────────────────────

programmaProduzioneRoutes.get('/color-keywords', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, keyword, color, active FROM prod_color_keywords ORDER BY keyword`;
  return c.json(rows);
});

programmaProduzioneRoutes.post('/color-keywords', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({ keyword: z.string().min(1).max(100), color: z.string().min(1).max(100) }));
  const [row] = await db`
    INSERT INTO prod_color_keywords (keyword, color) VALUES (${body.keyword}, ${body.color})
    RETURNING id, keyword, color, active
  `;
  return c.json(row, 201);
});

programmaProduzioneRoutes.put('/color-keywords/:id/active', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({ active: z.boolean() }));
  const [row] = await db`
    UPDATE prod_color_keywords SET active = ${body.active} WHERE id = ${id} RETURNING id, active
  `;
  if (!row) throw new HTTPException(404, { message: 'Parola chiave non trovata' });
  return c.json(row);
});

programmaProduzioneRoutes.delete('/color-keywords/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM prod_color_keywords WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

programmaProduzioneRoutes.post('/color-keywords/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importColorKeywords(buffer));
});

// ─── Nomi categoria per attributi BC ───────────────────────────────────────────

programmaProduzioneRoutes.get('/item-attribute-labels', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT item_attribute_id, categoria_label, active, updated_at
    FROM prod_item_attribute_label
    ORDER BY item_attribute_id
  `;
  return c.json(rows);
});

programmaProduzioneRoutes.put('/item-attribute-labels/:itemAttributeId', requireManage(MODULE), async (c) => {
  const itemAttributeId = parseId(c.req.param('itemAttributeId'));
  const body = await parseBody(c, z.object({
    categoriaLabel: z.string().min(1).max(150),
    active:         z.boolean().optional(),
  }));
  const active = body.active ?? true;
  const [row] = await db`
    INSERT INTO prod_item_attribute_label (item_attribute_id, categoria_label, active, updated_at)
    VALUES (${itemAttributeId}, ${body.categoriaLabel}, ${active}, now())
    ON CONFLICT (item_attribute_id) DO UPDATE SET
      categoria_label = EXCLUDED.categoria_label,
      active          = EXCLUDED.active,
      updated_at      = now()
    RETURNING *
  `;
  return c.json(row);
});

programmaProduzioneRoutes.post('/item-attribute-labels/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importItemAttributeLabels(buffer));
});

// ─── Caratteristiche manuali per articolo ──────────────────────────────────────

programmaProduzioneRoutes.get('/article-info', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT id, codice_articolo, modello, categoria, caratteristiche_manuali
    FROM prod_article_info
    ORDER BY codice_articolo
  `;
  return c.json(rows);
});

programmaProduzioneRoutes.post('/article-info', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    codiceArticolo:          z.string().min(1).max(100),
    modello:                 z.string().optional(),
    categoria:               z.string().min(1).max(200),
    caratteristicheManuali:  z.string().min(1),
  }));
  const [row] = await db`
    INSERT INTO prod_article_info (codice_articolo, modello, categoria, caratteristiche_manuali)
    VALUES (${body.codiceArticolo}, ${body.modello ?? null}, ${body.categoria}, ${body.caratteristicheManuali})
    RETURNING *
  `;
  return c.json(row, 201);
});

programmaProduzioneRoutes.delete('/article-info/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM prod_article_info WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

programmaProduzioneRoutes.post('/article-info/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importArticleInfo(buffer));
});

// ─── Sincronizzazione ──────────────────────────────────────────────────────────

programmaProduzioneRoutes.post('/sync/orders', requireManage(MODULE), async (c) => {
  try {
    const stats = await syncProductionOrders();
    return c.json(stats);
  } catch (err) {
    logger.error({ err }, 'programma-produzione: sync ordini BC fallito');
    throw new HTTPException(503, { message: `Business Central non disponibile: ${(err as Error).message}` });
  }
});

programmaProduzioneRoutes.post('/sync/item-attributes', requireManage(MODULE), async (c) => {
  try {
    const stats = await syncItemAttributes();
    return c.json(stats);
  } catch (err) {
    logger.error({ err }, 'programma-produzione: sync attributi BC fallito');
    throw new HTTPException(503, { message: `Business Central non disponibile: ${(err as Error).message}` });
  }
});

programmaProduzioneRoutes.post('/sync/keywords', requireManage(MODULE), async (c) => {
  const stats = await runKeywordEngine();
  return c.json(stats);
});

programmaProduzioneRoutes.post('/sync/colors', requireManage(MODULE), async (c) => {
  const stats = await runColorEngine();
  return c.json(stats);
});

// Scorciatoia: esegue tutta la catena in sequenza (come i 3 pulsanti del
// vecchio syncorders.jsx, ma in un solo giro).
programmaProduzioneRoutes.post('/sync/all', requireManage(MODULE), async (c) => {
  const orders = await syncProductionOrders().catch(err => {
    logger.error({ err }, 'programma-produzione: sync/all — ordini BC falliti');
    return { error: (err as Error).message };
  });
  const itemAttributes = await syncItemAttributes().catch(err => {
    logger.error({ err }, 'programma-produzione: sync/all — attributi BC falliti');
    return { error: (err as Error).message };
  });
  const keywords = await runKeywordEngine();
  const colors   = await runColorEngine();

  return c.json({ orders, itemAttributes, keywords, colors });
});

programmaProduzioneRoutes.get('/sync/log', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT id, sync_type, started_at, finished_at, rows_upserted, rows_marked_absent, status, error_message
    FROM prod_sync_log
    ORDER BY started_at DESC
    LIMIT 50
  `;
  return c.json(rows);
});
