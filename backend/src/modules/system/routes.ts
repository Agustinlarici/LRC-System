import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parseBody } from '../../lib/validate.js';
import { getIKnowFlags, setIKnowFlags } from '../../lib/system-flags.js';
import { getAllStats } from '../../lib/sync-stats.js';
import { refreshLookupTables } from '../monitor/pg-webthron-sync.js';
import { db } from '../../db/client.js';

export const systemRoutes = new Hono();

systemRoutes.get('/iknow-flags', async (c) => {
  const flags = await getIKnowFlags();
  return c.json(flags);
});

systemRoutes.patch('/iknow-flags', async (c) => {
  const body = await parseBody(c, z.object({
    iknow_enabled:        z.boolean().optional(),
    iknow_andon_enabled:  z.boolean().optional(),
    iknow_buffer_enabled: z.boolean().optional(),
  }));
  const flags = await setIKnowFlags(body);
  return c.json(flags);
});

// GET /api/system/sync-status — performance metrics for all WebThron sync jobs
systemRoutes.get('/sync-status', (c) => {
  const stats = getAllStats();
  const out: Record<string, unknown> = {};
  for (const [job, s] of Object.entries(stats)) {
    out[job] = {
      ...s,
      lastDurationSec: s.lastDurationMs != null ? Math.round(s.lastDurationMs / 100) / 10 : null,
    };
  }
  return c.json(out);
});

// POST /api/system/lookup-refresh — aggiorna fasi e combos da WebThron subito
// Risponde 202 subito, il refresh gira in background
systemRoutes.post('/lookup-refresh', (c) => {
  refreshLookupTables()
    .then(() => {})
    .catch(() => {});
  return c.json({ message: 'Refresh avviato in background' }, 202);
});

// ─── iKnow Tracked Lists ──────────────────────────────────────────────────────
// Three independent lists; getActiveLineeWithCombos() does a CROSS JOIN.

type IKnowList = 'fasi' | 'modelli' | 'componenti';
const TABLE: Record<IKnowList, string> = {
  fasi:       'iknow_tracked_fasi',
  modelli:    'iknow_tracked_modelli',
  componenti: 'iknow_tracked_componenti',
};
const COL: Record<IKnowList, string> = {
  fasi: 'fase', modelli: 'modello', componenti: 'componente',
};

// GET /api/system/iknow/:list  (list = fasi | modelli | componenti)
systemRoutes.get('/iknow/:list', async (c) => {
  const list = c.req.param('list') as IKnowList;
  if (!TABLE[list]) throw new HTTPException(404, { message: 'Lista non valida' });
  const rows = await db`SELECT id, ${db(COL[list])} AS value, active FROM ${db(TABLE[list])} ORDER BY ${db(COL[list])}`;
  return c.json(rows);
});

// POST /api/system/iknow/:list  { value: string }
systemRoutes.post('/iknow/:list', async (c) => {
  const list = c.req.param('list') as IKnowList;
  if (!TABLE[list]) throw new HTTPException(404, { message: 'Lista non valida' });
  const body = await parseBody(c, z.object({ value: z.string().min(1) }));
  const val  = body.value.trim();
  const rows = await db`
    INSERT INTO ${db(TABLE[list])} (${db(COL[list])})
    VALUES (${val})
    ON CONFLICT (${db(COL[list])}) DO UPDATE SET active = TRUE
    RETURNING id, ${db(COL[list])} AS value, active
  `;
  return c.json(rows[0], 201);
});

// PATCH /api/system/iknow/:list/:id  { active: boolean }
systemRoutes.patch('/iknow/:list/:id', async (c) => {
  const list = c.req.param('list') as IKnowList;
  if (!TABLE[list]) throw new HTTPException(404, { message: 'Lista non valida' });
  const id   = parseInt(c.req.param('id'), 10);
  const body = await parseBody(c, z.object({ active: z.boolean() }));
  const rows = await db`
    UPDATE ${db(TABLE[list])} SET active = ${body.active}
    WHERE id = ${id}
    RETURNING id, ${db(COL[list])} AS value, active
  `;
  if (!rows[0]) throw new HTTPException(404, { message: 'Voce non trovata' });
  return c.json(rows[0]);
});

// DELETE /api/system/iknow/:list/:id
systemRoutes.delete('/iknow/:list/:id', async (c) => {
  const list = c.req.param('list') as IKnowList;
  if (!TABLE[list]) throw new HTTPException(404, { message: 'Lista non valida' });
  const id = parseInt(c.req.param('id'), 10);
  await db`DELETE FROM ${db(TABLE[list])} WHERE id = ${id}`;
  return c.json({ ok: true });
});

// Autocomplete — lookup tables populated by daily WebThron sync
systemRoutes.get('/iknow-lookup/fasi', async (c) => {
  const rows = await db`SELECT fase FROM webthron_lookup_fasi ORDER BY fase`;
  return c.json(rows.map(r => r.fase as string));
});

systemRoutes.get('/iknow-lookup/modelli', async (c) => {
  const rows = await db`SELECT DISTINCT modello FROM webthron_lookup_combos ORDER BY modello`;
  return c.json(rows.map(r => r.modello as string));
});

systemRoutes.get('/iknow-lookup/componenti', async (c) => {
  const rows = await db`SELECT DISTINCT componente FROM webthron_lookup_combos ORDER BY componente`;
  return c.json(rows.map(r => r.componente as string));
});
