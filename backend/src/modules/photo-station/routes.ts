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
  j.id::int AS id, j.commessa, j.source, j.status, j.attempts, j.capture_status, j.capture_errors, j.error,
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

const NewJob = z.object({ commessa: z.string().min(1).max(100) });

photoStationRoutes.post('/jobs', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { commessa: raw } = await parseBody(c, NewJob);
  const commessa = normalizeCommessa(raw);
  if (!commessa || commessa.length > 64) throw new HTTPException(400, { message: 'Commessa non valida' });
  const [job] = await db`
    INSERT INTO photo_jobs (commessa, source, created_by)
    VALUES (${commessa}, 'manual', ${user.display_name})
    ON CONFLICT (commessa) WHERE status IN ('pending', 'claimed') DO NOTHING
    RETURNING id::int AS id, commessa, status
  `;
  if (!job) throw new HTTPException(409, { message: `Esiste già un ordine aperto per la commessa ${commessa}` });
  await auditLog({ userId: user.id, username: user.username, action: 'photo_job_create', entity: 'photo_job', entityId: job.id, details: { commessa } });
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
      AND NOT EXISTS (SELECT 1 FROM photo_jobs o WHERE o.commessa = photo_jobs.commessa AND o.status IN ('pending', 'claimed'))
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

// ─── Stazioni: elenco, creazione (token mostrato UNA volta), revoca ───────────────
photoStationRoutes.get('/stations', requireModule('photo_station'), async (c) => {
  const rows = await db`
    SELECT id, name, created_at, last_seen_at, revoked_at,
           (revoked_at IS NULL AND last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS})) AS online
    FROM photo_stations ORDER BY id
  `;
  return c.json({ stations: rows });
});

photoStationRoutes.post('/stations', requireManage('photo_station'), async (c) => {
  const user = c.get('user');
  const { name } = await parseBody(c, z.object({ name: z.string().trim().min(1).max(60) }));
  const { token, hash } = newStationToken();
  const [st] = await db`
    INSERT INTO photo_stations (name, token_hash, created_by) VALUES (${name}, ${hash}, ${user.id}) RETURNING id, name
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'photo_station_create', entity: 'photo_station', entityId: st.id, details: { name } });
  return c.json({ station: st, token }, 201);   // il token non si può rileggere
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

// Chiamata a intervalli (3-5 s): serve anche da "sono vivo" per l'indicatore online.
photoStationDeviceRoutes.post('/claim', async (c) => {
  const st = c.get('station');
  await releaseStaleClaims();
  // Un ordine già suo (l'app si è riavviata a metà): lo riconsegna invece di prenderne un altro.
  let [job] = await db`
    SELECT id::int AS id, commessa FROM photo_jobs WHERE status = 'claimed' AND station_id = ${st.id} ORDER BY id LIMIT 1
  `;
  if (!job) {
    [job] = await db`
      UPDATE photo_jobs SET status = 'claimed', station_id = ${st.id}, claimed_at = now(),
             attempts = attempts + 1, updated_at = now()
      WHERE id = (SELECT id FROM photo_jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id::int AS id, commessa
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
