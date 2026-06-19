import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parseBody } from '../../lib/validate.js';
import { getIKnowFlags, setIKnowFlags } from '../../lib/system-flags.js';
import { getAllStats, startRun, endRun, failRun } from '../../lib/sync-stats.js';
import { refreshLookupTables } from '../monitor/pg-webthron-sync.js';
import { executiveRefresh } from '../monitor/executive-cache.js';
import { syncPackArticles } from '../packing/bc-client.js';
import { snapshotDayFromHistory } from '../dashboards/heatmap.js';
import { pollOneDriveFolder } from '../spma/onedrive-watcher.js';
import { getActiveAlerts } from '../../lib/alert-manager.js';
import { sendAlert } from '../../lib/notifier.js';
import { requireAuth } from '../../lib/auth.js';
import { db } from '../../db/client.js';
import type { Env } from '../../lib/auth.js';

export const systemRoutes = new Hono<Env>();

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
systemRoutes.post('/lookup-refresh', (c) => {
  refreshLookupTables()
    .then(() => {})
    .catch(() => {});
  return c.json({ message: 'Refresh avviato in background' }, 202);
});

// ─── Force-restart endpoints (richiedono autenticazione) ──────────────────────

// POST /api/system/force-sync — esegue subito executiveRefresh()
systemRoutes.post('/force-sync', requireAuth, (c) => {
  executiveRefresh()
    .then(() => {})
    .catch(() => {});
  return c.json({ message: 'Sync WebThron avviato' }, 202);
});

// POST /api/system/force-bc-sync — esegue subito syncPackArticles()
systemRoutes.post('/force-bc-sync', requireAuth, (c) => {
  syncPackArticles()
    .then(() => {})
    .catch(() => {});
  return c.json({ message: 'Sync Business Central avviato' }, 202);
});

// POST /api/system/force-lookup — refresh fasi/combos subito
systemRoutes.post('/force-lookup', requireAuth, (c) => {
  refreshLookupTables()
    .then(() => {})
    .catch(() => {});
  return c.json({ message: 'Lookup refresh avviato' }, 202);
});

// POST /api/system/force-onedrive-poll — poll OneDrive SPMA subito
systemRoutes.post('/force-onedrive-poll', requireAuth, (c) => {
  startRun('spma_onedrive_poll');
  pollOneDriveFolder()
    .then(result => endRun('spma_onedrive_poll', result.count))
    .catch(e => failRun('spma_onedrive_poll', e));
  return c.json({ message: 'Poll OneDrive SPMA avviato' }, 202);
});

// POST /api/system/force-snapshot — snapshot OEE di ieri
systemRoutes.post('/force-snapshot', requireAuth, async (c) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(yesterday);
  snapshotDayFromHistory(dateStr)
    .then(() => {})
    .catch(() => {});
  return c.json({ message: `Snapshot OEE per ${dateStr} avviato` }, 202);
});

// POST /api/system/test-alert — invia un alert di test (solo admin)
systemRoutes.post('/test-alert', requireAuth, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && user.role !== 'it') {
    throw new HTTPException(403, { message: 'Solo admin/it possono inviare alert di test' });
  }
  await sendAlert(
    'Test Alert LRC-System',
    `Alert di test inviato da ${user.display_name} alle ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
  );
  return c.json({ message: 'Alert di test inviato' });
});

// ─── Alert history ────────────────────────────────────────────────────────────

// GET /api/system/alerts — storico alert dal DB, opzionale ?active=true
systemRoutes.get('/alerts', requireAuth, async (c) => {
  const onlyActive = c.req.query('active') === 'true';

  const rows = onlyActive
    ? await db`
        SELECT id, alert_key, severity, title, message, resolved_at, resolved_message, created_at
        FROM system_alerts
        WHERE resolved_at IS NULL
        ORDER BY created_at DESC
        LIMIT 100
      `
    : await db`
        SELECT id, alert_key, severity, title, message, resolved_at, resolved_message, created_at
        FROM system_alerts
        ORDER BY created_at DESC
        LIMIT 100
      `;

  // Arricchisci con flag in-memory per gli alert attivi
  const activeKeys = new Set(getActiveAlerts().map(a => a.key));
  return c.json(rows.map(r => ({ ...r, is_active: activeKeys.has(r.alert_key as string) })));
});

// GET /api/system/alerts/active — alert attivi in-memory (istantaneo, no DB)
systemRoutes.get('/alerts/active', requireAuth, (c) => {
  return c.json(getActiveAlerts());
});

// ─── iKnow Tracked Lists ──────────────────────────────────────────────────────

type IKnowList = 'fasi' | 'modelli' | 'componenti';
const TABLE: Record<IKnowList, string> = {
  fasi:       'iknow_tracked_fasi',
  modelli:    'iknow_tracked_modelli',
  componenti: 'iknow_tracked_componenti',
};
const COL: Record<IKnowList, string> = {
  fasi: 'fase', modelli: 'modello', componenti: 'componente',
};

systemRoutes.get('/iknow/:list', async (c) => {
  const list = c.req.param('list') as IKnowList;
  if (!TABLE[list]) throw new HTTPException(404, { message: 'Lista non valida' });
  const rows = await db`SELECT id, ${db(COL[list])} AS value, active FROM ${db(TABLE[list])} ORDER BY ${db(COL[list])}`;
  return c.json(rows);
});

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
