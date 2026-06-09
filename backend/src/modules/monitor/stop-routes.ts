import { Hono }         from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z }             from 'zod';
import * as XLSX         from 'xlsx';
import { db }            from '../../db/client.js';
import { parseBody }     from '../../lib/validate.js';
import { requireAuth }   from '../../lib/auth.js';
import { detectStopsForLine } from './stop-detector.js';

export const stopRoutes = new Hono();

function parseId(raw: string) {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = sec % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m`
    : `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─── Motivi (pubblici — usati dall'operaio) ───────────────────────────────────

stopRoutes.get('/motivi', async (c) => {
  const categorie = await db`
    SELECT id, nome, colore, ordine FROM monitor_stop_categories
    WHERE attivo = true ORDER BY ordine, nome
  `;
  const motivi = await db`
    SELECT r.id, r.category_id, c.nome AS categoria_nome, c.colore AS categoria_colore,
           r.descrizione, r.ordine
    FROM monitor_stop_reasons r
    LEFT JOIN monitor_stop_categories c ON c.id = r.category_id
    WHERE r.attivo = true
    ORDER BY c.ordine, r.ordine, r.descrizione
  `;
  return c.json({ categorie, motivi });
});

// ─── Parate per linea (operaio) ───────────────────────────────────────────────

stopRoutes.get('/parate/:lineaId', async (c) => {
  const lineaId = parseId(c.req.param('lineaId'));

  // Trigger detection on-demand for this line
  await detectStopsForLine(lineaId).catch(() => {});

  const [linea] = await db`SELECT id, nome FROM monitor_linea WHERE id = ${lineaId}`;
  if (!linea) throw new HTTPException(404, { message: 'Linea non trovata' });

  // Last 24h of stops for this line
  const stops = await db`
    SELECT
      e.id, e.linea_id, e.started_at, e.ended_at,
      EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at))::INT AS duration_sec,
      e.reason_id, r.descrizione AS reason_descrizione,
      c.nome AS categoria_nome, c.colore AS categoria_colore,
      e.note, e.operatore, e.registrato_at
    FROM monitor_stop_events e
    LEFT JOIN monitor_stop_reasons r ON r.id = e.reason_id
    LEFT JOIN monitor_stop_categories c ON c.id = r.category_id
    WHERE e.linea_id = ${lineaId}
      AND e.started_at >= NOW() - INTERVAL '24 hours'
    ORDER BY e.started_at DESC
  `;

  return c.json({ linea, stops });
});

// ─── Apri fermata manuale (operaio, no auth) ─────────────────────────────────

stopRoutes.post('/parate/:lineaId/apri', async (c) => {
  const lineaId = parseId(c.req.param('lineaId'));
  const [linea] = await db`SELECT id FROM monitor_linea WHERE id = ${lineaId} AND attivo = true`;
  if (!linea) throw new HTTPException(404, { message: 'Linea non trovata' });

  const [row] = await db`
    INSERT INTO monitor_stop_events (linea_id, started_at)
    VALUES (${lineaId}, NOW())
    RETURNING id
  `;
  return c.json({ id: row.id }, 201);
});

// ─── Chiudi fermata manuale ───────────────────────────────────────────────────

stopRoutes.post('/parate/:eventId/chiudi', async (c) => {
  const eventId = parseId(c.req.param('eventId'));
  const [updated] = await db`
    UPDATE monitor_stop_events SET ended_at = NOW()
    WHERE id = ${eventId} AND ended_at IS NULL
    RETURNING id
  `;
  if (!updated) throw new HTTPException(404, { message: 'Fermata non trovata o già chiusa' });
  return c.json({ ok: true });
});

// ─── Registra motivo su una fermata (operaio, no auth) ────────────────────────

const motivoSchema = z.object({
  reason_id: z.number().int().positive().nullable(),
  note:      z.string().max(1000).nullable().optional(),
  operatore: z.string().min(1).max(100),
});

stopRoutes.post('/parate/:eventId/motivo', async (c) => {
  const eventId = parseId(c.req.param('eventId'));
  const body    = await parseBody(c, motivoSchema);

  const [updated] = await db`
    UPDATE monitor_stop_events
    SET reason_id     = ${body.reason_id},
        note          = ${body.note ?? null},
        operatore     = ${body.operatore},
        registrato_at = NOW()
    WHERE id = ${eventId}
    RETURNING id
  `;
  if (!updated) throw new HTTPException(404, { message: 'Fermata non trovata' });
  return c.json({ ok: true });
});

// ─── Storico admin ────────────────────────────────────────────────────────────

stopRoutes.get('/parate', requireAuth, async (c) => {
  const q        = c.req.query();
  const lineaId  = q['linea_id']  ? parseInt(q['linea_id'], 10)  : null;
  const from     = q['from']     ?? null;
  const to       = q['to']       ?? null;
  const noMotivo = q['no_motivo'] === 'true';

  const lineaFilter  = lineaId  ? db`AND e.linea_id = ${lineaId}`            : db``;
  const fromFilter   = from     ? db`AND e.started_at >= ${from}::timestamptz` : db``;
  const toFilter     = to       ? db`AND e.started_at <= ${to}::timestamptz + INTERVAL '1 day'` : db``;
  const motivoFilter = noMotivo ? db`AND e.reason_id IS NULL`                 : db``;

  const stops = await db`
    SELECT
      e.id, e.linea_id, l.nome AS linea_nome, e.started_at, e.ended_at,
      EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at))::INT AS duration_sec,
      e.reason_id, r.descrizione AS reason_descrizione,
      c.nome AS categoria_nome, c.colore AS categoria_colore,
      e.note, e.operatore, e.registrato_at
    FROM monitor_stop_events e
    JOIN monitor_linea l ON l.id = e.linea_id
    LEFT JOIN monitor_stop_reasons r ON r.id = e.reason_id
    LEFT JOIN monitor_stop_categories c ON c.id = r.category_id
    WHERE 1=1
    ${lineaFilter} ${fromFilter} ${toFilter} ${motivoFilter}
    ORDER BY e.started_at DESC
    LIMIT 1000
  `;

  return c.json(stops);
});

// ─── Export Excel ─────────────────────────────────────────────────────────────

stopRoutes.get('/parate/export', requireAuth, async (c) => {
  const q        = c.req.query();
  const lineaId  = q['linea_id'] ? parseInt(q['linea_id'], 10) : null;
  const from     = q['from']    ?? null;
  const to       = q['to']      ?? null;

  const lineaFilter = lineaId ? db`AND e.linea_id = ${lineaId}` : db``;
  const fromFilter  = from    ? db`AND e.started_at >= ${from}::timestamptz` : db``;
  const toFilter    = to      ? db`AND e.started_at <= ${to}::timestamptz + INTERVAL '1 day'` : db``;

  const rows = await db`
    SELECT
      l.nome AS linea, e.started_at, e.ended_at,
      EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at))::INT AS duration_sec,
      c.nome AS categoria, r.descrizione AS motivo, e.note, e.operatore, e.registrato_at
    FROM monitor_stop_events e
    JOIN monitor_linea l ON l.id = e.linea_id
    LEFT JOIN monitor_stop_reasons r ON r.id = e.reason_id
    LEFT JOIN monitor_stop_categories c ON c.id = r.category_id
    WHERE 1=1 ${lineaFilter} ${fromFilter} ${toFilter}
    ORDER BY e.started_at DESC
    LIMIT 5000
  `;

  const data = rows.map((r: Record<string, unknown>) => ({
    'Linea':          r.linea,
    'Inizio':         r.started_at ? new Date(r.started_at as string).toLocaleString('it-IT') : '',
    'Fine':           r.ended_at   ? new Date(r.ended_at   as string).toLocaleString('it-IT') : 'In corso',
    'Durata':         fmtDuration(r.duration_sec as number | null),
    'Categoria':      r.categoria  ?? '',
    'Motivo':         r.motivo     ?? '',
    'Note':           r.note       ?? '',
    'Operatore':      r.operatore  ?? '',
    'Registrato il':  r.registrato_at ? new Date(r.registrato_at as string).toLocaleString('it-IT') : '',
  }));

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Fermate');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buf, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="fermate_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});

// ─── Admin: Categorie ─────────────────────────────────────────────────────────

const categorySchema = z.object({
  nome:   z.string().min(1).max(100),
  colore: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6b7280'),
  ordine: z.number().int().default(0),
  attivo: z.boolean().default(true),
});

stopRoutes.get('/motivi/admin', requireAuth, async (c) => {
  const categorie = await db`
    SELECT id, nome, colore, ordine, attivo FROM monitor_stop_categories ORDER BY ordine, nome
  `;
  const motivi = await db`
    SELECT r.id, r.category_id, c.nome AS categoria_nome, r.descrizione, r.ordine, r.attivo
    FROM monitor_stop_reasons r
    LEFT JOIN monitor_stop_categories c ON c.id = r.category_id
    ORDER BY c.ordine, r.ordine, r.descrizione
  `;
  return c.json({ categorie, motivi });
});

stopRoutes.post('/motivi/categorie', requireAuth, async (c) => {
  const body = await parseBody(c, categorySchema);
  const [row] = await db`
    INSERT INTO monitor_stop_categories (nome, colore, ordine, attivo)
    VALUES (${body.nome}, ${body.colore}, ${body.ordine}, ${body.attivo})
    RETURNING *
  `;
  return c.json(row, 201);
});

stopRoutes.put('/motivi/categorie/:id', requireAuth, async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, categorySchema.partial());
  const [row] = await db`
    UPDATE monitor_stop_categories
    SET nome   = COALESCE(${body.nome   ?? null}, nome),
        colore = COALESCE(${body.colore ?? null}, colore),
        ordine = COALESCE(${body.ordine ?? null}, ordine),
        attivo = COALESCE(${body.attivo ?? null}, attivo)
    WHERE id = ${id} RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Categoria non trovata' });
  return c.json(row);
});

stopRoutes.delete('/motivi/categorie/:id', requireAuth, async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM monitor_stop_categories WHERE id = ${id}`;
  return c.json({ ok: true });
});

// ─── Admin: Motivi ────────────────────────────────────────────────────────────

const reasonSchema = z.object({
  category_id: z.number().int().positive().nullable(),
  descrizione: z.string().min(1).max(200),
  ordine:      z.number().int().default(0),
  attivo:      z.boolean().default(true),
});

stopRoutes.post('/motivi/reasons', requireAuth, async (c) => {
  const body = await parseBody(c, reasonSchema);
  const [row] = await db`
    INSERT INTO monitor_stop_reasons (category_id, descrizione, ordine, attivo)
    VALUES (${body.category_id}, ${body.descrizione}, ${body.ordine}, ${body.attivo})
    RETURNING *
  `;
  return c.json(row, 201);
});

stopRoutes.put('/motivi/reasons/:id', requireAuth, async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, reasonSchema.partial());
  const [row] = await db`
    UPDATE monitor_stop_reasons
    SET category_id = COALESCE(${body.category_id ?? null}, category_id),
        descrizione = COALESCE(${body.descrizione ?? null}, descrizione),
        ordine      = COALESCE(${body.ordine      ?? null}, ordine),
        attivo      = COALESCE(${body.attivo      ?? null}, attivo)
    WHERE id = ${id} RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Motivo non trovato' });
  return c.json(row);
});

stopRoutes.delete('/motivi/reasons/:id', requireAuth, async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM monitor_stop_reasons WHERE id = ${id}`;
  return c.json({ ok: true });
});
