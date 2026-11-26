import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parseBody } from '../../lib/validate.js';
import { requireAuth } from '../../lib/auth.js';
import { db } from '../../db/client.js';
import type { Env } from '../../lib/auth.js';

export const activityRoutes = new Hono<Env>();

// Prefisso del percorso → nome del modulo mostrato nel pannello (il primo che combacia vince)
const MODULE_BY_PREFIX: [string, string][] = [
  ['/admin/system',     'Sistema'],
  ['/admin/attivita',   'Attività'],
  ['/admin/monitor',    'Fermate'],
  ['/ingresso-merci',   'Materiale Urgente'],
  ['/packing',          'Packing'],
  ['/monitor',          'Andon'],
  ['/buffer',           'Buffer'],
  ['/mappa',            'Mappa'],
  ['/tickets',          'Ticket IT'],
  ['/dashboards',       'Dashboard'],
  ['/spma',             'Avanzamento Prod'],
  ['/recepciones',      'Ricezione DDT'],
  ['/edi',              'EDI'],
  ['/webddt',           'WebDDT'],
  ['/spedizione-bucci', 'Spedizione Bucci'],
  ['/qualita',          'Qualità'],
  ['/produzione',       'Programma Produzione'],
  ['/ferrari',          'Programma produzione (schede)'],
  ['/hr',               'HR'],
];

function moduleOf(path: string): string {
  if (path === '/') return 'Home';
  return MODULE_BY_PREFIX.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? 'Altro';
}

function assertAdmin(role: string) {
  if (role !== 'admin') throw new HTTPException(403, { message: 'Solo amministratori' });
}

const daysParam = (raw: string | undefined) => Math.min(Math.max(parseInt(raw ?? '30', 10) || 30, 1), 365);

// ?escludi_me=1 → le statistiche non contano l'utente che guarda il pannello (es. chi sviluppa)
const excludedUser = (c: { req: { query: (k: string) => string | undefined }; get: (k: 'user') => { id: number } }) =>
  c.req.query('escludi_me') === '1' ? c.get('user').id : null;

// POST /api/activity/track — il frontend lo chiama a ogni cambio pagina (heartbeat=true: solo presenza)
activityRoutes.post('/track', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, z.object({
    path:      z.string().min(1).max(300).startsWith('/'),
    heartbeat: z.boolean().optional(),
  }));
  const path = body.path.split('?')[0];

  const deviceId = user.device_id ?? null;

  await db`
    INSERT INTO user_presence (user_id, device_id, last_path, last_seen)
    VALUES (${user.id}, ${deviceId}, ${path}, now())
    ON CONFLICT (user_id, (coalesce(device_id, 0))) DO UPDATE SET last_path = EXCLUDED.last_path, last_seen = now()
  `;
  if (!body.heartbeat) {
    await db`
      INSERT INTO page_views (user_id, device_id, username, path, module)
      VALUES (${user.id}, ${deviceId}, ${user.username}, ${path}, ${moduleOf(path)})
    `;
  }
  return c.json({ status: 'ok' });
});

// ─── Pannello (solo admin) ────────────────────────────────────────────────────

// GET /api/activity/accessi?days=30 — login, utenti e ultimo accesso
activityRoutes.get('/accessi', requireAuth, async (c) => {
  assertAdmin(c.get('user').role);
  const days = daysParam(c.req.query('days'));
  const ex   = excludedUser(c);

  const [kpi] = await db`
    SELECT
      count(*) FILTER (WHERE action = 'login_success')::int                AS logins,
      count(DISTINCT user_id) FILTER (WHERE action = 'login_success')::int AS utenti,
      count(*) FILTER (WHERE action = 'login_failed')::int                 AS falliti,
      count(*) FILTER (WHERE action = 'device_login_success')::int         AS logins_dispositivi
    FROM audit_log
    WHERE action IN ('login_success', 'login_failed', 'device_login_success')
      AND created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
  `;
  const [attivi] = await db`SELECT count(*)::int AS n FROM users WHERE is_active ${ex != null ? db`AND id <> ${ex}` : db``}`;

  const daily = await db`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           coalesce(a.ok, 0)::int AS ok, coalesce(a.dev, 0)::int AS dev, coalesce(a.ko, 0)::int AS ko
    FROM generate_series(
           (now() AT TIME ZONE 'Europe/Rome')::date - (${days}::int - 1),
           (now() AT TIME ZONE 'Europe/Rome')::date, '1 day') AS d(day)
    LEFT JOIN (
      SELECT (created_at AT TIME ZONE 'Europe/Rome')::date AS day,
             count(*) FILTER (WHERE action = 'login_success')        AS ok,
             count(*) FILTER (WHERE action = 'device_login_success') AS dev,
             count(*) FILTER (WHERE action = 'login_failed')         AS ko
      FROM audit_log
      WHERE action IN ('login_success', 'login_failed', 'device_login_success')
        AND created_at >= now() - make_interval(days => ${days} + 1)
        AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
      GROUP BY 1
    ) a ON a.day = d.day
    ORDER BY d.day
  `;

  const utenti = await db`
    SELECT u.id, u.username, u.display_name, u.role,
           (SELECT max(created_at) FROM audit_log l WHERE l.user_id = u.id AND l.action = 'login_success') AS ultimo_login,
           (SELECT count(*)::int FROM audit_log l WHERE l.user_id = u.id AND l.action = 'login_success'
              AND l.created_at >= now() - make_interval(days => ${days}))                                   AS logins,
           (SELECT count(*)::int FROM page_views v WHERE v.user_id = u.id
              AND v.created_at >= now() - make_interval(days => ${days}))                                   AS pagine,
           p.last_seen AS ultimo_segnale
    FROM users u
    LEFT JOIN user_presence p ON p.user_id = u.id
    WHERE u.is_active AND (${ex}::int IS NULL OR u.id IS DISTINCT FROM ${ex}::int)
    ORDER BY ultimo_login DESC NULLS LAST, u.username
  `;

  const dispositivi = await db`
    SELECT dt.id, dt.label, u.display_name AS utente, dt.created_at, dt.last_used_at, dt.revoked_at,
           (SELECT count(*)::int FROM audit_log l WHERE l.action = 'device_login_success' AND l.entity_id = dt.id::text
              AND l.created_at >= now() - make_interval(days => ${days}))                    AS logins,
           (SELECT count(*)::int FROM page_views v WHERE v.device_id = dt.id
              AND v.created_at >= now() - make_interval(days => ${days}))                    AS pagine,
           (SELECT max(p.last_seen) FROM user_presence p WHERE p.device_id = dt.id)            AS ultimo_segnale
    FROM device_tokens dt
    JOIN users u ON u.id = dt.user_id
    ORDER BY dt.revoked_at IS NOT NULL, dt.last_used_at DESC NULLS LAST
  `;

  return c.json({ days, kpi: { ...kpi, utenti_attivi: attivi.n }, daily, utenti, dispositivi });
});

