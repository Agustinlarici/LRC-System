// Photo Station: coda ordini → claim → upload → complete, con DB vero.
// Serve PHOTOSTATION_TEST_DATABASE_URL: un DB con TUTTE le migrazioni (senza la variabile il file è saltato).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.PHOTOSTATION_TEST_DATABASE_URL;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 0xff, 0xd9]);

describe.skipIf(!URL)('Photo Station (integrazione)', () => {
  let app: Hono;
  let db: typeof import('../../../db/client.js').db;
  let helpers: typeof import('../helpers.js');
  let admin: string, guest: string;
  let tok: string, tok2: string;

  const user = (path: string, init: RequestInit = {}, cookie = admin) =>
    app.request(`/api/photo-station${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const station = (path: string, init: RequestInit = {}, token = tok) =>
    app.request(`/api/photo-station/device${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const newJob = async (commessa: string) => (await (await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa }) })).json() as any).job;
  const put = (jobId: number, cam: string, body: Buffer = JPEG, token = tok) =>
    station(`/jobs/${jobId}/photos/${cam}`, { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': 'image/jpeg' } }, token);
  const complete = (jobId: number, body: unknown, token = tok) =>
    station(`/jobs/${jobId}/complete`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, token);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret';
    process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'ps-'));
    db = (await import('../../../db/client.js')).db;
    helpers = await import('../helpers.js');
    const { photoStationRoutes, photoStationDeviceRoutes } = await import('../routes.js');
    const { errorHandler } = await import('../../../middleware/error-handler.js');
    const { signToken, COOKIE_NAME } = await import('../../../lib/auth.js');
    app = new Hono();
    app.route('/api/photo-station/device', photoStationDeviceRoutes);
    app.route('/api/photo-station', photoStationRoutes);
    app.onError(errorHandler);

    await db`DELETE FROM users WHERE username LIKE 'ps_%'`;
    const mk = async (username: string, role: string) =>
      (await db`INSERT INTO users (username, password_hash, display_name, role) VALUES (${username}, 'x', ${username}, ${role}::user_role_enum) RETURNING id`)[0].id as number;
    const a = await mk('ps_admin', 'admin'); const g = await mk('ps_guest', 'guest');
    admin = `${COOKIE_NAME}=${signToken({ id: a, username: 'ps_admin', display_name: 'ps_admin', role: 'admin' })}`;
    guest = `${COOKIE_NAME}=${signToken({ id: g, username: 'ps_guest', display_name: 'ps_guest', role: 'guest' })}`;
  });
  beforeEach(async () => {
    await db`TRUNCATE photo_job_files, photo_jobs, photo_stations RESTART IDENTITY CASCADE`;
    const mkStation = async (name: string) => {
      const { token, hash } = helpers.newStationToken();
      await db`INSERT INTO photo_stations (name, token_hash) VALUES (${name}, ${hash})`;
      return token;
    };
    tok = await mkStation('Camere'); tok2 = await mkStation('Altra');
  });
  afterAll(async () => {
    await db`TRUNCATE photo_job_files, photo_jobs, photo_stations RESTART IDENTITY CASCADE`;
    await db`DELETE FROM users WHERE username LIKE 'ps_%'`;
  });

  it('percorso completo: ordine → claim → upload → complete', async () => {
    const job = await newJob('ORD-1');
    expect(job.status).toBe('pending');
    const claim = await (await station('/claim', { method: 'POST' })).json() as any;
    expect(claim.job).toMatchObject({ id: job.id, commessa: 'ORD-1' });

    const up = await (await put(job.id, 'CAM01')).json() as any;
    expect(up.sha256).toBe(helpers.sha256Hex(JPEG));
    const done = await complete(job.id, { status: 'ok', photos: [{ camera: 'CAM01', sha256: up.sha256 }] });
    expect(done.status).toBe(200);

    const detail = await (await user(`/jobs/${job.id}`)).json() as any;
    expect(detail.job.status).toBe('captured');
    expect(detail.files).toHaveLength(1);
    const img = await user(`/jobs/${job.id}/files/${detail.files[0].id}`);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('niente ordine → claim vuoto', async () => {
    expect((await (await station('/claim', { method: 'POST' })).json() as any).job).toBeNull();
  });

  it('due stazioni non prendono lo stesso ordine', async () => {
    await newJob('ORD-2');
    const [a, b] = await Promise.all([station('/claim', { method: 'POST' }, tok), station('/claim', { method: 'POST' }, tok2)]);
    const jobs = [(await a.json() as any).job, (await b.json() as any).job];
    expect(jobs.filter(Boolean)).toHaveLength(1);
  });

  it('la stessa stazione riceve di nuovo il suo ordine (riavvio a metà)', async () => {
    const job = await newJob('ORD-3');
    const c1 = await (await station('/claim', { method: 'POST' })).json() as any;
    const c2 = await (await station('/claim', { method: 'POST' })).json() as any;
    expect(c1.job.id).toBe(c2.job.id);
    expect(c1.job.id).toBe(job.id);
    const [row] = await db`SELECT attempts FROM photo_jobs WHERE id = ${job.id}`;
    expect(row.attempts).toBe(1);
  });

  it('una sola commessa aperta alla volta (409), ma si può rifare dopo la chiusura', async () => {
    const job = await newJob('ORD-4');
    const dup = await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: ' ORD-4\r\n' }) });
    expect(dup.status).toBe(409);
    expect((await user(`/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'ORD-4' }) })).status).toBe(201);
  });

  it('complete con una foto non arrivata o diversa → 409 e ordine ancora aperto', async () => {
    const job = await newJob('ORD-5');
    await station('/claim', { method: 'POST' });
    await put(job.id, 'CAM01');
    const r = await complete(job.id, { status: 'ok', photos: [{ camera: 'CAM01', sha256: 'a'.repeat(64) }, { camera: 'CAM02', sha256: helpers.sha256Hex(JPEG) }] });
    expect(r.status).toBe(409);
    expect((await r.json() as any).missing).toEqual(['CAM01', 'CAM02']);
    expect((await db`SELECT status FROM photo_jobs WHERE id = ${job.id}`)[0].status).toBe('claimed');
  });

  it('upload: rifiuta non-JPEG, JPEG tagliato, nome camera col percorso, ordine altrui', async () => {
    const job = await newJob('ORD-6');
    await station('/claim', { method: 'POST' });
    expect((await put(job.id, 'CAM01', Buffer.from('<html>'))).status).toBe(400);
    expect((await put(job.id, 'CAM01', JPEG.subarray(0, 8))).status).toBe(400);
    expect((await put(job.id, '..%2Fx')).status).toBe(400);
    expect((await put(job.id, 'CAM01', JPEG, tok2)).status).toBe(409);
  });

  it('senza token valido (o revocato) la rotta stazione è chiusa', async () => {
    expect((await app.request('/api/photo-station/device/claim', { method: 'POST' })).status).toBe(401);
    expect((await station('/claim', { method: 'POST' }, 'f'.repeat(64))).status).toBe(401);
    await db`UPDATE photo_stations SET revoked_at = now()`;
    expect((await station('/claim', { method: 'POST' })).status).toBe(401);
  });

  it('permessi: il guest non vede né crea; il token stazione non apre le rotte utente', async () => {
    expect((await user('/jobs', {}, guest)).status).toBe(403);
    expect((await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'X' }) }, guest)).status).toBe(403);
    expect((await app.request('/api/photo-station/jobs', { headers: { authorization: `Bearer ${tok}` } })).status).toBe(401);
  });

  it('ordine preso da una stazione sparita: torna in coda, dopo 3 tentativi fallisce', async () => {
    const job = await newJob('ORD-7');
    for (let i = 1; i <= 3; i++) {
      const c = await (await station('/claim', { method: 'POST' }, i % 2 ? tok : tok2)).json() as any;
      expect(c.job.id).toBe(job.id);
      await db`UPDATE photo_jobs SET claimed_at = now() - interval '10 minutes' WHERE id = ${job.id}`;
    }
    await station('/claim', { method: 'POST' });
    const [row] = await db`SELECT status, error FROM photo_jobs WHERE id = ${job.id}`;
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect((await user(`/jobs/${job.id}/retry`, { method: 'POST' })).status).toBe(200);
    expect((await db`SELECT status, attempts FROM photo_jobs WHERE id = ${job.id}`)[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('crea stazione: il token si vede una sola volta e nel DB c\'è solo l\'hash', async () => {
    const r = await (await user('/stations', { method: 'POST', body: JSON.stringify({ name: 'Nuova' }) })).json() as any;
    expect(r.token).toHaveLength(64);
    const [row] = await db`SELECT token_hash FROM photo_stations WHERE id = ${r.station.id}`;
    expect(row.token_hash).toBe(helpers.sha256Hex(r.token));
    const list = JSON.stringify(await (await user('/stations')).json());
    expect(list).not.toContain(r.token);
    expect(list).not.toContain(row.token_hash);
  });

  it('fail: la stazione chiude l\'ordine con il motivo', async () => {
    const job = await newJob('ORD-8');
    await station('/claim', { method: 'POST' });
    const r = await station(`/jobs/${job.id}/fail`, { method: 'POST', body: JSON.stringify({ error: 'Nessuna camera' }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    expect((await db`SELECT status, error FROM photo_jobs WHERE id = ${job.id}`)[0]).toMatchObject({ status: 'failed', error: 'Nessuna camera' });
  });
});
