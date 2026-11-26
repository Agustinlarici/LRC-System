import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock('../queries.js', () => ({ IA_QUERIES: {} }));

import { creaIaLiveRoutes } from '../routes.js';
import { firma, svuotaNonceViste } from '../signature.js';

const SEGRETO = 's'.repeat(40);
const ORA = 1_800_000_000_000;
const esegui = vi.fn(async () => ({ colonne: ['a'], righe: Array.from({ length: 250 }, (_, i) => [i]) }));
const query = { stock_vivo: { descrizione: 'x', parametri: z.object({ articolo: z.string().min(1).max(50) }).strict(), esegui } };
const app = () => creaIaLiveRoutes({ segreto: () => SEGRETO, query, ora: () => ORA });

function richiesta(corpo: unknown, opz: { nonce?: string; ts?: number; segreto?: string; sig?: string; raw?: string } = {}) {
  const raw = Buffer.from(opz.raw ?? JSON.stringify(corpo));
  const ts = opz.ts ?? ORA / 1000;
  const nonce = opz.nonce ?? 'n-' + Math.random().toString(16).slice(2, 12);
  const sig = opz.sig ?? firma(opz.segreto ?? SEGRETO, 'POST', '/ia/consulta', raw, ts, nonce);
  return new Request('http://vm/consulta', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-ia-ts': String(ts), 'x-ia-nonce': nonce, 'x-ia-sig': sig },
  });
}

beforeEach(() => { svuotaNonceViste(); esegui.mockClear(); });

describe('compatibilità con la PC IA (Python)', () => {
  it('la firma coincide con quella calcolata da STR-IASystem (iasystem/security/signing.py)', () => {
    const corpo = Buffer.from('{"dataset":"d","parametri":{"k":"v"}}');
    expect(firma('s'.repeat(40), 'POST', '/ia/consulta', corpo, 1800000000, 'nonce-abc')).toBe('e3a78a68951e092a41476037d9bfa517fcb0c1fe821f26bfe20b8c4ded5ce5ad');
  });
});

describe('POST /ia/consulta', () => {
  it('con firma valida risponde e taglia a 200 righe', async () => {
    const r = await app().request(richiesta({ dataset: 'stock_vivo', parametri: { articolo: 'A1' } }));
    expect(r.status).toBe(200);
    const j = await r.json() as { colonne: string[]; righe: unknown[] };
    expect(j.righe.length).toBe(200);
    expect(esegui).toHaveBeenCalledWith({ articolo: 'A1' });
  });
  it('senza segreto configurato resta chiusa (503)', async () => {
    const chiusa = creaIaLiveRoutes({ segreto: () => '', query, ora: () => ORA });
    expect((await chiusa.request(richiesta({ dataset: 'stock_vivo', parametri: { articolo: 'A1' } }))).status).toBe(503);
  });
  it('firma sbagliata, segreto sbagliato, corpo manomesso, timestamp scaduto e nonce riusato -> 401', async () => {
    const body = { dataset: 'stock_vivo', parametri: { articolo: 'A1' } };
    expect((await app().request(richiesta(body, { sig: 'a'.repeat(64) }))).status).toBe(401);
    expect((await app().request(richiesta(body, { segreto: 'x'.repeat(40) }))).status).toBe(401);
    const manomesso = richiesta(body);
    const altro = new Request(manomesso.url, { method: 'POST', headers: manomesso.headers, body: JSON.stringify({ ...body, parametri: { articolo: 'ZZ' } }) });
    expect((await app().request(altro)).status).toBe(401);
    expect((await app().request(richiesta(body, { ts: ORA / 1000 - 1000 }))).status).toBe(401);
    expect((await app().request(richiesta(body, { nonce: 'riuso-1' }))).status).toBe(200);
    expect((await app().request(richiesta(body, { nonce: 'riuso-1' }))).status).toBe(401);
    expect(esegui).toHaveBeenCalledTimes(1);
  });
  it('dataset sconosciuto 404, parametri non validi o extra 422, JSON rotto 400, corpo enorme 413', async () => {
    expect((await app().request(richiesta({ dataset: 'inventato', parametri: {} }))).status).toBe(404);
    expect((await app().request(richiesta({ dataset: 'constructor', parametri: {} }))).status).toBe(404);
    expect((await app().request(richiesta({ dataset: 'stock_vivo', parametri: { articolo: 'A', extra: 1 } }))).status).toBe(422);
    expect((await app().request(richiesta({ dataset: 'stock_vivo', parametri: { articolo: '' } }))).status).toBe(422);
    expect((await app().request(richiesta(null, { raw: '{no json' }))).status).toBe(400);
    expect((await app().request(richiesta(null, { raw: 'x'.repeat(20_000) }))).status).toBe(413);
  });
  it('un errore della query non filtra dettagli verso la PC IA (502 generico)', async () => {
    esegui.mockRejectedValueOnce(new Error('password=segreta server=db.interno'));
    const r = await app().request(richiesta({ dataset: 'stock_vivo', parametri: { articolo: 'A1' } }));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('segreta');
  });
});
