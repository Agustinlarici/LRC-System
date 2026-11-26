// Rotte HTTP del collegamento IA: autenticazione, permessi, validazioni e aggancio al caricamento delle schede.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { schedaSemplice, toXlsBuffer } from '../../__tests__/fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Collegamento con la PC IA — rotte', () => {
  let app: Hono;
  let db: typeof import('../../../../db/client.js').db;
  let admin: string;
  let senzaPermessi: string;
  const chiama = (metodo: string, percorso: string, o: { token?: string; corpo?: unknown; form?: FormData } = {}) =>
    app.request(`/api/ferrari${percorso}`, {
      method: metodo,
      headers: { ...(o.token ? { Cookie: `lrc_session=${o.token}` } : {}), ...(o.corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: o.form ?? (o.corpo ? JSON.stringify(o.corpo) : undefined),
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret-per-le-rotte-ia';
    const { ferrariRoutes } = await import('../../routes.js');
    db = (await import('../../../../db/client.js')).db;
    app = new Hono().route('/api/ferrari', ferrariRoutes);
    const firma = (p: object) => jwt.sign(p, process.env.JWT_SECRET!, { expiresIn: '1h' });
    admin = firma({ id: 900001, username: 'admin-test', display_name: 'Admin', role: 'admin' });
    senzaPermessi = firma({ id: 900002, username: 'utente-test', display_name: 'Utente', role: 'user' });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE ferrari_ia_job, ferrari_ia_passo, ferrari_ia_risultato, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    await db`DELETE FROM ferrari_config WHERE key IN ('ia_attiva', 'ia_url', 'ia_max_tentativi', 'ia_timeout_s')`;
  });

  it('senza accesso: 401 senza sessione, 403 senza permesso sul modulo', async () => {
    expect((await chiama('GET', '/ia/stato')).status).toBe(401);
    expect((await chiama('GET', '/ia/stato', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('PUT', '/ia/config', { token: senzaPermessi, corpo: { attiva: false } })).status).toBe(403);
    expect((await chiama('POST', '/ia/prova', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('POST', '/ia/sigle/sincronizza', { token: senzaPermessi })).status).toBe(403);
  });

  it('stato: spenta di default, senza lavori', async () => {
    const r = await chiama('GET', '/ia/stato', { token: admin });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ config: { attiva: false, url: '', maxTentativi: 6, timeoutS: 30 }, connessione: { stato: 'sconosciuta' }, contatori: {} });
  });

  it('config: valida e salva; non si accende senza indirizzo', async () => {
    expect((await chiama('PUT', '/ia/config', { token: admin, corpo: { attiva: true } })).status).toBe(400);
    expect((await chiama('PUT', '/ia/config', { token: admin, corpo: { url: 'ftp://x' } })).status).toBe(400);
    expect((await chiama('PUT', '/ia/config', { token: admin, corpo: { maxTentativi: 'molti' } })).status).toBe(400);
    const ok = await chiama('PUT', '/ia/config', { token: admin, corpo: { url: 'http://192.168.1.50:5000/', attiva: true, maxTentativi: 4 } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ attiva: true, url: 'http://192.168.1.50:5000', maxTentativi: 4 });
    expect(await db`SELECT 1 FROM ferrari_audit WHERE azione = 'ia.config'`).toHaveLength(1);        // registrato nello storico
  });

  it('identificativi non validi: 400; lavoro inesistente: 404; «analizza» con IA spenta: 409', async () => {
    expect((await chiama('GET', '/ia/jobs/abc', { token: admin })).status).toBe(400);
    expect((await chiama('GET', '/ia/jobs/99999', { token: admin })).status).toBe(404);
    expect((await chiama('POST', '/ia/jobs/99999/riprova', { token: admin })).status).toBe(404);
    expect((await chiama('POST', '/ia/jobs/1; DROP/annulla', { token: admin })).status).toBe(400);
    expect((await chiama('POST', '/ia/schede/1/analizza', { token: admin })).status).toBe(409);
    expect((await chiama('POST', '/ia/accoda-mancanti', { token: admin })).status).toBe(409);
  });

  it('caricando una scheda con l\'IA spenta non nasce nessun lavoro; con l\'IA accesa si', async () => {
    const carica = async (commessa: number) => {
      const f = new FormData();
      f.append('files', new Blob([toXlsBuffer(schedaSemplice({ commessa }))]), `${commessa}.xls`);
      return chiama('POST', '/files', { token: admin, form: f });
    };
    expect((await carica(1)).status).toBe(200);
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(0);

    await chiama('PUT', '/ia/config', { token: admin, corpo: { url: 'http://192.168.1.50:5000', attiva: true } });
    expect((await carica(2)).status).toBe(200);
    const jobs = await db<{ stato: string; file_id: number }[]>`SELECT stato, file_id FROM ferrari_ia_job`;
    expect(jobs).toEqual([{ stato: 'in_coda', file_id: 2 }]);

    expect((await carica(2)).status).toBe(200);                                   // lo stesso file ricaricato = duplicato: nessun lavoro nuovo
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(1);

    const elenco = await (await chiama('GET', '/ia/schede', { token: admin })).json() as { schede: { file_id: number; stato: string | null; tappe: { passo: string }[] }[] };
    expect(elenco.schede.map(s => [s.file_id, s.stato])).toEqual([[2, 'in_coda'], [1, null]]);
    expect(elenco.schede[0]!.tappe).toHaveLength(6);

    const analizza = await chiama('POST', '/ia/schede/2/analizza', { token: admin });  // gia' in coda
    expect(analizza.status).toBe(409);
    expect((await chiama('POST', '/ia/schede/1/analizza', { token: admin })).status).toBe(202);
    const annulla = await chiama('POST', `/ia/jobs/${(await db<{ id: string }[]>`SELECT id::text AS id FROM ferrari_ia_job WHERE file_id = 1`)[0]!.id}/annulla`, { token: admin });
    expect(annulla.status).toBe(200);
  });

  it('?riprova=1: un file gia\' caricato si rimanda alla IA (solo per prova); senza il parametro resta un duplicato', async () => {
    const carica = async (commessa: number, riprova = false) => {
      const f = new FormData();
      f.append('files', new Blob([toXlsBuffer(schedaSemplice({ commessa }))]), `${commessa}.xls`);
      const r = await chiama('POST', `/files${riprova ? '?riprova=1' : ''}`, { token: admin, form: f });
      return (await r.json() as { risultati: { duplicato: boolean; riprova?: string }[] }).risultati[0]!;
    };
    expect((await carica(1)).duplicato).toBe(false);
    // IA spenta: il duplicato non fa niente e lo dice
    expect(await carica(1, true)).toMatchObject({ duplicato: true, riprova: 'ia_spenta' });
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(0);

    await chiama('PUT', '/ia/config', { token: admin, corpo: { url: 'http://192.168.1.50:5000', attiva: true } });
    expect((await carica(1)).riprova).toBeUndefined();                                  // senza ?riprova=1 non cambia niente
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(0);
    expect(await carica(1, true)).toMatchObject({ duplicato: true, riprova: 'accodata' });
    expect(await db<{ file_id: number; stato: string }[]>`SELECT file_id, stato FROM ferrari_ia_job`).toEqual([{ file_id: 1, stato: 'in_coda' }]);
    expect(await carica(1, true)).toMatchObject({ riprova: 'gia_in_corso' });           // c'e' gia' un'analisi attiva: non se ne crea una seconda
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(1);
    // una scheda nuova con ?riprova=1 e' un caricamento normale
    expect((await carica(2, true)).duplicato).toBe(false);
    expect(await db`SELECT 1 FROM ferrari_file`).toHaveLength(2);                       // nessuna scheda duplicata nel database
  });
});
