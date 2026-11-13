// Photo Station: coda degli ordini di foto (vedi docs/PHOTO-STATION.md).
// Flusso: ordine creato (a mano o da iKnow) → la PC Camere lo prende (claim) → scatta →
// carica ogni foto → chiude l'ordine (complete). La PC Camere chiama la VM, mai il contrario.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';
import { requireModule, requireManage, type Env } from '../../lib/auth.js';
import { requireStation, type StationEnv } from './station-auth.js';
import { activePhaseRules, matchPhase } from './events.js';
import { lastRun } from './feed.js';
import { ignoredApiCalls } from './iknow.js';
import {
  CAMERA_RE, MAX_ATTEMPTS, MAX_PHOTO_BYTES, STALE_CLAIM_MINUTES,
  isJpeg, newStationToken, normalizeCommessa, sha256Hex,
} from './helpers.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? join(process.env.UPLOAD_DIR, 'photo-station')
  : join(process.cwd(), 'uploads', 'photo-station');

const ONLINE_SECONDS = 30;

function idParam(raw: string | undefined, label = 'ID'): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HTTPException(400, { message: `${label} non valido` });
  return n;
}

// ═══ Lato utenti (interfaccia web) ═══════════════════════════════════════════════
export const photoStationRoutes = new Hono<Env & StationEnv>();

const JOB_COLS = db`
  j.id::int AS id, j.commessa, j.phase, j.seriale, j.componente, j.versione, j.event_at, j.source, j.status, j.attempts, j.capture_status, j.capture_errors, j.error,
  j.created_by, j.created_at, j.claimed_at, j.finished_at, s.name AS station_name,
  (SELECT count(*)::int FROM photo_job_files f WHERE f.job_id = j.id) AS photos
`;

photoStationRoutes.get('/jobs', requireModule('photo_station'), async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const jobs = await db`
    SELECT ${JOB_COLS} FROM photo_jobs j LEFT JOIN photo_stations s ON s.id = j.station_id
    ORDER BY j.id DESC LIMIT ${limit}
  `;
  return c.json({ jobs });
});

photoStationRoutes.get('/jobs/:id', requireModule('photo_station'), async (c) => {
  const id = idParam(c.req.param('id'));
  const [job] = await db`
    SELECT ${JOB_COLS} FROM photo_jobs j LEFT JOIN photo_stations s ON s.id = j.station_id WHERE j.id = ${id}
  `;
  if (!job) throw new HTTPException(404, { message: 'Ordine non trovato' });
  const files = await db`SELECT id, camera, bytes, sha256, created_at FROM photo_job_files WHERE job_id = ${id} ORDER BY camera`;
  return c.json({ job, files });
});

const PHASE = z.string().regex(/^[a-z0-9_]{1,40}$/, 'fase non valida (minuscole, numeri, _)');
const NewJob = z.object({ commessa: z.string().min(1).max(100), phase: PHASE });

// ─── Integrazione iKnow: token concordato con l'azienda (mai riletto, solo l'hash) ─────
photoStationRoutes.get('/iknow', requireModule('photo_station'), async (c) => {
  const [cfg] = await db`SELECT updated_at, updated_by FROM photo_iknow_config WHERE id = 1`;
  const [last] = await db`SELECT max(created_at) AS last_call_at FROM photo_jobs WHERE source = 'iknow'`;
  return c.json({ configured: !!cfg, updated_at: cfg?.updated_at ?? null, updated_by: cfg?.updated_by ?? null, last_call_at: last?.last_call_at ?? null });
});

