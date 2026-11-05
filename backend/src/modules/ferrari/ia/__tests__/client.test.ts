import { afterEach, describe, expect, it } from 'vitest';
import { ClienteIa, costruisciMultipart, ErroreContratto, ErroreIa, ErroreRete } from '../client.js';
import { avviaFakePcIa, type FakePcIa } from './fake-pc-ia.js';
import { intestazioniFirmate } from '../firma.js';
import { SHA, snapshot, UUID, VERSIONE } from './fixtures-ia-v1.js';

const S = 'segreto-di-prova';
let ia: FakePcIa | null = null;
afterEach(async () => { await ia?.chiudi(); ia = null; });
const meta = { sha256: SHA, richiesta_id: UUID, versione_sigle: VERSIONE, commessa: '100001', modello: 'F999XX' };
const cliente = (o: Partial<ConstructorParameters<typeof ClienteIa>[0]> = {}) => new ClienteIa({ url: ia!.url, secret: S, ...o });

describe('cliente della PC IA', () => {
  it('salute: legge e valida la risposta, firmata', async () => {
    ia = await avviaFakePcIa({ secret: S });
    expect(await cliente().salute()).toMatchObject({ ollama: true, modello: 'gemma4:e2b', versione_api: 1 });
    expect(ia.richieste.map(r => `${r.metodo} ${r.percorso}`)).toEqual(['GET /v1/salute']);
  });

  it('segreto sbagliato: errore 401 con il codice del contratto, non ritentabile', async () => {
    ia = await avviaFakePcIa({ secret: S });
    const e = await cliente({ secret: 'altro' }).salute().catch(x => x);
    expect(e).toBeInstanceOf(ErroreIa);
    expect(e).toMatchObject({ http: 401, codice: 'firma_non_valida', ritentabile: false });
  });

  it('una richiesta ripetuta con la stessa firma (replay) viene rifiutata', async () => {
    ia = await avviaFakePcIa({ secret: S });
    const h = intestazioniFirmate(S, 'GET', '/v1/salute', '');
    const uno = await fetch(`${ia.url}/v1/salute`, { headers: h });
    const due = await fetch(`${ia.url}/v1/salute`, { headers: h });
    expect(uno.status).toBe(200);
    expect(due.status).toBe(401);
    expect((await due.json() as { errore: { codice: string } }).errore.codice).toBe('nonce_ripetuto');
  });

  it('flusso completo: sigle → analisi → avanzamento → risultato; stessa richiesta = stesso lavoro', async () => {
    ia = await avviaFakePcIa({ secret: S, passiPrimaDelFinire: 3 });
    const c = cliente();
    expect(await c.inviaSigle(snapshot)).toBe(VERSIONE);
    const file = Buffer.from('contenuto-excel');
    const a = await c.avviaAnalisi(file, 'scheda.xls', meta);
    expect(a).toMatchObject({ id: 'job-1', stato: 'in_coda' });
    expect(ia.richieste.at(-1)).toMatchObject({ metodo: 'POST', dimFile: file.length, meta: { sha256: SHA } });
    expect((await c.avviaAnalisi(file, 'scheda.xls', meta)).id).toBe('job-1');   // stessa richiesta_id = stesso lavoro (ritrasmissione)
    expect((await c.avviaAnalisi(file, 'scheda.xls', { ...meta, richiesta_id: '99999999-2222-4333-8444-555555555555' })).id).toBe('job-2');
    expect(await c.stato('job-1')).toMatchObject({ stato: 'in_corso', passo: 'lettura', avanzamento: { fatti: 1, totale: 3 } });
    expect(await c.stato('job-1')).toMatchObject({ stato: 'in_corso', passo: 'riassunti' });
    const fine = await c.stato('job-1');
    expect(fine).toMatchObject({ stato: 'fatto', passo: 'fine' });
    expect(fine.risultato?.lettura).toHaveLength(2);
  });

  it('sigle sconosciute: 409 sigle_obsolete; dopo inviarle funziona', async () => {
    ia = await avviaFakePcIa({ secret: S });
    const c = cliente();
    const e = await c.avviaAnalisi(Buffer.from('x'), 's.xls', meta).catch(x => x);
    expect(e).toMatchObject({ http: 409, codice: 'sigle_obsolete', ritentabile: false });
    await c.inviaSigle(snapshot);
    expect((await c.avviaAnalisi(Buffer.from('x'), 's.xls', meta)).id).toBe('job-1');
  });

  it('Ollama spento (503): errore ritentabile', async () => {
    ia = await avviaFakePcIa({ secret: S, ollama: false });
    await cliente().inviaSigle(snapshot);
    const e = await cliente().avviaAnalisi(Buffer.from('x'), 's.xls', meta).catch(x => x);
    expect(e).toMatchObject({ http: 503, codice: 'ollama_non_disponibile', ritentabile: true });
  });

  it('PC spenta (connessione rifiutata): ErroreRete', async () => {
    ia = await avviaFakePcIa({ secret: S });
    const url = ia.url;
    await ia.chiudi(); ia = null;
    const e = await new ClienteIa({ url, secret: S }).salute().catch(x => x);
    expect(e).toBeInstanceOf(ErroreRete);
    expect(e).toMatchObject({ causa: 'rete' });
  });

  it('risposta lenta: timeout', async () => {
    ia = await avviaFakePcIa({ secret: S, ritardoMs: 400 });
    const e = await cliente({ timeoutConnessioneMs: 50 }).salute().catch(x => x);
    expect(e).toBeInstanceOf(ErroreRete);
    expect(e).toMatchObject({ causa: 'timeout' });
  });

  it('risposta che non e\' della PC IA (HTML) o fuori contratto: ErroreContratto', async () => {
    ia = await avviaFakePcIa({ secret: S, rispostaNonJson: true });
    expect(await cliente().salute().catch(x => x)).toBeInstanceOf(ErroreContratto);
    await ia.chiudi();
    ia = await avviaFakePcIa({ secret: S });
    const f = (async () => new Response(JSON.stringify({ schema: 2 }), { status: 200 })) as unknown as typeof fetch;
    expect(await new ClienteIa({ url: ia.url, secret: S, fetchImpl: f }).salute().catch(x => x)).toBeInstanceOf(ErroreContratto);
  });

  it('indirizzo non valido o con protocollo strano: errore subito', () => {
    expect(() => new ClienteIa({ url: 'non-un-url', secret: S })).toThrow(ErroreContratto);
    expect(() => new ClienteIa({ url: 'ftp://pc-ia', secret: S })).toThrow(/http/);
  });

  it('annullare un lavoro', async () => {
    ia = await avviaFakePcIa({ secret: S });
    const c = cliente();
    await c.inviaSigle(snapshot);
    const a = await c.avviaAnalisi(Buffer.from('x'), 's.xls', meta);
    await c.annulla(a.id);
    expect(await c.stato(a.id).catch(x => x)).toMatchObject({ http: 404 });
  });

  it('il multipart e\' ben formato e il nome del file e\' ripulito', () => {
    const { corpo, tipo } = costruisciMultipart([{ nome: 'file', nomeFile: 'a"b\r\n.xls', tipo: 'application/octet-stream', dati: Buffer.from([0, 1, 2, 255]) }], 'BORDO');
    expect(tipo).toBe('multipart/form-data; boundary=BORDO');
    const t = corpo.toString('latin1');
    expect(t.startsWith('--BORDO\r\n')).toBe(true);
    expect(t.endsWith('--BORDO--\r\n')).toBe(true);
    expect(t).toContain('filename="a_b__.xls"');
    expect(corpo.includes(Buffer.from([0, 1, 2, 255]))).toBe(true);
  });
});
