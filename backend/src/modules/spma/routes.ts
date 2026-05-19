import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { rebuildSpma } from './plan.js';
import { checkSpmaDelays } from './delay-checker.js';
import { fetchRecentChats, spmaTokenConfigured, sendTestMessage, sendDelayReport } from './spma-notifier.js';
import { logger } from '../../lib/logger.js';

export const spmaRoutes = new Hono();

const MODULE = 'spma' as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string | undefined): number {
  if (!raw) {
    throw new HTTPException(400, { message: 'ID non valido' });
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'ID non valido' });
  }
  return id;
}

function normHeader(s: string): string {
  return String(s)
    .replace(/\u00A0/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normBasic(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickCol(headers: string[], ...candidates: string[]): string | null {
  const normMap = new Map(headers.map(h => [normHeader(h), h]));
  for (const c of candidates) {
    const key = normHeader(c);
    if (normMap.has(key)) return normMap.get(key)!;
  }
  // contains fallback
  for (const c of candidates) {
    const key = normHeader(c);
    if (!key) continue;
    for (const [norm, orig] of normMap) {
      if (norm.includes(key)) return orig;
    }
  }
  return null;
}

function normalizeCommessa(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'number') {
    if (!isFinite(val)) return null;
    return String(Math.round(val));
  }
  const s = String(val).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(-?\d+)\.0+$/);
  if (m) return m[1];
  return s;
}

function combineDateTime(dateVal: unknown, timeVal: unknown): Date | null {
  if (dateVal == null) return null;
  let date: Date;
  if (dateVal instanceof Date) {
    date = dateVal;
  } else {
    date = new Date(String(dateVal));
    if (isNaN(date.getTime())) return null;
  }

  if (timeVal == null) return date;

  let h = 0, m = 0, s = 0;
  if (timeVal instanceof Date) {
    // xlsx with cellDates:true puts time-only as 1899-12-30 base
    h = timeVal.getHours(); m = timeVal.getMinutes(); s = timeVal.getSeconds();
  } else {
    const match = String(timeVal).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) { h = +match[1]; m = +match[2]; s = match[3] ? +match[3] : 0; }
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, s);
}

async function findOrCreateLine(name: string): Promise<number> {
  const trimmed = name.trim();
  const existing = await db`SELECT id FROM spma_line WHERE LOWER(name) = LOWER(${trimmed}) LIMIT 1`;
  if (existing.length > 0) return Number(existing[0].id);
  const [row] = await db`INSERT INTO spma_line (name) VALUES (${trimmed}) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`;
  return Number(row.id);
}

async function bestAliasMatch(sheetName: string): Promise<number | null> {
  const norm = normBasic(sheetName);
  if (!norm) return null;
  const aliases = await db`SELECT alias_norm, line_id FROM spma_line_alias WHERE active = TRUE`;
  let best: { lineId: number; len: number } | null = null;
  for (const a of aliases) {
    const an = String(a.alias_norm);
    if (an && norm.includes(an)) {
      if (!best || an.length > best.len) best = { lineId: Number(a.line_id), len: an.length };
    }
  }
  return best ? best.lineId : null;
}

// ─── Catalogs ─────────────────────────────────────────────────────────────────

spmaRoutes.get('/lines', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, name FROM spma_line ORDER BY name`;
  return c.json(rows);
});

spmaRoutes.post('/lines', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({ name: z.string().min(1) }));
  const [row] = await db`
    INSERT INTO spma_line (name) VALUES (${body.name})
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;
  return c.json(row, 201);
});

spmaRoutes.delete('/lines/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_line WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

spmaRoutes.get('/categories', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, name, sort_order FROM spma_component_category ORDER BY sort_order, name`;
  return c.json(rows);
});

spmaRoutes.post('/categories', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    name: z.string().min(1),
    sortOrder: z.preprocess((input) => {
      if (input == null || input === '') return 0;
      if (typeof input === 'string') {
        const n = Number(input);
        return Number.isNaN(n) ? input : n;
      }
      return input;
    }, z.number().int().min(0).default(0)),
  }));
  const sortOrder = Number(body.sortOrder ?? 0);
  const [row] = await db`
    INSERT INTO spma_component_category (name, sort_order) VALUES (${body.name}, ${sortOrder})
    ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id, name, sort_order
  `;
  return c.json(row, 201);
});

spmaRoutes.delete('/categories/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_component_category WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Model Requirements ───────────────────────────────────────────────────────

spmaRoutes.get('/model-requirements', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT r.id, r.model_code, r.component_category_id, c.name AS category_name, r.producer_name
    FROM spma_model_component_req r
    JOIN spma_component_category c ON c.id = r.component_category_id
    ORDER BY r.model_code, c.name
  `;
  return c.json(rows);
});