photoStationRoutes.put('/iknow-token', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { token } = await parseBody(c, z.object({ token: z.string().regex(/^[\x21-\x7e]{16,200}$/, 'token: 16-200 caratteri, senza spazi') }));
  await db`
    INSERT INTO photo_iknow_config (id, token_hash, updated_by) VALUES (1, ${sha256Hex(token)}, ${user.display_name})
    ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'photo_iknow_token_set', entity: 'photo_iknow' });   // mai il token
  return c.json({ ok: true });
});

// ─── Alimentatore dalla copia del DB di iKnow (provvisorio, finché non c'è l'API) ───────
photoStationRoutes.get('/feed', requireModule('photo_station'), async (c) => {
  const [cfg] = await db`SELECT mode, esiti_ok, enabled_since, updated_by FROM photo_feed_config WHERE id = 1`;
  // Esiti realmente presenti nelle fasi del catalogo (ultimi 7 giorni), per sceglierli senza indovinare
  const rules = await activePhaseRules();
  const names = (await db`
    SELECT fase, esito_delibera, count(*)::int AS n FROM webthron_events_history
    WHERE data_cache >= CURRENT_DATE - 7 AND esito_delibera IS NOT NULL GROUP BY fase, esito_delibera
  `).filter(r => matchPhase(rules, r.fase as string) !== null);
  const esiti_visti = [...new Set(names.map(r => r.esito_delibera as string))].sort();
  return c.json({
    mode: cfg?.mode ?? 'off', esiti_ok: cfg?.esiti_ok ?? [], enabled_since: cfg?.enabled_since ?? null,
    esiti_visti, last_run: lastRun, ignored_api_calls: ignoredApiCalls,
  });
});

photoStationRoutes.put('/feed', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { mode, esiti_ok } = await parseBody(c, z.object({
    mode: z.enum(['off', 'db', 'api']), esiti_ok: z.array(z.string().trim().min(1).max(200)).max(20),
  }));
  if (mode === 'db' && esiti_ok.length === 0) throw new HTTPException(400, { message: "Indica almeno un esito che vale come 'accettata'" });
  if (mode === 'api') {
    const [tok] = await db`SELECT 1 FROM photo_iknow_config WHERE id = 1`;
    if (!tok) throw new HTTPException(400, { message: 'Carica prima il token di iKnow' });
  }
  // enabled_since si fissa quando si passa a 'db': lo storico precedente non viene mai fotografato
  await db`
    INSERT INTO photo_feed_config (id, mode, enabled, esiti_ok, enabled_since, updated_by)
    VALUES (1, ${mode}, ${mode === 'db'}, ${esiti_ok}, ${mode === 'db' ? new Date() : null}, ${user.display_name})
    ON CONFLICT (id) DO UPDATE SET
      enabled_since = CASE WHEN EXCLUDED.mode = 'db' AND photo_feed_config.mode <> 'db' THEN now()
                           WHEN EXCLUDED.mode = 'db' THEN photo_feed_config.enabled_since ELSE NULL END,
      mode = EXCLUDED.mode, enabled = (EXCLUDED.mode = 'db'), esiti_ok = EXCLUDED.esiti_ok,
      updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'photo_feed_set', entity: 'photo_feed', details: { mode, esiti_ok } });
  return c.json({ ok: true });
});

// ─── Fasi (arrivano da iKnow): catalogo, ognuna con le sue stazioni ───────────────
photoStationRoutes.get('/phases', requireModule('photo_station'), async (c) => {
  const phases = await db`SELECT key, label, iknow_fase, active FROM photo_phases ORDER BY key`;
  return c.json({ phases });
});

