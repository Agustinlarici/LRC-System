// Categorie delle colonne: rotte (permessi, creazione, modifica, ordine, eliminazione) e raggruppamento nella matrice, con PostgreSQL vero.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { schedaSemplice, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

interface Cat { id: number; nome: string; ordine: number; termini: string[] }

describe.skipIf(!URL)('Categorie delle colonne — rotte e matrice', () => {
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
  const elenco = async () => ((await (await chiama('GET', '/categorie', { token: admin })).json()) as { categorie: Cat[] }).categorie;
  const crea = async (nome: string, termini: string[]) => (await (await chiama('POST', '/categorie', { token: admin, corpo: { nome, termini } })).json()) as Cat;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret-per-le-categorie';
    const { ferrariRoutes } = await import('../routes.js');
    db = (await import('../../../db/client.js')).db;
    app = new Hono().route('/api/ferrari', ferrariRoutes);
    const firma = (p: object) => jwt.sign(p, process.env.JWT_SECRET!, { expiresIn: '1h' });
    admin = firma({ id: 900001, username: 'admin-test', display_name: 'Admin', role: 'admin' });
    senzaPermessi = firma({ id: 900002, username: 'utente-test', display_name: 'Utente', role: 'user' });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE ferrari_categoria_termine, ferrari_categoria, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
  });

  it('senza accesso: 401 senza sessione, 403 senza permesso', async () => {
    expect((await chiama('GET', '/categorie')).status).toBe(401);
    expect((await chiama('GET', '/categorie', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('POST', '/categorie', { token: senzaPermessi, corpo: { nome: 'X', termini: [] } })).status).toBe(403);
    expect((await chiama('DELETE', '/categorie/1', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('POST', '/categorie/esempio', { token: senzaPermessi })).status).toBe(403);
  });

  it('crea, modifica, riordina ed elimina; codici normalizzati e nome unico senza guardare le maiuscole', async () => {
    expect(await elenco()).toEqual([]);
    const a = await crea('LIVREA', [' pn5x ', 'TMSP', 'tmsp']);
    expect(a).toMatchObject({ nome: 'LIVREA', termini: ['PN5X', 'TMSP'] });
    const b = await crea('Caval.', ['HBSA']);
    expect((await chiama('POST', '/categorie', { token: admin, corpo: { nome: 'livrea', termini: [] } })).status).toBe(409);

    const mod = await (await chiama('POST', '/categorie', { token: admin, corpo: { id: a.id, nome: 'LIVREA SPECIALE', termini: ['LI5X'] } })).json() as Cat;
    expect(mod).toMatchObject({ id: a.id, nome: 'LIVREA SPECIALE', termini: ['LI5X'] });
    expect((await chiama('POST', '/categorie', { token: admin, corpo: { id: 99999, nome: 'Z', termini: [] } })).status).toBe(404);
    expect((await chiama('POST', '/categorie', { token: admin, corpo: { id: b.id, nome: 'livrea speciale', termini: [] } })).status).toBe(409);   // il nome e' di un'altra

    expect((await chiama('POST', '/categorie/ordine', { token: admin, corpo: { ids: [b.id, a.id] } })).status).toBe(200);
    expect((await elenco()).map(c => c.nome)).toEqual(['Caval.', 'LIVREA SPECIALE']);

    expect((await chiama('DELETE', `/categorie/${a.id}`, { token: admin })).status).toBe(200);
    expect((await chiama('DELETE', `/categorie/${a.id}`, { token: admin })).status).toBe(404);
    expect((await elenco()).map(c => c.nome)).toEqual(['Caval.']);
    expect(await db`SELECT 1 FROM ferrari_categoria_termine WHERE categoria_id = ${a.id}`).toHaveLength(0);   // i codici se ne vanno con la categoria
    const storico = await db<{ azione: string }[]>`SELECT azione FROM ferrari_audit WHERE azione LIKE 'categoria%' OR azione LIKE 'categorie%' ORDER BY id`;
    expect(storico.map(s => s.azione)).toEqual(['categoria.salvata', 'categoria.salvata', 'categoria.salvata', 'categorie.riordinate', 'categoria.eliminata']);
  });

  it('nome vuoto o troppo lungo si rifiuta', async () => {
    expect((await chiama('POST', '/categorie', { token: admin, corpo: { nome: '   ', termini: [] } })).status).toBe(400);
    expect((await chiama('POST', '/categorie', { token: admin, corpo: { nome: 'x'.repeat(41), termini: [] } })).status).toBe(400);
  });

  it('le categorie di esempio si aggiungono una volta sola', async () => {
    const r1 = await (await chiama('POST', '/categorie/esempio', { token: admin })).json() as { aggiunte: number };
    expect(r1.aggiunte).toBe(6);
    expect((await elenco()).map(c => c.nome)).toEqual(['LIVREA', 'DREAMLINE', 'CAVAL.', 'CARB.', 'PLAST.', 'GRIGLIE']);
    expect((await elenco())[0]!.termini).toContain('PN5X');
    const r2 = await (await chiama('POST', '/categorie/esempio', { token: admin })).json() as { aggiunte: number };
    expect(r2.aggiunte).toBe(0);
    expect(await elenco()).toHaveLength(6);
  });

  it('la matrice raggruppa le colonne per categoria; senza categorie non cambia niente', async () => {
    const f = new FormData();
    f.append('files', new Blob([toXlsBuffer(schedaSemplice({ commessa: 307206 }))]), '307206.xls');
    expect((await chiama('POST', '/files', { token: admin, form: f })).status).toBe(200);
    for (const codice of ['CEL2', 'RSFD', 'TYBR']) {
      expect((await chiama('POST', '/sigle', { token: admin, corpo: { modello: '', codice, va: true, tutti: true } })).status).toBe(200);
    }
    const matrice = async () => (await (await chiama('GET', '/matrice', { token: admin })).json()) as { termini: string[]; gruppi: { categoria: string | null; termini: string[] }[] };
    const prima = await matrice();
    expect(prima.termini).toEqual(['CEL2', 'RSFD', 'TYBR']);
    expect(prima.gruppi).toEqual([]);

    await crea('CERCHI', ['RSFD']);
    await crea('CARB.', ['CEL2']);
    const dopo = await matrice();
    expect(dopo.termini).toEqual(['CEL2', 'RSFD', 'TYBR']);                      // le colonne restano le stesse
    expect(dopo.gruppi).toEqual([
      { categoria: 'CERCHI', termini: ['RSFD'] }, { categoria: 'CARB.', termini: ['CEL2'] }, { categoria: null, termini: ['TYBR'] }]);
  });
});