spmaRoutes.post('/model-requirements', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    modelCode:           z.string().min(1),
    componentCategoryId: z.number().int().positive(),
    producerName:        z.string().optional(),
  }));
  const [row] = await db`
    INSERT INTO spma_model_component_req (model_code, component_category_id, producer_name)
    VALUES (${body.modelCode}, ${body.componentCategoryId}, ${body.producerName ?? null})
    ON CONFLICT (model_code, component_category_id) DO UPDATE SET producer_name = EXCLUDED.producer_name
    RETURNING id, model_code, component_category_id, producer_name
  `;
  return c.json(row, 201);
});

spmaRoutes.delete('/model-requirements/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_model_component_req WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Station Configuration ────────────────────────────────────────────────────

spmaRoutes.get('/stations', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT s.id, s.line_id, l.name AS line_name,
           s.component_category_id, c.name AS category_name, s.station_index
    FROM spma_line_component_station s
    JOIN spma_line l ON l.id = s.line_id
    JOIN spma_component_category c ON c.id = s.component_category_id
    ORDER BY l.name, c.name
  `;
  return c.json(rows);
});

spmaRoutes.post('/stations', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    lineId:               z.number().int().positive(),
    componentCategoryId:  z.number().int().positive(),
    stationIndex:         z.number().int().min(1),
  }));
  const [row] = await db`
    INSERT INTO spma_line_component_station (line_id, component_category_id, station_index)
    VALUES (${body.lineId}, ${body.componentCategoryId}, ${body.stationIndex})
    ON CONFLICT (line_id, component_category_id) DO UPDATE SET station_index = EXCLUDED.station_index
    RETURNING id, line_id, component_category_id, station_index
  `;
  return c.json(row, 201);
});

spmaRoutes.delete('/stations/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_line_component_station WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Excel Import ─────────────────────────────────────────────────────────────

spmaRoutes.post('/import', requireManage(MODULE), async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'Richiesta multipart non valida' });
  }

  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'File mancante (campo "file")' });

  const buffer = Buffer.from(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new HTTPException(400, { message: 'File non leggibile (non è un Excel/CSV valido)' });
  }

  const sheets = workbook.SheetNames;
  let totalRows = 0, upserted = 0, skipped = 0;
  const warnings: string[] = [];
  const importedCodes      = new Set<string>();
  const calendarDatesToFill = new Map<string, { lineId: number; dateStr: string }>();

  for (const sheetName of sheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: false,
      defval: null,
      cellDates: true,
    } as XLSX.Sheet2JSONOpts);

    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0] ?? {});
    const colFecha = pickCol(headers, 'Data Ingresso Linea', 'Data Ingresso', 'Data');
    const colOra   = pickCol(headers, 'Ora Ingresso Linea',  'Ora Ingresso',  'Ora');
    const colComm  = pickCol(headers, 'Commessa/Ordine', 'Commessa', 'Ordine');
    const colModel = pickCol(headers, 'Modello', 'Model', 'Tipo Vettura', 'Modello/Tipo');
    const colLine  = pickCol(headers, 'Linea di Montaggio', 'Linea', 'Line');
    const colPos   = headers.find(h => normHeader(h) === 'posizione') ?? null;
    const colStato = pickCol(headers, 'Stato', 'Status');

    if (!colFecha || !colComm) {
      warnings.push(`Foglio "${sheetName}": colonne minime mancanti (Commessa, Data). Saltato.`);
      continue;
    }

    // Resolve line for this sheet
    const sheetLineId = await bestAliasMatch(sheetName);

    for (let i = 0; i < rows.length; i++) {
      totalRows++;
      const row = rows[i];

      try {
        // Filter by Stato if present
        if (colStato && row[colStato] != null) {
          const stato = String(row[colStato]).trim().toLowerCase();
          if (!['avviato', 'in sequenza'].includes(stato)) { skipped++; continue; }
        }

        // Commessa
        const commCode = normalizeCommessa(row[colComm!]);
        if (!commCode) { skipped++; continue; }

        // Date + time
        const dt = combineDateTime(
          row[colFecha!],
          colOra ? row[colOra] : null,
        );
        if (!dt) {
          warnings.push(`Foglio "${sheetName}", riga ${i + 2}: data/ora non valida.`);
          skipped++; continue;
        }

        // Model
        const modelCode = (colModel && row[colModel] != null)
          ? String(row[colModel]).trim() || '-'
          : '-';

        // Line
        let lineId: number;
        if (colLine && row[colLine] != null) {
          lineId = await findOrCreateLine(String(row[colLine]));
        } else if (sheetLineId != null) {
          lineId = sheetLineId;
        } else {
          lineId = await findOrCreateLine(sheetName);
          // Auto-register alias
          const norm = normBasic(sheetName);
          if (norm) {
            await db`
              INSERT INTO spma_line_alias (alias, alias_norm, line_id, active)
              VALUES (${sheetName}, ${norm}, ${lineId}, TRUE)
              ON CONFLICT (alias_norm) DO UPDATE SET line_id = EXCLUDED.line_id, active = TRUE
            `;
          }
        }

        // Position
        let posIndex: number | null = null;
        if (colPos && row[colPos] != null) {
          const pv = parseFloat(String(row[colPos]));
          if (!isNaN(pv)) posIndex = Math.round(pv);
        }

        // Upsert commessa
        await db`
          INSERT INTO spma_commessa
            (commessa_code, model_code, line_id, line_entry_ts, pos_index)
          VALUES
            (${commCode}, ${modelCode}, ${lineId}, ${dt.toISOString()}, ${posIndex})
          ON CONFLICT (commessa_code) DO UPDATE SET
            model_code    = EXCLUDED.model_code,
            line_id       = EXCLUDED.line_id,
            line_entry_ts = EXCLUDED.line_entry_ts,
            pos_index     = EXCLUDED.pos_index
        `;
        importedCodes.add(commCode);

        // Collect (lineId, date) for calendar auto-populate
        const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(dt);
        const calKey  = `${lineId}:${dateStr}`;
        if (!calendarDatesToFill.has(calKey)) calendarDatesToFill.set(calKey, { lineId, dateStr });

        upserted++;
      } catch (err) {
        skipped++;
        warnings.push(`Foglio "${sheetName}", riga ${i + 2}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Auto-populate calendar from imported dates ───────────────────────────
  if (calendarDatesToFill.size > 0) {
    try {
      const defaults = await db`SELECT day_of_week, shift_start, shift_end, is_working FROM spma_calendar_defaults`;
      const defByDay = new Map(defaults.map(d => [Number(d.day_of_week), d]));
      for (const { lineId, dateStr } of calendarDatesToFill.values()) {
        const dow = new Date(`${dateStr}T12:00:00`).getDay();
        const def = defByDay.get(dow);
        if (!def || !def.is_working) continue;
        await db`
          INSERT INTO spma_line_calendar (line_id, work_date, start_time, end_time, auto_generated)
          VALUES (${lineId}, ${dateStr}, ${String(def.shift_start)}, ${String(def.shift_end)}, TRUE)
          ON CONFLICT (line_id, work_date) DO NOTHING
        `.catch(err => logger.warn({ err, lineId, dateStr }, 'spma: calendar insert failed'));
      }
    } catch (err) {
      logger.warn({ err }, 'spma: calendar auto-populate failed');
    }
  }

  // ─── Cleanup: delete future commesse absent from import ───────────────────
  let deleted = 0;
  if (importedCodes.size > 0) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 10);
    const toDelete = await db`
      SELECT id, commessa_code FROM spma_commessa
      WHERE line_entry_ts > ${horizon.toISOString()}
        AND commessa_code != ALL(${[...importedCodes]})
    `;
    if (toDelete.length > 0) {
      const ids = toDelete.map(r => Number(r.id));
      await db`DELETE FROM spma_commessa WHERE id = ANY(${ids})`;
      deleted = ids.length;
    }
  }

  // ─── Rebuild plan ─────────────────────────────────────────────────────────
  let planResult: Awaited<ReturnType<typeof rebuildSpma>> | null = null;
  try {
    planResult = await rebuildSpma();
  } catch (err) {
    logger.error({ err }, 'spma: plan rebuild failed after import');
    warnings.push(`Rebuild piano fallito: ${(err as Error).message}`);
  }

  // ─── Log import ───────────────────────────────────────────────────────────
  await db`
    INSERT INTO spma_import_log (file_name, total_rows, upserts, skipped, deleted_stale, sheets)
    VALUES (${file.name}, ${totalRows}, ${upserted}, ${skipped}, ${deleted}, ${sheets})
  `.catch(err => logger.warn({ err }, 'spma: failed to save import log'));

  return c.json({
    sheets,
    total_rows_seen: totalRows,
    upserts:         upserted,
    skipped,
    deleted_stale:   deleted,
    warnings:        warnings.slice(0, 100),
    plan:            planResult,
  });
});