photoStationRoutes.post('/phases', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { key, label, iknow_fase } = await parseBody(c, z.object({ key: PHASE, label: z.string().trim().min(1).max(80), iknow_fase: z.string().trim().max(80).optional() }));
  const [p] = await db`INSERT INTO photo_phases (key, label, iknow_fase) VALUES (${key}, ${label}, ${iknow_fase || null}) ON CONFLICT (key) DO NOTHING RETURNING key`;
  if (!p) throw new HTTPException(409, { message: 'Fase già esistente' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_phase_create', entity: 'photo_phase', entityId: key, details: { label, iknow_fase } });
  return c.json({ ok: true }, 201);
});

photoStationRoutes.put('/phases/:key', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const key = c.req.param('key') ?? '';
  const { active } = await parseBody(c, z.object({ active: z.boolean() }));
  const [p] = await db`UPDATE photo_phases SET active = ${active} WHERE key = ${key} RETURNING key`;
  if (!p) throw new HTTPException(404, { message: 'Fase non trovata' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_phase_active', entity: 'photo_phase', entityId: key, details: { active } });
  return c.json({ ok: true });
});

photoStationRoutes.post('/jobs', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { commessa: raw, phase } = await parseBody(c, NewJob);
  const commessa = normalizeCommessa(raw);
  if (!commessa || commessa.length > 64) throw new HTTPException(400, { message: 'Commessa non valida' });
  const [known] = await db`SELECT 1 FROM photo_phases WHERE key = ${phase} AND active`;
  if (!known) throw new HTTPException(400, { message: `Fase '${phase}' sconosciuta o disattivata` });
  const [job] = await db`
    INSERT INTO photo_jobs (commessa, phase, source, created_by)
    VALUES (${commessa}, ${phase}, 'manual', ${user.display_name})
    ON CONFLICT (commessa, phase, COALESCE(seriale, ''), COALESCE(componente, '')) WHERE status IN ('pending', 'claimed') DO NOTHING
    RETURNING id::int AS id, commessa, phase, status
  `;
  if (!job) throw new HTTPException(409, { message: `Esiste già un ordine aperto per la commessa ${commessa} nella fase ${phase}` });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_job_create', entity: 'photo_job', entityId: job.id, details: { commessa, phase } });
  return c.json({ job }, 201);
});

photoStationRoutes.post('/jobs/:id/cancel', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const id = idParam(c.req.param('id'));
  const [job] = await db`
    UPDATE photo_jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
    WHERE id = ${id} AND status IN ('pending', 'claimed') RETURNING id
  `;
  if (!job) throw new HTTPException(409, { message: 'Ordine non annullabile (già concluso o inesistente)' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_job_cancel', entity: 'photo_job', entityId: id });
  return c.json({ ok: true });
});

photoStationRoutes.post('/jobs/:id/retry', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const id = idParam(c.req.param('id'));
  const [job] = await db`
    UPDATE photo_jobs SET status = 'pending', attempts = 0, error = NULL, station_id = NULL, claimed_at = NULL,
           finished_at = NULL, updated_at = now()
    WHERE id = ${id} AND status IN ('failed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM photo_jobs o WHERE o.commessa = photo_jobs.commessa AND o.phase = photo_jobs.phase AND COALESCE(o.seriale, '') = COALESCE(photo_jobs.seriale, '') AND COALESCE(o.componente, '') = COALESCE(photo_jobs.componente, '') AND o.status IN ('pending', 'claimed'))
    RETURNING id
  `;
  if (!job) throw new HTTPException(409, { message: 'Ordine non rilanciabile (non fallito/annullato, o esiste già un ordine aperto per la commessa)' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_job_retry', entity: 'photo_job', entityId: id });
  return c.json({ ok: true });
});

photoStationRoutes.get('/jobs/:id/files/:fileId', requireModule('photo_station'), async (c) => {
  const id = idParam(c.req.param('id'));
  const fileId = idParam(c.req.param('fileId'), 'File');
  const [f] = await db`SELECT filename FROM photo_job_files WHERE id = ${fileId} AND job_id = ${id}`;
  if (!f) throw new HTTPException(404, { message: 'Foto non trovata' });
  const data = await readFile(join(UPLOAD_DIR, String(id), f.filename)).catch(() => null);
  if (!data) throw new HTTPException(404, { message: 'File non trovato sul disco' });
  c.header('Content-Type', 'image/jpeg');
  c.header('Cache-Control', 'private, max-age=3600');
  return c.body(new Uint8Array(data));
});

// ─── Stazioni: elenco, creazione (token mostrato UNA volta), fasi servite, revoca ──
const StationBody = z.object({ name: z.string().trim().min(1).max(60), phases: z.array(PHASE).max(20).default([]) });

async function assertPhasesExist(phases: string[]) {
  if (phases.length === 0) return;
  const found = await db`SELECT key FROM photo_phases WHERE key IN ${db(phases)}`;
  const bad = phases.filter(p => !found.some(f => f.key === p));
  if (bad.length) throw new HTTPException(400, { message: `Fasi sconosciute: ${bad.join(', ')}` });
}
photoStationRoutes.get('/stations', requireModule('photo_station'), async (c) => {
  const rows = await db`
    SELECT id, name, phases, created_at, last_seen_at, revoked_at,
           (revoked_at IS NULL AND last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS})) AS online
    FROM photo_stations ORDER BY id
  `;
  return c.json({ stations: rows });
});

photoStationRoutes.post('/stations', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { name, phases } = await parseBody(c, StationBody);
  await assertPhasesExist(phases);
  const { token, hash } = newStationToken();
  const [st] = await db`
    INSERT INTO photo_stations (name, token_hash, phases, created_by) VALUES (${name}, ${hash}, ${phases}, ${user.id}) RETURNING id, name, phases
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'photo_station_create', entity: 'photo_station', entityId: st.id, details: { name, phases } });
  return c.json({ station: st, token }, 201);   // il token non si può rileggere
});

photoStationRoutes.put('/stations/:id/phases', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const id = idParam(c.req.param('id'));
  const { phases } = await parseBody(c, z.object({ phases: z.array(PHASE).max(20) }));
  await assertPhasesExist(phases);
  const [st] = await db`UPDATE photo_stations SET phases = ${phases} WHERE id = ${id} AND revoked_at IS NULL RETURNING id`;
  if (!st) throw new HTTPException(404, { message: 'Stazione non trovata o revocata' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_station_phases', entity: 'photo_station', entityId: id, details: { phases } });
  return c.json({ ok: true });
});

photoStationRoutes.post('/stations/:id/revoke', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const id = idParam(c.req.param('id'));
  const [st] = await db`UPDATE photo_stations SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING id`;
  if (!st) throw new HTTPException(404, { message: 'Stazione non trovata o già revocata' });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_station_revoke', entity: 'photo_station', entityId: id });
  return c.json({ ok: true });
});

// ═══ Lato stazione (PC Camere) — solo token Bearer ═══════════════════════════════
export const photoStationDeviceRoutes = new Hono<StationEnv>();
photoStationDeviceRoutes.use('*', requireStation);

// Libera gli ordini presi da una stazione sparita: riprova, oppure fallisce dopo MAX_ATTEMPTS.
async function releaseStaleClaims() {
  await db`
    UPDATE photo_jobs
    SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
        error  = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'La stazione non ha concluso l''ordine' ELSE error END,
        finished_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() ELSE finished_at END,
        station_id = NULL, updated_at = now()
    WHERE status = 'claimed' AND claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
  `;
}

// Prende solo ordini delle fasi abilitate a questa stazione.
// Chiamata a intervalli (3-5 s): serve anche da "sono vivo" per l'indicatore online.
photoStationDeviceRoutes.post('/claim', async (c) => {
  const st = c.get('station');
  await releaseStaleClaims();
  // Un ordine già suo (l'app si è riavviata a metà): lo riconsegna invece di prenderne un altro.
  let [job] = await db`
    SELECT id::int AS id, commessa, phase, seriale, componente, versione FROM photo_jobs WHERE status = 'claimed' AND station_id = ${st.id} ORDER BY id LIMIT 1
  `;
  if (!job) {
    [job] = await db`
      UPDATE photo_jobs SET status = 'claimed', station_id = ${st.id}, claimed_at = now(),
             attempts = attempts + 1, updated_at = now()
      WHERE id = (SELECT id FROM photo_jobs WHERE status = 'pending' AND phase = ANY(${st.phases}::text[]) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id::int AS id, commessa, phase, seriale, componente, versione
    `;
  }
  return c.json({ job: job ?? null });
});

async function ownJob(jobId: number, stationId: number) {
  const [job] = await db`SELECT id, status, station_id FROM photo_jobs WHERE id = ${jobId}`;
  if (!job) throw new HTTPException(404, { message: 'Ordine non trovato' });
  if (job.station_id !== stationId || job.status !== 'claimed') {
    throw new HTTPException(409, { message: 'Ordine non assegnato a questa stazione (annullato o scaduto)' });
  }
  return job;
}

// Foto grezza nel body (image/jpeg). Il server calcola l'hash: la stazione lo confronta col suo.
photoStationDeviceRoutes.put('/jobs/:id/photos/:camera', async (c) => {
  const st = c.get('station');
  const id = idParam(c.req.param('id'));
  const camera = c.req.param('camera');
  if (!CAMERA_RE.test(camera)) throw new HTTPException(400, { message: 'Nome camera non valido' });
  const declared = Number(c.req.header('Content-Length') ?? 0);
  if (declared > MAX_PHOTO_BYTES) throw new HTTPException(413, { message: 'Foto troppo grande' });
  await ownJob(id, st.id);

  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) throw new HTTPException(413, { message: 'Foto troppo grande' });
  if (!isJpeg(buf)) throw new HTTPException(400, { message: 'Il file non è un JPEG valido' });

  const dir = join(UPLOAD_DIR, String(id));
  await mkdir(dir, { recursive: true });
  const filename = `${camera}.jpg`;
  const tmp = join(dir, `${filename}.tmp`);
  await writeFile(tmp, buf);
  await rename(tmp, join(dir, filename));
  const sha = sha256Hex(buf);
  await db`
    INSERT INTO photo_job_files (job_id, camera, filename, bytes, sha256)
    VALUES (${id}, ${camera}, ${filename}, ${buf.length}, ${sha})
    ON CONFLICT (job_id, camera) DO UPDATE SET filename = EXCLUDED.filename, bytes = EXCLUDED.bytes,
      sha256 = EXCLUDED.sha256, created_at = now()
  `;
  return c.json({ ok: true, bytes: buf.length, sha256: sha });
});

const Complete = z.object({
  status: z.enum(['ok', 'partial', 'failed']),
  photos: z.array(z.object({ camera: z.string().regex(CAMERA_RE), sha256: z.string().length(64) })).max(32),
  errors: z.array(z.object({ camera: z.string().max(40), error: z.string().max(300) })).max(32).default([]),
});

// Chiude l'ordine: ogni foto dichiarata deve essere arrivata intera (stesso hash). Altrimenti 409
// con l'elenco di quelle da ricaricare: l'ordine resta aperto.
photoStationDeviceRoutes.post('/jobs/:id/complete', async (c) => {
  const st = c.get('station');
  const id = idParam(c.req.param('id'));
  await ownJob(id, st.id);
  const body = await parseBody(c, Complete);

  const stored = await db`SELECT camera, sha256 FROM photo_job_files WHERE job_id = ${id}`;
  const have = new Map<string, string>(stored.map(r => [r.camera as string, (r.sha256 as string).trim()]));
  const missing = body.photos.filter(p => have.get(p.camera) !== p.sha256).map(p => p.camera);
  if (missing.length) {
    return c.json({ message: 'Foto mancanti o incomplete: ricaricarle', missing }, 409);
  }
  const ok = body.status !== 'failed' && body.photos.length > 0;
  await db`
    UPDATE photo_jobs
    SET status = ${ok ? 'captured' : 'failed'}, capture_status = ${body.status},
        capture_errors = ${db.json(body.errors)},
        error = ${ok ? null : (body.errors[0]?.error ?? 'Nessuna foto acquisita')},
        finished_at = now(), updated_at = now()
    WHERE id = ${id}
  `;
  return c.json({ ok: true, status: ok ? 'captured' : 'failed' });
});

// La stazione non può nemmeno provare (es. nessuna camera): ordine fallito con il motivo.
photoStationDeviceRoutes.post('/jobs/:id/fail', async (c) => {
  const st = c.get('station');
  const id = idParam(c.req.param('id'));
  await ownJob(id, st.id);
  const { error } = await parseBody(c, z.object({ error: z.string().trim().min(1).max(300) }));
  await db`UPDATE photo_jobs SET status = 'failed', error = ${error}, finished_at = now(), updated_at = now() WHERE id = ${id}`;
  return c.json({ ok: true });
});
