import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { syncProductionOrders, syncItemAttributes } from './order-sync.js';
import { runKeywordEngine, runColorEngine } from './keyword-engine.js';
import { buildFoglio, findComponentConflicts } from './sheet.js';
import { validateSpmaFile } from '../../lib/mime-check.js';
import {
  importAree, importKeywordRules,
  importColorKeywords, importItemAttributeLabels, importArticleInfo,
  importArticleCategoryArea,
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

function requireParam(raw: string | undefined, label: string): string {
  if (!raw || !raw.trim()) throw new HTTPException(400, { message: `${label} mancante` });
  return raw;
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

programmaProduzioneRoutes.post('/aree/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importAree(buffer));
});

// L'area si assegna direttamente per codice articolo (prod_article_component_category.area_id)
// — usato internamente da /aree/:id/foglio.
async function articleCodesForArea(areaId: number): Promise<string[]> {
  const rows = await db<{ codice_articolo: string }[]>`
    SELECT codice_articolo FROM prod_article_component_category WHERE area_id = ${areaId}
  `;
  return rows.map(r => r.codice_articolo);
}

// ─── Foglio di lavoro (vista finale per l'operatore) ──────────────────────────

const DEFAULT_FOGLIO_LIMIT = 500;

function parsePageParams(c: Context): { limit: number; offset: number } {
  const limitRaw  = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const limit  = limitRaw  != null ? Math.max(1, Math.min(2000, parseInt(limitRaw, 10) || DEFAULT_FOGLIO_LIMIT)) : DEFAULT_FOGLIO_LIMIT;
  const offset = offsetRaw != null ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;
  return { limit, offset };
}

// Vista globale: TUTTI gli ordini con data di ingresso in linea registrata,
// senza bisogno di nessuna area di montaggio configurata. Paginata — senza
// filtro articolo si arriva facilmente a 20k+ righe, troppe per il browser.
programmaProduzioneRoutes.get('/foglio', requireModule(MODULE), async (c) => {
  const { limit, offset } = parsePageParams(c);
  const { rows, total } = await buildFoglio(null, { limit, offset });
  return c.json({ area: null, rows, total, limit, offset });
});

programmaProduzioneRoutes.get('/aree/:id/foglio', requireModule(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const { limit, offset } = parsePageParams(c);

  const area = await db`SELECT id, code, description FROM prod_area_montaggio WHERE id = ${id}`;
  if (area.length === 0) throw new HTTPException(404, { message: 'Area non trovata' });

  const codes = await articleCodesForArea(id);
  const { rows, total } = await buildFoglio(codes, { limit, offset });
  return c.json({ area: area[0], rows, total, limit, offset });
});

// ─── Regole parole chiave (caratteristiche) ───────────────────────────────────

// prefissoCommessa vuoto ("") = regola globale, si applica a tutte le commesse
// indipendentemente dal prefisso (vedi runKeywordEngine in keyword-engine.ts).
const KeywordRuleSchema = z.discriminatedUnion('modo', [
  z.object({
    modo:                    z.literal('simple'),
    prefissoCommessa:        z.string().max(10),
    categoria:               z.string().min(1).max(100),
    caratteristicaDerivata:  z.string().min(1).max(150),
    parolaChiave:            z.string().min(1).max(150),
    note:                    z.string().optional(),
  }),
  z.object({
    modo:                    z.literal('proximity'),
    prefissoCommessa:        z.string().max(10),
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
// priority: se più parole chiave trovano match nella stessa descrizione, vince
// quella con priority più bassa (0 = massima priorità).

programmaProduzioneRoutes.get('/color-keywords', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, keyword, color, priority, active FROM prod_color_keywords ORDER BY priority, keyword`;
  return c.json(rows);
});

programmaProduzioneRoutes.post('/color-keywords', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    keyword:  z.string().min(1).max(100),
    color:    z.string().min(1).max(100),
    priority: z.number().int().min(0).max(9999).optional(),
  }));
  const [row] = await db`
    INSERT INTO prod_color_keywords (keyword, color, priority)
    VALUES (${body.keyword}, ${body.color}, ${body.priority ?? 50})
    RETURNING id, keyword, color, priority, active
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

programmaProduzioneRoutes.put('/color-keywords/:id/priority', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({ priority: z.number().int().min(0).max(9999) }));
  const [row] = await db`
    UPDATE prod_color_keywords SET priority = ${body.priority} WHERE id = ${id} RETURNING id, priority
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

// Range di caratteri della descrizione in cui cercare le parole chiave colore
// — un'unica coppia (start, end) globale, uguale per tutte le parole.
programmaProduzioneRoutes.get('/color-settings', requireModule(MODULE), async (c) => {
  const rows = await db<{ key: string; value: string }[]>`
    SELECT key, value FROM system_config WHERE key IN ('prod_color_search_start', 'prod_color_search_end')
  `;
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  return c.json({
    searchStart: parseInt(byKey.get('prod_color_search_start') ?? '0', 10),
    searchEnd:   parseInt(byKey.get('prod_color_search_end')   ?? '60', 10),
  });
});

programmaProduzioneRoutes.put('/color-settings', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    searchStart: z.number().int().min(0).max(9999),
    searchEnd:   z.number().int().min(1).max(9999),
  }));
  if (body.searchEnd <= body.searchStart) {
    throw new HTTPException(400, { message: 'La fine del range deve essere maggiore dell\'inizio' });
  }
  await db`
    INSERT INTO system_config (key, value, updated_at) VALUES
      ('prod_color_search_start', ${String(body.searchStart)}, now()),
      ('prod_color_search_end',   ${String(body.searchEnd)},   now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return c.json(body);
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

// ─── Categoria + Area per articolo (rimpiazzo "vince l'ultimo" + assegnazione) ─
// Una riga per codice: categoria (per il motore di rimpiazzo — se due articoli
// della stessa categoria arrivano per la stessa commessa, buildFoglio ne
// tiene uno solo, Confermato > Forecast poi il più recente; i perdenti
// finiscono in /component-conflicts) e area (dove compare nel foglio),
// completamente indipendenti tra loro.

programmaProduzioneRoutes.get('/article-assignments', requireModule(MODULE), async (c) => {
  const search = (c.req.query('search') ?? '').trim();
  const rows = search
    ? await db`
        SELECT pacc.codice_articolo, pacc.categoria, pacc.area_id,
               a.code AS area_code, a.description AS area_description
        FROM prod_article_component_category pacc
        LEFT JOIN prod_area_montaggio a ON a.id = pacc.area_id
        WHERE pacc.codice_articolo ILIKE ${'%' + search + '%'}
           OR pacc.categoria ILIKE ${'%' + search + '%'}
        ORDER BY pacc.codice_articolo
        LIMIT 500
      `
    : await db`
        SELECT pacc.codice_articolo, pacc.categoria, pacc.area_id,
               a.code AS area_code, a.description AS area_description
        FROM prod_article_component_category pacc
        LEFT JOIN prod_area_montaggio a ON a.id = pacc.area_id
        ORDER BY pacc.codice_articolo
        LIMIT 500
      `;
  return c.json(rows);
});

const ArticleAssignmentSchema = z.object({
  codiceArticolo: z.string().min(1).max(100),
  categoria:      z.string().max(100).nullish(),
  areaId:         z.number().int().positive().nullish(),
});

programmaProduzioneRoutes.post('/article-assignments', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, ArticleAssignmentSchema);
  const [row] = await db`
    INSERT INTO prod_article_component_category (codice_articolo, categoria, area_id)
    VALUES (${body.codiceArticolo}, ${body.categoria ?? null}, ${body.areaId ?? null})
    ON CONFLICT (codice_articolo) DO UPDATE SET
      categoria = EXCLUDED.categoria, area_id = EXCLUDED.area_id
    RETURNING *
  `;
  return c.json(row, 201);
});

programmaProduzioneRoutes.delete('/article-assignments/:codice', requireManage(MODULE), async (c) => {
  const codice = requireParam(c.req.param('codice'), 'Codice');
  await db`DELETE FROM prod_article_component_category WHERE codice_articolo = ${codice}`;
  return c.json({ status: 'deleted' });
});

// Carica veloce: un solo file con Codice Articolo + Categoria + Area (entrambe
// opzionali) — upsert per codice in un colpo solo. Le aree devono già esistere.
programmaProduzioneRoutes.post('/article-category-area/import-excel', requireManage(MODULE), async (c) => {
  const buffer = await readUploadedFile(c);
  return c.json(await importArticleCategoryArea(buffer));
});

// ─── Conflitti da risolvere in Dynamics ────────────────────────────────────────

programmaProduzioneRoutes.get('/component-conflicts', requireModule(MODULE), async (c) => {
  const conflicts = await findComponentConflicts();
  return c.json(conflicts);
});
