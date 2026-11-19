// Fatturazione: rotte con PostgreSQL vero (la copia da BC si simula inserendo righe in fatt_riga).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Fatturazione — rotte', () => {
  let app: Hono;
  let db: typeof import('../../../db/client.js').db;
  let admin: string;
  let senzaPermessi: string;
  const chiama = (metodo: string, percorso: string, o: { token?: string; corpo?: unknown } = {}) =>
    app.request(`/api/fatturazione${percorso}`, {
      method: metodo,
      headers: { ...(o.token ? { Cookie: `lrc_session=${o.token}` } : {}), ...(o.corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: o.corpo ? JSON.stringify(o.corpo) : undefined,
    });
  const regola = (r: Record<string, unknown>) => ({ nome: 'r', attiva: true, article_code: 'ART1', prezzo: 10, logica: 'tutte', condizioni: [], eccezioni: [], ...r });
  const passo = (cerca: string[], finestra: number | null = null) => ({ cerca, finestra });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret-fatturazione';
    const { fatturazioneRoutes } = await import('../routes.js');
    db = (await import('../../../db/client.js')).db;
    app = new Hono().route('/api/fatturazione', fatturazioneRoutes);
    const firma = (p: object) => jwt.sign(p, process.env.JWT_SECRET!, { expiresIn: '1h' });
    admin = firma({ id: 900001, username: 'admin-test', display_name: 'Admin', role: 'admin' });
    senzaPermessi = firma({ id: 900002, username: 'utente-test', display_name: 'Utente', role: 'user' });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE fatt_regola, fatt_gruppo, fatt_riga RESTART IDENTITY`;
    await db`DELETE FROM fatt_conto`; await db`INSERT INTO fatt_conto (conto) VALUES ('C1')`;
    await db`INSERT INTO fatt_riga (shipment_id, line_no, shipment_date, customer_account, article_code, quantity, order_no, descrizione) VALUES
      ('D1', 1, '2026-01-10', 'C1', 'ART1', 2, 'O1', 'KIT PPE1 VERNICE ROSSO OPACO'),
      ('D1', 2, '2026-01-10', 'C1', 'ART2', 1, 'O1', 'ALTRO'),
      ('D2', 1, '2026-01-11', 'C9', 'ART1', 1, 'O2', 'PPE1 ROSSO')`;
  });

  it('senza accesso: 401 senza sessione, 403 senza permesso (lettura e scrittura)', async () => {
    expect((await chiama('GET', '/despachi')).status).toBe(401);
    expect((await chiama('GET', '/despachi', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('PUT', '/regole', { token: senzaPermessi, corpo: { regole: [] } })).status).toBe(403);
    expect((await chiama('POST', '/sincronizza', { token: senzaPermessi })).status).toBe(403);
    expect((await chiama('PUT', '/conti', { token: senzaPermessi, corpo: { conti: ['X'] } })).status).toBe(403);
  });

  it('salva regole (ordine, condizioni, eccezioni) e rifiuta quelle invalide senza cancellare', async () => {
    const ok = await chiama('PUT', '/regole', { token: admin, corpo: { regole: [regola({ nome: 'base' }), regola({ nome: 'ppe', condizioni: [{ passi: [passo(['PPE1'])] }], eccezioni: [{ passi: [passo(['USATO'])] }] })] } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { nome: string }[]).map(r => r.nome)).toEqual(['base', 'ppe']);
    expect((await chiama('PUT', '/regole', { token: admin, corpo: { regole: [regola({ condizioni: [{ passi: [] }] })] } })).status).toBe(400);
    expect(((await (await chiama('GET', '/regole', { token: admin })).json()) as unknown[])).toHaveLength(2);
  });

  it('calcola il totale dei despachi e il dettaglio, solo per i conti configurati', async () => {
    await chiama('PUT', '/gruppi', { token: admin, corpo: { gruppi: [{ nome: 'colori', parole: ['ROSSO', 'NERO'] }] } });
    await chiama('PUT', '/regole', { token: admin, corpo: { regole: [
      regola({ nome: 'base', prezzo: 100 }),
      regola({ nome: 'catena', prezzo: 25, condizioni: [{ passi: [passo(['PPE1']), passo(['@COLORI'], 20), passo(['OPACO'], 15)] }] }),
    ] } });
    const lista = (await (await chiama('GET', '/despachi', { token: admin })).json()) as { shipment_id: string; totale_str: number; senza_regola: number; line_count: number }[];
    expect(lista.map(d => d.shipment_id)).toEqual(['D1']);                        // D2 è di un conto non configurato
    expect(lista[0]).toMatchObject({ totale_str: 250, senza_regola: 1, line_count: 2 });   // (100+25)*2 ; ART2 senza regole
    const det = (await (await chiama('GET', '/despachi/D1', { token: admin })).json()) as { totale_str: number; righe: { prezzo_str: number; regole: unknown[] }[] };
    expect(det.totale_str).toBe(250);
    expect(det.righe[0]).toMatchObject({ prezzo_str: 125 });
    expect(det.righe[0]!.regole).toHaveLength(2);
    expect((await chiama('GET', '/despachi/D2', { token: admin })).status).toBe(404);
  });

  it('prova senza BC e stato della sincronizzazione', async () => {
    await chiama('PUT', '/regole', { token: admin, corpo: { regole: [regola({ prezzo: 7 })] } });
    const p = (await (await chiama('POST', '/prova', { token: admin, corpo: { article_code: 'ART1', descrizione: 'x' } })).json()) as { totale: number };
    expect(p.totale).toBe(7);
    const st = (await (await chiama('GET', '/stato', { token: admin })).json()) as { ultima_sync: string | null; in_corso: boolean };
    expect(st).toMatchObject({ ultima_sync: null, in_corso: false });
  });
});