// ─── Import history ───────────────────────────────────────────────────────────

spmaRoutes.get('/import-history', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT id, file_name, imported_at, total_rows, upserts, skipped, deleted_stale, sheets
    FROM spma_import_log
    ORDER BY imported_at DESC
    LIMIT 50
  `;
  return c.json(rows);
});

// ─── Plan rebuild (manual) ────────────────────────────────────────────────────

spmaRoutes.post('/rebuild', requireManage(MODULE), async (c) => {
  const result = await rebuildSpma();
  return c.json(result);
});

// ─── Overview ─────────────────────────────────────────────────────────────────

spmaRoutes.get('/overview', requireModule(MODULE), async (c) => {
  const lineId    = c.req.query('line_id') ? parseInt(c.req.query('line_id')!, 10) : null;
  const date      = c.req.query('date') ?? null;
  const modelCode = c.req.query('model_code') ?? null;

  // Require at least one filter to avoid loading hundreds of rows at once
  if (lineId == null && date == null && modelCode == null) {
    return c.json({ categories: [], rows: [], warning: 'Seleziona almeno una linea o una data' });
  }

  // Commesse
  const commesse = await db`
    SELECT c.id, c.commessa_code, c.model_code, c.line_id, c.line_entry_ts
    FROM spma_commessa c
    WHERE TRUE
      ${lineId    != null ? db`AND c.line_id = ${lineId}`        : db``}
      ${date      != null ? db`AND DATE(c.line_entry_ts AT TIME ZONE 'Europe/Rome') = ${date}` : db``}
      ${modelCode != null ? db`AND c.model_code = ${modelCode}`  : db``}
    ORDER BY c.line_entry_ts ASC NULLS LAST, c.id ASC
    LIMIT 500
  `;
  if (commesse.length === 0) return c.json({ categories: [], rows: [] });

  // All categories required by visible models
  const models = [...new Set(commesse.map(c => c.model_code as string).filter(Boolean))];
  const reqRows = models.length > 0 ? await db`
    SELECT r.model_code, r.component_category_id
    FROM spma_model_component_req r
    WHERE r.model_code = ANY(${models})
  ` : [];

  const reqMap = new Map<string, Set<number>>();
  for (const r of reqRows) {
    if (!reqMap.has(r.model_code)) reqMap.set(r.model_code, new Set());
    reqMap.get(r.model_code)!.add(Number(r.component_category_id));
  }

  const catIds = [...new Set(reqRows.map(r => Number(r.component_category_id)))].sort((a, b) => a - b);
  const categories = catIds.length > 0 ? await db`
    SELECT id, name FROM spma_component_category WHERE id = ANY(${catIds}) ORDER BY sort_order, name
  ` : [];

  // Plan rows for the scope
  const planRows = await db`
    SELECT p.commessa_id, p.component_category_id, p.planned_ts, p.status
    FROM spma_plan p
    JOIN spma_commessa c ON c.id = p.commessa_id
    WHERE TRUE
      ${lineId    != null ? db`AND p.line_id = ${lineId}`           : db``}
      ${date      != null ? db`AND DATE(c.line_entry_ts) = ${date}` : db``}
      ${modelCode != null ? db`AND p.model_code = ${modelCode}`     : db``}
  `;
  const planMap = new Map<string, { planned_ts: unknown; status: string }>();
  for (const p of planRows) {
    planMap.set(`${p.commessa_id}:${p.component_category_id}`, {
      planned_ts: p.planned_ts,
      status:     p.status as string,
    });
  }

  const rows = commesse.map(cm => {
    const required = reqMap.get(cm.model_code as string) ?? new Set<number>();
    return {
      commessa_id:    cm.id,
      commessa_code:  cm.commessa_code,
      model_code:     cm.model_code,
      line_id:        cm.line_id,
      line_entry_ts:  cm.line_entry_ts,
      cells: categories.map(cat => {
        const cid = Number(cat.id);
        if (!required.has(cid)) return { component_category_id: cid, status: 'NA', planned_ts: null };
        const p = planMap.get(`${cm.id}:${cid}`);
        return {
          component_category_id: cid,
          status:                p?.status ?? 'PENDING',
          planned_ts:            p?.planned_ts ?? null,
        };
      }),
    };
  });

  return c.json({ categories, rows });
});

// ─── Confirm: list items ──────────────────────────────────────────────────────

spmaRoutes.get('/confirm/items', requireModule(MODULE), async (c) => {
  const statusParam = c.req.query('status') ?? 'PICKED,CONFIRMED';
  const statuses = statusParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const q = (c.req.query('q') ?? '').trim().toLowerCase();

  const rows = await db`
    SELECT
      p.id, p.commessa_id, p.commessa_code, p.component_category_id,
      cc.name AS category_name, p.status, p.planned_ts,
      p.confirmed_item_code, p.picked_at, p.confirmed_at, p.sent_at
    FROM spma_plan p
    JOIN spma_component_category cc ON cc.id = p.component_category_id
    WHERE p.status = ANY(${statuses})
      ${q ? db`AND (LOWER(p.commessa_code) LIKE ${'%' + q + '%'} OR LOWER(cc.name) LIKE ${'%' + q + '%'})` : db``}
    ORDER BY p.planned_ts ASC NULLS LAST, p.id ASC
  `;

  return c.json(rows);
});

// ─── Confirm: scan barcode ────────────────────────────────────────────────────

spmaRoutes.post('/confirm/scan', requireModule(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    commessaCode: z.string().min(1),
    planId:       z.number().int().positive().optional(),
  }));

  const cm = await db`SELECT id FROM spma_commessa WHERE commessa_code = ${body.commessaCode} LIMIT 1`;
  if (cm.length === 0) throw new HTTPException(404, { message: `Commessa ${body.commessaCode} non trovata` });

  if (body.planId) {
    // Direct confirm by plan ID
    await db`
      UPDATE spma_plan
      SET status = 'CONFIRMED', confirmed_at = NOW()
      WHERE id = ${body.planId} AND commessa_id = ${cm[0].id}
    `;
    return c.json({ result: 'CONFIRMED', planId: body.planId });
  }

  throw new HTTPException(400, { message: 'planId richiesto' });
});

// ─── Confirm: add manually ────────────────────────────────────────────────────

spmaRoutes.post('/confirm/add', requireModule(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    commessaCode:        z.string().min(1),
    componentCategoryId: z.number().int().positive(),
  }));

  const [cm] = await db`
    SELECT id, model_code, line_id, line_entry_ts FROM spma_commessa
    WHERE commessa_code = ${body.commessaCode} LIMIT 1
  `;
  if (!cm) throw new HTTPException(404, { message: `Commessa ${body.commessaCode} non trovata` });

  await db`
    INSERT INTO spma_plan
      (commessa_id, commessa_code, model_code, line_id, component_category_id, planned_ts, status, picked_at)
    VALUES
      (${cm.id}, ${body.commessaCode}, ${cm.model_code}, ${cm.line_id}, ${body.componentCategoryId},
       ${cm.line_entry_ts}, 'PICKED', NOW())
    ON CONFLICT (commessa_id, component_category_id) DO UPDATE SET
      status    = 'PICKED',
      picked_at = NOW()
  `;
  return c.json({ ok: true });
});

// ─── Confirm: revert to PENDING ───────────────────────────────────────────────

spmaRoutes.post('/confirm/remove', requireModule(MODULE), async (c) => {
  const body = await parseBody(c, z.object({ planId: z.number().int().positive() }));
  await db`
    UPDATE spma_plan
    SET status = 'PENDING', picked_at = NULL, confirmed_at = NULL,
        confirmed_item_code = NULL, sent_at = NULL
    WHERE id = ${body.planId}
  `;
  return c.json({ ok: true });
});

// ─── Confirm: bulk status change ──────────────────────────────────────────────

spmaRoutes.post('/confirm/mark', requireModule(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    planIds: z.array(z.number().int().positive()).min(1),
    status:  z.enum(['PENDING', 'PICKED', 'CONFIRMED', 'SENT']),
  }));

  const { planIds, status } = body;

  if (status === 'PENDING') {
    await db`
      UPDATE spma_plan
      SET status = 'PENDING', picked_at = NULL, confirmed_at = NULL,
          confirmed_item_code = NULL, sent_at = NULL
      WHERE id = ANY(${planIds})
    `;
  } else if (status === 'PICKED') {
    await db`
      UPDATE spma_plan
      SET status = 'PICKED', picked_at = NOW(), confirmed_at = NULL,
          confirmed_item_code = NULL, sent_at = NULL
      WHERE id = ANY(${planIds})
    `;
  } else if (status === 'CONFIRMED') {
    await db`
      UPDATE spma_plan
      SET status = 'CONFIRMED', confirmed_at = NOW()
      WHERE id = ANY(${planIds})
    `;
  } else {
    await db`
      UPDATE spma_plan
      SET status = 'SENT', sent_at = NOW()
      WHERE id = ANY(${planIds})
    `;
  }

  return c.json({ ok: true });
});

// ─── Confirm: send all CONFIRMED → SENT ──────────────────────────────────────

spmaRoutes.post('/confirm/send', requireModule(MODULE), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { planIds?: number[] };
  if (body.planIds?.length) {
    await db`
      UPDATE spma_plan SET status = 'SENT', sent_at = NOW()
      WHERE id = ANY(${body.planIds}) AND status = 'CONFIRMED'
    `;
  } else {
    await db`UPDATE spma_plan SET status = 'SENT', sent_at = NOW() WHERE status = 'CONFIRMED'`;
  }
  return c.json({ ok: true });
});

// ─── Componente mapping (iKnow ↔ SPMA category) ──────────────────────────────

spmaRoutes.get('/componente-map', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT m.id, m.componente_iknow, m.component_category_id,
           c.name AS category_name, m.active
    FROM spma_componente_map m
    JOIN spma_component_category c ON c.id = m.component_category_id
    ORDER BY m.componente_iknow
  `;
  return c.json(rows);
});