// GET /api/activity/moduli?days=30 — uso per modulo, mappa di calore giorno×ora, utenti più attivi
activityRoutes.get('/moduli', requireAuth, async (c) => {
  assertAdmin(c.get('user').role);
  const days = daysParam(c.req.query('days'));
  const ex   = excludedUser(c);

  const moduli = await db`
    SELECT module, count(*)::int AS pagine, count(DISTINCT user_id)::int AS utenti, max(created_at) AS ultimo
    FROM page_views
    WHERE created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY module
    ORDER BY pagine DESC
  `;

  // dow: 1 = lunedì … 7 = domenica (ISODOW)
  const heat = await db`
    SELECT extract(isodow FROM created_at AT TIME ZONE 'Europe/Rome')::int AS dow,
           extract(hour   FROM created_at AT TIME ZONE 'Europe/Rome')::int AS hour,
           count(*)::int AS n
    FROM page_views
    WHERE created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY 1, 2
  `;

  const utenti = await db`
    SELECT coalesce(dt.label || ' (dispositivo)', u.display_name, v.username, '?') AS nome, v.module, count(*)::int AS pagine
    FROM page_views v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN device_tokens dt ON dt.id = v.device_id
    WHERE v.created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR v.user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY 1, 2
    ORDER BY pagine DESC
    LIMIT 200
  `;

  // Pagine dentro ogni modulo: gli id numerici (/hr/dipendenti/123) vengono raggruppati in :id
  const pagine = await db`
    SELECT module, regexp_replace(path, '/[0-9]+(?=/|$)', '/:id', 'g') AS path,
           count(*)::int AS visite, count(DISTINCT user_id)::int AS utenti,
           count(DISTINCT device_id)::int AS dispositivi, max(created_at) AS ultimo
    FROM page_views
    WHERE created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY 1, 2
    ORDER BY visite DESC
    LIMIT 1000
  `;

  const [totale] = await db`
    SELECT count(*)::int AS pagine, min(created_at) AS da
    FROM page_views WHERE created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
  `;

  return c.json({ days, totale, moduli, pagine, heat, utenti });
});

// GET /api/activity/online — utenti con segnale negli ultimi 5 minuti
activityRoutes.get('/online', requireAuth, async (c) => {
  assertAdmin(c.get('user').role);
  const ex = excludedUser(c);
  const online = await db<{ username: string; display_name: string; role: string; device_label: string | null; last_path: string; last_seen: Date }[]>`
    SELECT u.username, u.display_name, u.role, dt.label AS device_label, p.last_path, p.last_seen
    FROM user_presence p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN device_tokens dt ON dt.id = p.device_id
    WHERE p.last_seen >= now() - interval '5 minutes' AND (${ex}::int IS NULL OR p.user_id IS DISTINCT FROM ${ex}::int)
    ORDER BY p.last_seen DESC
  `;
  return c.json({ online: online.map(r => ({ ...r, module: moduleOf(r.last_path) })) });
});

// GET /api/activity/sicurezza?days=30 — login falliti per IP/utente ed eventi sugli account
activityRoutes.get('/sicurezza', requireAuth, async (c) => {
  assertAdmin(c.get('user').role);
  const days = daysParam(c.req.query('days'));
  const ex   = excludedUser(c);

  const fallitiIp = await db`
    SELECT coalesce(ip, '—') AS ip, count(*)::int AS tentativi,
           count(DISTINCT lower(username))::int AS utenti, max(created_at) AS ultimo
    FROM audit_log
    WHERE action = 'login_failed' AND created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY 1
    ORDER BY tentativi DESC
    LIMIT 20
  `;
  const fallitiUtente = await db`
    SELECT coalesce(username, '—') AS username, count(*)::int AS tentativi, max(created_at) AS ultimo
    FROM audit_log
    WHERE action = 'login_failed' AND created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    GROUP BY 1
    ORDER BY tentativi DESC
    LIMIT 20
  `;
  const eventi = await db`
    SELECT created_at, username, action, ip, details
    FROM audit_log
    WHERE action IN ('user_created', 'user_updated', 'password_changed', 'change_password_failed',
                     'device_pair_code_generated', 'device_pair_redeem_failed', 'device_login_failed')
      AND created_at >= now() - make_interval(days => ${days})
      AND (${ex}::int IS NULL OR user_id IS DISTINCT FROM ${ex}::int)
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return c.json({ days, fallitiIp, fallitiUtente, eventi });
});
