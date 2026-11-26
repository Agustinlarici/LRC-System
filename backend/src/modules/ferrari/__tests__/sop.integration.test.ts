// Controllo con il SOP: caricamento, regole e confronto con le schede caricate, con PostgreSQL vero.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import { schedaSemplice, toXlsBuffer } from './fixtures.js';
import { CODICI_COLORE, REGOLE_SUGGERITE } from '../sop-base.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

const xlsxSop = (righe: unknown[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Foglio1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

interface Confronto {
  riepilogo: { righe_sop: number; con_dati: number; confrontate: number; non_caricate: number; tutte_ok: number; con_differenze: number; differenze_totali: number };
  colonne: { colonna: string; ok: number; diverso: number; solo_sop: number; solo_vm: number }[];
  colonne_senza_regola: string[]; differenze: { commessa: string; colonna: string; sop: string; vm: string; tipo: string }[];
  non_caricate: string[]; regole_mancanti: boolean;
}

describe.skipIf(!URL)('Controllo con il SOP — rotte e confronto', () => {
  let app: Hono;
  let db: typeof import('../../../db/client.js').db;
  let admin: string;
  let senzaPermessi: string;
  const chiama = (metodo: string, percorso: string, o: { token?: string; corpo?: unknown; form?: FormData } = {}) =>
    app.request(`/api/ferrari${percorso}`, {
      method: metodo,
      headers: { ...(o.token ? { Cookie: `lrc_session=${o.token}` } : {}), ...(o.corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: o.form ?? (o.corpo ? JSON.stringify(o.corpo) : undefined),
    });
  const carica = (buf: Buffer, nome = 'SOP.xlsx', token = admin) => {
    const f = new FormData();
    f.append('file', new Blob([buf]), nome);
    return chiama('POST', '/sop/import', { token, form: f });
  };
  const confronto = async () => (await (await chiama('GET', '/sop/confronto', { token: admin })).json()) as Confronto;
  const SOP = () => xlsxSop([
    ['COMMESSA', 'MERCATO', 'COLORE', 'ANT', 'TEL. POST', 'CODINI', 'LIVREA', 'NOTE'],
    ['307206', '', 'ROSSO TEST', 'PUR', 'SV', 'EXAT', '', 'una nota'],       // la scheda e' caricata: TEL. POST sara' l'unica differenza
    ['999999', 'USA', 'EXTRACAMPIONARIO', 'PUR', 'RACAM', 'EXAT', '', ''],    // non caricata nella VM
    ['888888', '', '', '', '', '', '', ''],                                    // ancora da compilare: non si confronta
  ]);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret-per-il-sop';
    const { ferrariRoutes } = await import('../routes.js');
    db = (await import('../../../db/client.js')).db;
    app = new Hono().route('/api/ferrari', ferrariRoutes);
    const firma = (p: object) => jwt.sign(p, process.env.JWT_SECRET!, { expiresIn: '1h' });
    admin = firma({ id: 900001, username: 'admin-test', display_name: 'Admin', role: 'admin' });
    senzaPermessi = firma({ id: 900002, username: 'utente-test', display_name: 'Utente', role: 'user' });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE ferrari_sop_visto, ferrari_sop_riga, ferrari_sop_import, ferrari_sop_regola, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    const f = new FormData();
    f.append('files', new Blob([toXlsBuffer(schedaSemplice({ commessa: 307206 }))]), '307206.xls');
    expect((await chiama('POST', '/files', { token: admin, form: f })).status).toBe(200);
  });

  it('senza accesso: 401 senza sessione, 403 senza permesso', async () => {
    expect((await chiama('GET', '/sop/confronto')).status).toBe(401);
    expect((await chiama('GET', '/sop/regole', { token: senzaPermessi })).status).toBe(403);
    expect((await carica(SOP(), 'SOP.xlsx', senzaPermessi)).status).toBe(403);
    expect((await chiama('PUT', '/sop/regole', { token: senzaPermessi, corpo: { regole: [] } })).status).toBe(403);
    expect((await chiama('POST', '/sop/regole/suggerite', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('POST', '/sop/viste', { token: senzaPermessi, corpo: { viste: true, differenze: [{ commessa: '1', colonna: 'A', sop: '', vm: '' }] } })).status).toBe(403);
  });

  it('senza aver caricato il SOP il confronto dice di caricarlo; un file sbagliato si rifiuta', async () => {
    expect((await chiama('GET', '/sop/confronto', { token: admin })).status).toBe(404);
    expect((await carica(xlsxSop([['A', 'B'], [1, 2]]))).status).toBe(400);                          // manca COMMESSA
    expect((await carica(SOP(), 'SOP.pdf')).status).toBe(400);
    expect((await carica(Buffer.from('non e\' un excel'))).status).toBe(400);
  });

  it('carica, applica le regole suggerite e confronta: coincidenze, differenze, non caricate e righe ancora da compilare', async () => {
    const imp = await (await carica(SOP())).json() as { righe: number; con_dati: number; colonne: string[] };
    expect(imp).toMatchObject({ righe: 3, con_dati: 2 });

    const senza = await confronto();
    expect(senza.regole_mancanti).toBe(true);
    expect(senza.differenze).toEqual([]);

    const sugg = await (await chiama('POST', '/sop/regole/suggerite', { token: admin })).json() as { aggiunte: number };
    expect(sugg.aggiunte).toBe(REGOLE_SUGGERITE.length);
    expect(((await (await chiama('POST', '/sop/regole/suggerite', { token: admin })).json()) as { aggiunte: number }).aggiunte).toBe(0);   // una volta sola

    const c = await confronto();
    expect(c.riepilogo).toMatchObject({ righe_sop: 3, con_dati: 2, confrontate: 1, non_caricate: 1, tutte_ok: 0, con_differenze: 1, differenze_totali: 1 });
    expect(c.non_caricate).toEqual(['999999']);
    expect(c.differenze).toEqual([{ commessa: '307206', file_id: 1, colonna: 'TEL. POST', sop: 'SV', vm: 'RACAM', tipo: 'diverso' }]);
    expect(c.colonne_senza_regola).toEqual(['NOTE']);
    const per = Object.fromEntries(c.colonne.map(x => [x.colonna, x]));
    expect(per['COLORE']).toMatchObject({ ok: 1, diverso: 0 });                                      // EXTC + riga sotto (PNCC = ROSSO TEST)
    expect(per['CODINI']).toMatchObject({ ok: 1 });
    expect(per['TEL. POST']).toMatchObject({ ok: 0, diverso: 1 });
    expect(per['MERCATO']).toMatchObject({ ok: 1 });                                                 // vuoto = vuoto
  });

  it('le regole si modificano e il confronto cambia; una colonna con due regole o una regola sbagliata si rifiuta', async () => {
    await carica(SOP());
    await chiama('POST', '/sop/regole/suggerite', { token: admin });
    const regole = ((await (await chiama('GET', '/sop/regole', { token: admin })).json()) as { regole: { colonna: string; tipo: string }[] }).regole;
    expect(regole).toHaveLength(REGOLE_SUGGERITE.length);
    const nuove = regole.map(r => (r.colonna === 'TEL. POST' ? { colonna: 'TEL. POST', tipo: 'sigle', sigle: ['SURR=SV'], base: 'SV', unisci: '/' } : r));
    expect((await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: nuove } })).status).toBe(200);
    expect((await confronto()).riepilogo.differenze_totali).toBe(0);                                  // ora il valore base e' SV: coincide

    expect((await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: [nuove[0], nuove[0]] } })).status).toBe(400);
    expect((await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: [{ colonna: 'X', tipo: 'boh' }] } })).status).toBe(400);
    expect((await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: [] } })).status).toBe(200);
    expect((await confronto()).regole_mancanti).toBe(true);
  });

  it('una scheda sostituita da una versione nuova si confronta con la piu\' recente; si conservano solo gli ultimi 5 caricamenti', async () => {
    for (let i = 0; i < 7; i++) expect((await carica(SOP())).status).toBe(200);
    const el = await (await chiama('GET', '/sop/importazioni', { token: admin })).json() as { importazioni: { id: number }[] };
    expect(el.importazioni.map(x => x.id)).toEqual([7, 6, 5, 4, 3]);
    expect(await db`SELECT 1 FROM ferrari_sop_riga`).toHaveLength(15);                                // 5 caricamenti x 3 righe: il resto se ne va con il caricamento
    const storico = await db<{ azione: string }[]>`SELECT azione FROM ferrari_audit WHERE azione LIKE 'sop.%'`;
    expect(storico).toHaveLength(7);
  });

  it('una regola colore salvata con la versione precedente (gamma sotto EXTC) passa alle sigle di colore di default', async () => {
    await db`INSERT INTO ferrari_sop_regola (colonna, ordine, tipo, parametri) VALUES ('COLORE', 0, 'colore', ${db.json({ gamma: ['PNCC'], extra: 'EXTRACAMPIONARIO' } as never)})`;
    const regole = ((await (await chiama('GET', '/sop/regole', { token: admin })).json()) as { regole: { colonna: string; codici?: string[]; gamma?: string[]; extra: string }[] }).regole;
    expect(regole).toHaveLength(1);
    expect(regole[0]!.codici).toEqual(CODICI_COLORE);
    expect(regole[0]!.gamma).toBeUndefined();
    await carica(SOP());
    const c = await confronto();
    expect(c.colonne.find(x => x.colonna === 'COLORE')).toMatchObject({ ok: 1 });                    // ROSSO TEST = PNCC della scheda di prova
  });

  it('le differenze si segnano come viste: restano viste finche\' la differenza e\' la stessa, tornano da vedere se un valore cambia', async () => {
    await carica(SOP());
    await chiama('POST', '/sop/regole/suggerite', { token: admin });
    const d = { commessa: '307206', colonna: 'TEL. POST', sop: 'SV', vm: 'RACAM' };
    const viste = (corpo: unknown) => chiama('POST', '/sop/viste', { token: admin, corpo });
    const c0 = await confronto() as Confronto & { differenze: { visto?: { da: string | null; at: string } }[]; riepilogo: { viste: number } };
    expect(c0.differenze[0]!.visto).toBeUndefined();
    expect(c0.riepilogo.viste).toBe(0);

    expect(await (await viste({ viste: true, differenze: [d, d] })).json()).toEqual({ cambiate: 1 });                  // anche se la si manda due volte, e' una
    const c1 = await confronto() as typeof c0;
    expect(c1.differenze[0]!.visto).toMatchObject({ da: expect.any(String) });
    expect(c1.differenze[0]!.visto!.da).toBeTruthy();
    expect(c1.riepilogo.viste).toBe(1);
    expect(await (await viste({ viste: true, differenze: [d] })).json()).toEqual({ cambiate: 0 });                     // gia' vista: niente da cambiare

    // la regola cambia: la differenza sparisce e, tornando com'era, e' ancora vista; con un valore diverso e' una differenza nuova, da vedere
    const regole = ((await (await chiama('GET', '/sop/regole', { token: admin })).json()) as { regole: { colonna: string }[] }).regole;
    const con = (base: string) => regole.map(r => (r.colonna === 'TEL. POST' ? { colonna: 'TEL. POST', tipo: 'sigle', sigle: ['SURR=SV'], base, unisci: '/' } : r));
    await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: con('SV') } });
    expect((await confronto()).differenze).toEqual([]);
    await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: con('RACAM') } });
    expect(((await confronto()) as typeof c0).differenze[0]!.visto).toBeDefined();
    await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: con('ALTRO') } });
    const c2 = await confronto() as typeof c0;
    expect(c2.differenze[0]).toMatchObject({ vm: 'ALTRO' });
    expect(c2.differenze[0]!.visto).toBeUndefined();
    expect(c2.riepilogo.viste).toBe(0);

    await chiama('PUT', '/sop/regole', { token: admin, corpo: { regole: con('RACAM') } });
    expect(await (await viste({ viste: false, differenze: [d] })).json()).toEqual({ cambiate: 1 });                    // torna da vedere
    expect(((await confronto()) as typeof c0).differenze[0]!.visto).toBeUndefined();
    expect((await viste({ viste: true, differenze: [] })).status).toBe(400);
    const storico = await db<{ azione: string }[]>`SELECT azione FROM ferrari_audit WHERE azione IN ('sop.viste', 'sop.da_rivedere')`;
    expect(storico.map(x => x.azione)).toEqual(['sop.viste', 'sop.da_rivedere']);
  });
});