spmaRoutes.post('/componente-map', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    componenteIknow:     z.string().min(1),
    componentCategoryId: z.number().int().positive(),
  }));
  const [row] = await db`
    INSERT INTO spma_componente_map (componente_iknow, component_category_id, active)
    VALUES (${body.componenteIknow}, ${body.componentCategoryId}, TRUE)
    ON CONFLICT (componente_iknow, component_category_id)
      DO UPDATE SET active = TRUE
    RETURNING id, componente_iknow, component_category_id, active
  `;
  return c.json(row, 201);
});

spmaRoutes.delete('/componente-map/:id', requireManage(MODULE), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!c.req.param('id') || isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  await db`DELETE FROM spma_componente_map WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Distinct model codes seen in commesse ────────────────────────────────────

spmaRoutes.get('/models', requireModule(MODULE), async (c) => {
  const rows = await db`
    SELECT DISTINCT model_code FROM spma_commessa
    WHERE model_code IS NOT NULL AND model_code != '-'
    ORDER BY model_code
  `;
  return c.json(rows.map(r => r.model_code as string));
});

// ─── Calendar defaults ────────────────────────────────────────────────────────

spmaRoutes.get('/calendar-defaults', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT id, day_of_week, shift_start, shift_end, is_working FROM spma_calendar_defaults ORDER BY day_of_week`;
  return c.json(rows);
});

