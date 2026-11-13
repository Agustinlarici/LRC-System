// Regole dei componenti: salvataggio, tabella e prova, con PostgreSQL vero.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { schedaSemplice, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

const fisso = (componente: string, testo: string) => ({ componente, valore: { tipo: 'fisso', testo } });
const sigla = (componente: string, s: string) => ({ componente, valore: { tipo: 'sigla', sigla: s } });
const regola = (r: Record<string, unknown>) => ({ nome: 'regola', attiva: true, modello: '*', logica: 'tutte', condizioni: [], eccezioni: [], ferma: false, ...r });

describe.skipIf(!URL)('Regole dei componenti — rotte, tabella e prova', () => {
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
  const salva = (regole: unknown[], token = admin) => chiama('PUT', '/regole-componenti', { token, corpo: { regole } });
  const tabella = async (q = '') => (await (await chiama('GET', `/regole-componenti/tabella?q=${q}`, { token: admin })).json()) as {
    modello: string; componenti: string[]; regole_attive: number;
    righe: { commessa: string; celle: Record<string, { testo: string; descrizione?: string; regole: { nome: string }[] }[]>; non_coperte: string[] }[];
    non_coperte: { sigla: string; schede: number }[];
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret-per-le-regole';
    const { ferrariRoutes } = await import('../routes.js');
    db = (await import('../../../db/client.js')).db;
    app = new Hono().route('/api/ferrari', ferrariRoutes);
    const firma = (p: object) => jwt.sign(p, process.env.JWT_SECRET!, { expiresIn: '1h' });
    admin = firma({ id: 900001, username: 'admin-test', display_name: 'Admin', role: 'admin' });
    senzaPermessi = firma({ id: 900002, username: 'utente-test', display_name: 'Utente', role: 'user' });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE ferrari_regola_comp, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    for (const commessa of [307206, 307207]) {
      const f = new FormData();
      f.append('files', new Blob([toXlsBuffer(schedaSemplice({ commessa }))]), `${commessa}.xls`);
      expect((await chiama('POST', '/files', { token: admin, form: f })).status).toBe(200);
    }
  });

  it('senza accesso: 401 senza sessione, 403 senza permesso', async () => {
    expect((await chiama('GET', '/regole-componenti')).status).toBe(401);
    expect((await chiama('GET', '/regole-componenti', { token: senzaPermessi })).status).toBe(403);
    expect((await salva([], senzaPermessi)).status).toBe(403);
    expect((await chiama('GET', '/regole-componenti/tabella', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('POST', '/regole-componenti/prova', { token: senzaPermessi, corpo: { commessa: '307206' } })).status).toBe(403);
  });

  it('si salvano, si rileggono nell\'ordine e una regola invalida si rifiuta', async () => {
    const r1 = regola({ nome: 'prima', condizioni: [{ tipo: 'presente', sigla: 'CEL2' }], azioni: [sigla('Motore', 'CEL2')] });
    const r2 = regola({ nome: 'seconda', modello: 'f171vs', azioni: [fisso('Altro', 'x')], ferma: true });
    const ris = await salva([r1, r2]);
    expect(ris.status).toBe(200);
    const lette = ((await ris.json()) as { regole: { id: number; nome: string; modello: string; ferma: boolean }[] }).regole;
    expect(lette.map(r => [r.nome, r.modello, r.ferma])).toEqual([['prima', '*', false], ['seconda', 'F171VS', true]]);
    const rilette = ((await (await chiama('GET', '/regole-componenti', { token: admin })).json()) as { regole: { nome: string }[] }).regole;
    expect(rilette.map(r => r.nome)).toEqual(['prima', 'seconda']);
    expect((await salva([regola({ azioni: [] })])).status).toBe(400);                              // senza azioni
    expect((await salva([regola({ azioni: [fisso('A', 'b')], condizioni: [{ tipo: 'boh' }] })])).status).toBe(400);
    expect(((await (await chiama('GET', '/regole-componenti', { token: admin })).json()) as { regole: unknown[] }).regole).toHaveLength(2);   // il rifiuto non cancella
    const audit = await db<{ azione: string }[]>`SELECT azione FROM ferrari_audit WHERE azione = 'regole_comp.salvate'`;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('la tabella applica le regole a ogni commessa, con la regola che ha prodotto il valore e le sigle senza regola', async () => {
    await db`INSERT INTO ferrari_sigla (modello, codice, va, sub, creato_da) SELECT ${(await tabella()).modello}, c, true, false, 'test' FROM unnest(ARRAY['CEL2','RSFD']) AS c`;
    await salva([
      regola({ nome: 'motore', condizioni: [{ tipo: 'presente', sigla: 'CEL2' }], azioni: [sigla('Motore', 'CEL2'), fisso('Cerchi', 'EXAT')] }),
      regola({ nome: 'senza EXAB', condizioni: [{ tipo: 'assente', sigla: 'EXAB' }], azioni: [fisso('Cerchi', 'EXAT')] }),
    ]);
    const t = await tabella();
    expect(t.regole_attive).toBe(2);
    expect(t.componenti).toEqual(expect.arrayContaining(['Motore', 'Cerchi']));
    expect(t.righe).toHaveLength(2);
    const riga = t.righe.find(r => r.commessa === '307206')!;
    expect(riga.celle['Motore']!.map(v => v.testo)).toEqual(['CEL2']);
    expect(riga.celle['Motore']![0]!.descrizione).toBe('ALLEST.VANO MOTORE IN CARBONIO');
    expect(riga.celle['Cerchi']!.map(v => v.testo)).toEqual(['EXAT']);                              // due regole, un solo valore
    expect(riga.celle['Cerchi']![0]!.regole.map(r => r.nome)).toEqual(['motore', 'senza EXAB']);
    expect(riga.non_coperte).toEqual(['RSFD']);                                                     // vera per il modello e citata da nessuna regola
    expect(t.non_coperte).toEqual([{ sigla: 'RSFD', schede: 2 }]);
    expect((await tabella('307207')).righe.map(r => r.commessa)).toEqual(['307207']);               // filtro per commessa
  });

  it('la prova spiega perche\' scatta o no, anche con regole non ancora salvate; commessa sconosciuta = 404', async () => {
    const bozza = [
      regola({ nome: 'specifica', condizioni: [{ tipo: 'presente', sigla: 'CEL2' }, { tipo: 'presente', sigla: 'ZZZZ' }], azioni: [fisso('P', 'a')], ferma: true }),
      regola({ nome: 'generica', condizioni: [{ tipo: 'presente', sigla: 'CEL2' }], azioni: [fisso('P', 'b')] }),
    ];
    const r = await chiama('POST', '/regole-componenti/prova', { token: admin, corpo: { commessa: '307206', regole: bozza } });
    expect(r.status).toBe(200);
    const p = (await r.json()) as { sigle: string[]; regole: { nome: string; esito: string; condizioni: { testo: string; vera: boolean }[] }[]; celle: Record<string, { testo: string }[]> };
    expect(p.sigle).toContain('CEL2');
    expect(p.regole.map(x => [x.nome, x.esito])).toEqual([['specifica', 'non_scattata'], ['generica', 'scattata']]);
    expect(p.regole[0]!.condizioni.map(c => c.vera)).toEqual([true, false]);                       // si vede quale condizione manca
    expect(p.celle['P']!.map(v => v.testo)).toEqual(['b']);
    expect(((await (await chiama('GET', '/regole-componenti', { token: admin })).json()) as { regole: unknown[] }).regole).toHaveLength(0);   // la prova non salva
    expect((await chiama('POST', '/regole-componenti/prova', { token: admin, corpo: { commessa: '000000' } })).status).toBe(404);
  });
});
