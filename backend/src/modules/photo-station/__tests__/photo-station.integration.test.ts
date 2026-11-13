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
  let tok: string, tok2: string, tok3: string;

  const user = (path: string, init: RequestInit = {}, cookie = admin) =>
    app.request(`/api/photo-station${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const station = (path: string, init: RequestInit = {}, token = tok) =>
    app.request(`/api/photo-station/device${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const newJob = async (commessa: string, phase = 'delibera_finale') => (await (await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa, phase }) })).json() as any).job;
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
    const { iknowRoutes } = await import('../iknow.js');
    app.route('/api/delibere', iknowRoutes);
    app.onError(errorHandler);

    await db`DELETE FROM users WHERE username LIKE 'ps_%'`;
    const mk = async (username: string, role: string) =>
      (await db`INSERT INTO users (username, password_hash, display_name, role) VALUES (${username}, 'x', ${username}, ${role}::user_role_enum) RETURNING id`)[0].id as number;
    const a = await mk('ps_admin', 'admin'); const g = await mk('ps_guest', 'guest');
    admin = `${COOKIE_NAME}=${signToken({ id: a, username: 'ps_admin', display_name: 'ps_admin', role: 'admin' })}`;
    guest = `${COOKIE_NAME}=${signToken({ id: g, username: 'ps_guest', display_name: 'ps_guest', role: 'guest' })}`;
  });
  beforeEach(async () => {
    await db`TRUNCATE photo_job_files, photo_jobs, photo_stations, photo_phases, photo_iknow_config, photo_feed_config RESTART IDENTITY CASCADE`;
    await db`DELETE FROM webthron_events_history WHERE cod_seriale LIKE 'TST%'`;
    await db`INSERT INTO photo_phases (key, label) VALUES ('delibera_finale', 'Delibera finale'), ('delibera_finale_proximiti', 'Delibera finale Proximiti')`;
    const mkStation = async (name: string, phases: string[]) => {
      const { token, hash } = helpers.newStationToken();
      await db`INSERT INTO photo_stations (name, token_hash, phases) VALUES (${name}, ${hash}, ${phases})`;
      return token;
    };
    // Entrambe servono 'delibera_finale' (come due PC in competizione); tok3 serve solo Proximiti
    tok = await mkStation('Camere', ['delibera_finale']); tok2 = await mkStation('Altra', ['delibera_finale']);
    tok3 = await mkStation('Proximiti', ['delibera_finale_proximiti']);
  });
  afterAll(async () => {
    await db`TRUNCATE photo_job_files, photo_jobs, photo_stations, photo_phases, photo_iknow_config, photo_feed_config RESTART IDENTITY CASCADE`;
    await db`DELETE FROM webthron_events_history WHERE cod_seriale LIKE 'TST%'`;
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
    const dup = await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: ' ORD-4\r\n', phase: 'delibera_finale' }) });
    expect(dup.status).toBe(409);
    expect((await user(`/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'ORD-4', phase: 'delibera_finale' }) })).status).toBe(201);
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
    expect((await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'X', phase: 'delibera_finale' }) }, guest)).status).toBe(403);
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
    const r = await (await user('/stations', { method: 'POST', body: JSON.stringify({ name: 'Nuova', phases: ['delibera_finale'] }) })).json() as any;
    expect(r.token).toHaveLength(64);
    const [row] = await db`SELECT token_hash FROM photo_stations WHERE id = ${r.station.id}`;
    expect(row.token_hash).toBe(helpers.sha256Hex(r.token));
    const list = JSON.stringify(await (await user('/stations')).json());
    expect(list).not.toContain(r.token);
    expect(list).not.toContain(row.token_hash);
  });

  it('ogni fase ha le sue stazioni: una stazione non prende ordini di altre fasi', async () => {
    const a = await newJob('ORD-9', 'delibera_finale');
    const b = await newJob('ORD-9', 'delibera_finale_proximiti');   // stessa commessa, altra fase: ammesso
    expect(b.id).not.toBe(a.id);
    const prox = await (await station('/claim', { method: 'POST' }, tok3)).json() as any;
    expect(prox.job).toMatchObject({ id: b.id, phase: 'delibera_finale_proximiti' });
    expect((await (await station('/claim', { method: 'POST' }, tok3)).json() as any).job.id).toBe(b.id);   // il suo, non quello di tok
    const main = await (await station('/claim', { method: 'POST' }, tok)).json() as any;
    expect(main.job).toMatchObject({ id: a.id, phase: 'delibera_finale' });
    // la stazione Proximiti non può caricare foto dell'ordine dell'altra fase
    expect((await put(a.id, 'CAM01', JPEG, tok3)).status).toBe(409);
  });

  it('una stazione senza fasi non prende niente', async () => {
    await newJob('ORD-10');
    const { token, hash } = helpers.newStationToken();
    await db`INSERT INTO photo_stations (name, token_hash) VALUES ('vuota', ${hash})`;
    expect((await (await station('/claim', { method: 'POST' }, token)).json() as any).job).toBeNull();
  });

  it('fase sconosciuta o disattivata → 400; fasi della stazione modificabili', async () => {
    const bad = await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'Z1', phase: 'inventata' }) });
    expect(bad.status).toBe(400);
    expect((await user('/phases/delibera_finale', { method: 'PUT', body: JSON.stringify({ active: false }) })).status).toBe(200);
    expect((await user('/jobs', { method: 'POST', body: JSON.stringify({ commessa: 'Z1', phase: 'delibera_finale' }) })).status).toBe(400);
    expect((await user('/stations', { method: 'POST', body: JSON.stringify({ name: 'X', phases: ['non_esiste'] }) })).status).toBe(400);
    const [st] = await db`SELECT id FROM photo_stations WHERE name = 'Camere'`;
    expect((await user(`/stations/${st.id}/phases`, { method: 'PUT', body: JSON.stringify({ phases: ['delibera_finale_proximiti'] }) })).status).toBe(200);
    expect((await db`SELECT phases FROM photo_stations WHERE id = ${st.id}`)[0].phases).toEqual(['delibera_finale_proximiti']);
  });

  it('creare una fase: solo chi gestisce; duplicato → 409', async () => {
    expect((await user('/phases', { method: 'POST', body: JSON.stringify({ key: 'nuova_fase', label: 'Nuova' }) })).status).toBe(201);
    expect((await user('/phases', { method: 'POST', body: JSON.stringify({ key: 'nuova_fase', label: 'Nuova' }) })).status).toBe(409);
    expect((await user('/phases', { method: 'POST', body: JSON.stringify({ key: 'Mala Fase', label: 'x' }) })).status).toBe(400);
    expect((await user('/phases', { method: 'POST', body: JSON.stringify({ key: 'altra', label: 'x' }) }, guest)).status).toBe(403);
  });

  it('fail: la stazione chiude l\'ordine con il motivo', async () => {
    const job = await newJob('ORD-8');
    await station('/claim', { method: 'POST' });
    const r = await station(`/jobs/${job.id}/fail`, { method: 'POST', body: JSON.stringify({ error: 'Nessuna camera' }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    expect((await db`SELECT status, error FROM photo_jobs WHERE id = ${job.id}`)[0]).toMatchObject({ status: 'failed', error: 'Nessuna camera' });
  });

  // ─── Chiamata di iKnow: POST /api/delibere/accettate ─────────────────────────────
  const IK_TOKEN = 'token-di-prova-iknow-1234';
  const body = (over: Record<string, unknown> = {}) => ({
    seriale: '123456789', commessa: '000000', fase: 'delibera_finale', componente: 'COMP-001', versione: 'DX',
    data_ora: '2026-10-27 10:00:00+01:00', ...over,
  });
  const iknow = (payload: unknown, token: string | null = IK_TOKEN) =>
    app.request('/api/delibere/accettate', {
      method: 'POST', body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  const setToken = async () => {
    const r = await user('/iknow-token', { method: 'PUT', body: JSON.stringify({ token: IK_TOKEN }) });
    await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'api', esiti_ok: [] }) });   // origine = API
    return r;
  };

  it('iKnow: senza token configurato 503; token errato o assente 401', async () => {
    expect((await iknow(body())).status).toBe(503);
    expect((await setToken()).status).toBe(200);
    expect((await iknow(body(), 'token-sbagliato-0000000')).status).toBe(401);
    expect((await iknow(body(), null)).status).toBe(401);
    expect((await db`SELECT count(*)::int AS n FROM photo_jobs`)[0].n).toBe(0);
  });

  it('iKnow: chiamata valida → 200 e ordine in coda con i dati attesi (commessa con zeri)', async () => {
    await setToken();
    const r = await iknow(body());
    expect(r.status).toBe(200);
    expect((await r.json() as any).result).toBe('created');
    const [j] = await db`SELECT commessa, phase, source, seriale, componente, versione, status, event_at FROM photo_jobs`;
    expect(j).toMatchObject({ commessa: '000000', phase: 'delibera_finale', source: 'iknow', seriale: '123456789', componente: 'COMP-001', versione: 'DX', status: 'pending' });
    expect(new Date(j.event_at).toISOString()).toBe('2026-10-27T09:00:00.000Z');
    const claim = await (await station('/claim', { method: 'POST' })).json() as any;
    expect(claim.job).toMatchObject({ commessa: '000000', seriale: '123456789', componente: 'COMP-001', versione: 'DX' });
  });

  it('iKnow: la stessa chiamata riprovata non crea un doppione (200 anche così)', async () => {
    await setToken();
    await iknow(body());
    const again = await iknow(body());
    expect(again.status).toBe(200);
    expect((await again.json() as any).result).toBe('duplicate');
    // stesso seriale+componente con altra data_ora mentre il primo è ancora aperto: niente doppione e niente 500
    expect((await iknow(body({ data_ora: '2026-10-27 10:05:00+01:00' }))).status).toBe(200);
    expect((await db`SELECT count(*)::int AS n FROM photo_jobs`)[0].n).toBe(1);
  });

  it('iKnow: seriali o componenti diversi della stessa commessa sono ordini distinti', async () => {
    await setToken();
    await iknow(body()); await iknow(body({ seriale: '999' })); await iknow(body({ componente: 'COMP-002' }));
    expect((await db`SELECT count(*)::int AS n FROM photo_jobs`)[0].n).toBe(3);
  });

  it('iKnow: fase sconosciuta → 200, ordine messo da parte con il motivo; dopo averla creata si rilancia', async () => {
    await setToken();
    const r = await iknow(body({ fase: 'Nuova Fase' }));
    expect(r.status).toBe(200);
    expect((await r.json() as any).result).toBe('phase_unknown');
    const [j] = await db`SELECT id, status, error FROM photo_jobs`;
    expect(j.status).toBe('cancelled');
    expect(j.error).toContain('nuova_fase');
    await user('/phases', { method: 'POST', body: JSON.stringify({ key: 'nuova_fase', label: 'Nuova' }) });
    expect((await user(`/jobs/${j.id}/retry`, { method: 'POST' })).status).toBe(200);
    expect((await db`SELECT status FROM photo_jobs WHERE id = ${j.id}`)[0].status).toBe('pending');
  });

  it('iKnow: corpo non valido → 400', async () => {
    await setToken();
    expect((await iknow({ ...body(), seriale: undefined })).status).toBe(400);
    expect((await iknow(body({ data_ora: 'ieri' }))).status).toBe(400);
    expect((await iknow(body({ fase: '!!!' }))).status).toBe(400);
    expect((await app.request('/api/delibere/accettate', { method: 'POST', body: 'no json', headers: { authorization: `Bearer ${IK_TOKEN}` } })).status).toBe(400);
  });

  it('iKnow: il token solo lo cambia chi gestisce, e non si rilegge', async () => {
    expect((await user('/iknow-token', { method: 'PUT', body: JSON.stringify({ token: IK_TOKEN }) }, guest)).status).toBe(403);
    expect((await user('/iknow-token', { method: 'PUT', body: JSON.stringify({ token: 'corto' }) })).status).toBe(400);
    await setToken();
    const st = JSON.stringify(await (await user('/iknow')).json());
    expect(st).toContain('"configured":true');
    expect(st).not.toContain(IK_TOKEN);
  });

  // ─── Alimentatore dalla copia del DB di iKnow ───────────────────────────────────
  const hist = (over: Record<string, unknown> = {}) => db`
    INSERT INTO webthron_events_history (fase, modello, componente, cod_seriale, commessa, versione, esito_delibera, data_inserimento, data_cache)
    VALUES (${(over.fase as string) ?? 'DELIBERA FINALE'}, 'M1', ${(over.componente as string) ?? 'COMP-001'}, ${(over.seriale as string) ?? 'TST1'},
            ${(over.commessa as string | null) === null ? null : ((over.commessa as string) ?? '000111')}, ${(over.versione as string) ?? 'DX'},
            ${(over.esito as string) ?? 'ACCETTATA'}, ${(over.at as Date) ?? new Date()}, CURRENT_DATE)`;
  const feedOn = async (esiti = ['ACCETTATA']) => {
    const r = await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'db', esiti_ok: esiti }) });
    await db`UPDATE photo_feed_config SET enabled_since = now() - interval '1 hour'`;
    return r;
  };
  const feedRun = async () => (await import('../feed.js')).runPhotoFeed();
  const count = async () => (await db`SELECT count(*)::int AS n FROM photo_jobs`)[0].n as number;

  it('copia iKnow: spenta di default, e per accenderla serve dire quali esiti valgono "accettata"', async () => {
    await hist();
    expect(await feedRun()).toBe(0);
    expect((await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'db', esiti_ok: [] }) })).status).toBe(400);
    expect((await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'db', esiti_ok: ['X'] }) }, guest)).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('copia iKnow: DELIBERA FINALE → ordine della fase "Delibera finale"; DELIBERA FINALE PROX → su Proximiti', async () => {
    await db`UPDATE photo_phases SET iknow_fase = 'DELIBERA FINALE PROX' WHERE key = 'delibera_finale_proximiti'`;
    await feedOn();
    await hist({ seriale: 'TST1' });
    await hist({ seriale: 'TST2', fase: 'DELIBERA FINALE PROX' });
    await hist({ seriale: 'TST3', fase: 'ASSEMBLAGGIO' });                 // fase non nel catalogo: ignorata
    await hist({ seriale: 'TST4', esito: 'RIFIUTATA' });                    // esito che non vale
    await hist({ seriale: 'TST5', at: new Date(Date.now() - 3 * 3600_000) });   // prima di enabled_since: storico
    expect(await feedRun()).toBe(2);
    const jobs = await db`SELECT phase, seriale, source, versione, commessa FROM photo_jobs ORDER BY seriale`;
    expect(jobs).toMatchObject([
      { phase: 'delibera_finale', seriale: 'TST1', source: 'iknow_db', versione: 'DX', commessa: '000111' },
      { phase: 'delibera_finale_proximiti', seriale: 'TST2', source: 'iknow_db' },
    ]);
    // ogni stazione prende solo il suo
    expect((await (await station('/claim', { method: 'POST' }, tok3)).json() as any).job.seriale).toBe('TST2');
    expect((await (await station('/claim', { method: 'POST' }, tok)).json() as any).job.seriale).toBe('TST1');
  });

  it('copia iKnow: girare di nuovo non duplica; commessa che arriva dopo viene presa al giro dopo', async () => {
    await feedOn();
    await hist({ seriale: 'TST6', commessa: null });
    expect(await feedRun()).toBe(0);
    await db`UPDATE webthron_events_history SET commessa = '000222' WHERE cod_seriale = 'TST6'`;
    expect(await feedRun()).toBe(1);
    expect(await feedRun()).toBe(0);
    expect(await count()).toBe(1);
  });

  it('copia iKnow → API: lo stesso evento arrivato dopo dall\'API non fa un secondo ordine', async () => {
    await setToken();
    await feedOn();                                                  // origine = copia DB
    const at = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    await hist({ seriale: 'TST7', at });
    expect(await feedRun()).toBe(1);
    await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'api', esiti_ok: [] }) });   // il giorno del passaggio all'API
    const r = await iknow(body({ seriale: 'TST7', commessa: '000111', data_ora: at.toISOString() }));
    expect((await r.json() as any).result).toBe('duplicate');
    expect(await count()).toBe(1);
  });

  it('copia iKnow: con iKnow spento (interruttore del sistema) non crea ordini', async () => {
    await feedOn();
    await hist({ seriale: 'TST8' });
    const sf = await import('../../../lib/system-flags.js');
    await sf.setIKnowFlags({ iknow_enabled: false });
    try { expect(await feedRun()).toBe(0); } finally { await sf.setIKnowFlags({ iknow_enabled: true }); }
    expect(await count()).toBe(0);
    expect(await feedRun()).toBe(1);
  });

  // ─── Interruttore origine: off / db / api ────────────────────────────────────────
  it('origine: per passare ad API serve il token; con origine db o off la chiamata API è ignorata (200, nessun ordine)', async () => {
    expect((await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'api', esiti_ok: [] }) })).status).toBe(400);   // senza token
    await user('/iknow-token', { method: 'PUT', body: JSON.stringify({ token: IK_TOKEN }) });
    const r = await iknow(body());                                   // origine ancora 'off'
    expect(r.status).toBe(200);
    expect((await r.json() as any).result).toBe('ignored');
    await feedOn();                                                  // origine 'db'
    expect((await (await iknow(body())).json() as any).result).toBe('ignored');
    expect(await count()).toBe(0);
    const st = await (await user('/feed')).json() as any;
    expect(st.mode).toBe('db');
    expect(st.ignored_api_calls.count).toBeGreaterThanOrEqual(2);
  });

  it('origine: con api o off la copia del DB non crea nulla; passando a db non fotografa il passato', async () => {
    await setToken();                                                // origine 'api'
    await db`UPDATE photo_feed_config SET esiti_ok = '{ACCETTATA}'`;
    await hist({ seriale: 'TST9' });
    expect(await feedRun()).toBe(0);
    await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'off', esiti_ok: ['ACCETTATA'] }) });
    expect(await feedRun()).toBe(0);
    await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'db', esiti_ok: ['ACCETTATA'] }) });   // enabled_since = ora
    expect(await feedRun()).toBe(0);                                 // TST9 è precedente: storico
    await user('/feed', { method: 'PUT', body: JSON.stringify({ mode: 'api', esiti_ok: [] }) });
    expect((await (await iknow(body())).json() as any).result).toBe('created');
    expect(await count()).toBe(1);
  });
});