spmaRoutes.put('/calendar-defaults', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    shift_start: z.string().nullable().optional(),
    shift_end:   z.string().nullable().optional(),
    is_working:  z.boolean(),
  })));
  for (const row of body) {
    await db`
      INSERT INTO spma_calendar_defaults (day_of_week, shift_start, shift_end, is_working)
      VALUES (${row.day_of_week}, ${row.shift_start ?? null}, ${row.shift_end ?? null}, ${row.is_working})
      ON CONFLICT (day_of_week) DO UPDATE SET
        shift_start = EXCLUDED.shift_start,
        shift_end   = EXCLUDED.shift_end,
        is_working  = EXCLUDED.is_working
    `;
  }
  const rows = await db`SELECT id, day_of_week, shift_start, shift_end, is_working FROM spma_calendar_defaults ORDER BY day_of_week`;
  return c.json(rows);
});

// ─── Calendar entries ─────────────────────────────────────────────────────────

spmaRoutes.get('/calendar', requireModule(MODULE), async (c) => {
  const lineId = c.req.query('line_id') ? parseInt(c.req.query('line_id')!, 10) : null;
  const from   = c.req.query('from') ?? null;
  const to     = c.req.query('to')   ?? null;
  if (!lineId) throw new HTTPException(400, { message: 'line_id richiesto' });

  const rows = await db`
    SELECT id, line_id, work_date::text, start_time::text, end_time::text, auto_generated
    FROM spma_line_calendar
    WHERE line_id = ${lineId}
      ${from ? db`AND work_date >= ${from}` : db``}
      ${to   ? db`AND work_date <= ${to}`   : db``}
    ORDER BY work_date
  `;
  return c.json(rows);
});

spmaRoutes.post('/calendar', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    lineId:     z.number().int().positive(),
    workDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime:  z.string(),
    endTime:    z.string(),
  }));
  const [row] = await db`
    INSERT INTO spma_line_calendar (line_id, work_date, start_time, end_time, auto_generated)
    VALUES (${body.lineId}, ${body.workDate}, ${body.startTime}, ${body.endTime}, FALSE)
    ON CONFLICT (line_id, work_date) DO UPDATE SET
      start_time     = EXCLUDED.start_time,
      end_time       = EXCLUDED.end_time,
      auto_generated = FALSE
    RETURNING id, line_id, work_date::text, start_time::text, end_time::text, auto_generated
  `;
  return c.json(row, 201);
});

spmaRoutes.put('/calendar/:id', requireManage(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({
    startTime: z.string(),
    endTime:   z.string(),
  }));
  const [row] = await db`
    UPDATE spma_line_calendar
    SET start_time = ${body.startTime}, end_time = ${body.endTime}, auto_generated = FALSE
    WHERE id = ${id}
    RETURNING id, line_id, work_date::text, start_time::text, end_time::text, auto_generated
  `;
  if (!row) throw new HTTPException(404, { message: 'Voce non trovata' });
  return c.json(row);
});

spmaRoutes.delete('/calendar/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_line_calendar WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Phase sequence ───────────────────────────────────────────────────────────

spmaRoutes.get('/fase-sequence', requireModule(MODULE), async (c) => {
  const catId = c.req.query('category_id') ? parseInt(c.req.query('category_id')!, 10) : null;
  const rows = catId != null
    ? await db`SELECT id, component_category_id, order_index, fase_name, duration_minutes FROM spma_fase_sequence WHERE component_category_id = ${catId} ORDER BY order_index`
    : await db`SELECT id, component_category_id, order_index, fase_name, duration_minutes FROM spma_fase_sequence ORDER BY component_category_id, order_index`;
  return c.json(rows);
});

spmaRoutes.post('/fase-sequence', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    componentCategoryId: z.number().int().positive(),
    orderIndex:          z.number().int().min(1),
    faseName:            z.string().min(1),
    durationMinutes:     z.number().int().min(1),
  }));
  const [row] = await db`
    INSERT INTO spma_fase_sequence (component_category_id, order_index, fase_name, duration_minutes)
    VALUES (${body.componentCategoryId}, ${body.orderIndex}, ${body.faseName}, ${body.durationMinutes})
    ON CONFLICT (component_category_id, fase_name) DO UPDATE SET
      order_index      = EXCLUDED.order_index,
      duration_minutes = EXCLUDED.duration_minutes
    RETURNING id, component_category_id, order_index, fase_name, duration_minutes
  `;
  return c.json(row, 201);
});

spmaRoutes.put('/fase-sequence/:id', requireManage(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, z.object({
    orderIndex:      z.number().int().min(1).optional(),
    durationMinutes: z.number().int().min(1).optional(),
  }));
  const [row] = await db`
    UPDATE spma_fase_sequence SET
      order_index      = COALESCE(${body.orderIndex      ?? null}, order_index),
      duration_minutes = COALESCE(${body.durationMinutes ?? null}, duration_minutes)
    WHERE id = ${id}
    RETURNING id, component_category_id, order_index, fase_name, duration_minutes
  `;
  if (!row) throw new HTTPException(404, { message: 'Fase non trovata' });
  return c.json(row);
});

spmaRoutes.delete('/fase-sequence/:id', requireManage(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM spma_fase_sequence WHERE id = ${id}`;
  return c.json({ status: 'deleted' });
});

// ─── Alert config ─────────────────────────────────────────────────────────────

spmaRoutes.get('/alert-config', requireModule(MODULE), async (c) => {
  const [row] = await db`SELECT warning_pct, critical_pct, telegram_chat_id FROM spma_alert_config WHERE id = 1`;
  return c.json(row ?? { warning_pct: 15, critical_pct: 30, telegram_chat_id: null });
});

spmaRoutes.put('/alert-config', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, z.object({
    warningPct:     z.number().int().min(1).max(99),
    criticalPct:    z.number().int().min(1).max(100),
    telegramChatId: z.string().nullable().optional(),
  }));
  const chatId = body.telegramChatId !== undefined ? (body.telegramChatId ?? null) : null;
  const [row] = await db`
    INSERT INTO spma_alert_config (id, warning_pct, critical_pct, telegram_chat_id)
    VALUES (1, ${body.warningPct}, ${body.criticalPct}, ${chatId})
    ON CONFLICT (id) DO UPDATE SET
      warning_pct      = EXCLUDED.warning_pct,
      critical_pct     = EXCLUDED.critical_pct,
      telegram_chat_id = EXCLUDED.telegram_chat_id
    RETURNING warning_pct, critical_pct, telegram_chat_id
  `;
  return c.json(row);
});

// ─── SPMA Telegram helpers ────────────────────────────────────────────────────

spmaRoutes.get('/telegram-updates', requireManage(MODULE), async (c) => {
  if (!spmaTokenConfigured()) {
    throw new HTTPException(400, { message: 'SPMA_TELEGRAM_BOT_TOKEN non configurato nel server' });
  }
  try {
    const chats = await fetchRecentChats();
    return c.json(chats);
  } catch (err) {
    logger.warn({ err }, 'spma: fetchRecentChats failed');
    throw new HTTPException(500, { message: (err as Error).message });
  }
});

spmaRoutes.post('/telegram-test', requireManage(MODULE), async (c) => {
  if (!spmaTokenConfigured()) {
    throw new HTTPException(400, { message: 'SPMA_TELEGRAM_BOT_TOKEN non configurato nel server' });
  }
  const [cfg] = await db`SELECT telegram_chat_id FROM spma_alert_config WHERE id = 1`;
  const chatId = cfg?.telegram_chat_id ? String(cfg.telegram_chat_id) : null;
  if (!chatId) {
    throw new HTTPException(400, { message: 'Chat ID non configurato — salvalo prima nel tab Alert' });
  }
  await sendTestMessage(chatId);
  return c.json({ ok: true, chat_id: chatId });
});

spmaRoutes.post('/telegram-report-now', requireManage(MODULE), async (c) => {
  if (!spmaTokenConfigured()) {
    throw new HTTPException(400, { message: 'SPMA_TELEGRAM_BOT_TOKEN non configurato nel server' });
  }
  const [cfg] = await db`SELECT telegram_chat_id FROM spma_alert_config WHERE id = 1`;
  const chatId = cfg?.telegram_chat_id ? String(cfg.telegram_chat_id) : null;
  if (!chatId) throw new HTTPException(400, { message: 'Chat ID non configurato' });
  const results = await checkSpmaDelays();
  const delayed = results.filter(r => r.severity !== 'ok');
  await sendDelayReport(results, chatId);
  return c.json({ ok: true, delayed: delayed.length });
});

// ─── Delay status ─────────────────────────────────────────────────────────────

spmaRoutes.get('/delay-status', requireModule(MODULE), async (c) => {
  try {
    const results = await checkSpmaDelays();
    return c.json(results);
  } catch (err) {
    logger.error({ err }, 'spma: delay-status error');
    throw new HTTPException(500, { message: 'Errore calcolo ritardi' });
  }
});
