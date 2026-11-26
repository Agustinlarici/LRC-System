// Cliente HTTP della PC IA (API v1). Richieste firmate, timeout, errori tipizzati, risposte validate con zod.
// Non conosce il database ne' la coda: si puo' provare da solo contro una PC IA finta.

import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { intestazioniFirmate } from './firma.js';
import {
  AvvioSchema, ErroreSchema, SaluteSchema, SigleOkSchema, StatoAnalisiSchema,
  type Avvio, type MetaAnalisi, type Salute, type SnapshotSigle, type StatoAnalisi,
} from './contratto.js';

/** La PC IA non e' raggiungibile o non risponde in tempo: si riprova. */
export class ErroreRete extends Error {
  constructor(message: string, readonly causa: 'rete' | 'timeout') { super(message); this.name = 'ErroreRete'; }
}
/** La PC IA ha risposto con un errore (corpo secondo contratto). `ritentabile`: 5xx, 408, 429. */
export class ErroreIa extends Error {
  constructor(message: string, readonly http: number, readonly codice: string) { super(message); this.name = 'ErroreIa'; }
  get ritentabile(): boolean { return this.http >= 500 || this.http === 408 || this.http === 429; }
}
/** La risposta non rispetta il contratto (versione diversa, PC IA sbagliata...): non si riprova da solo. */
export class ErroreContratto extends Error {
  constructor(message: string) { super(message); this.name = 'ErroreContratto'; }
}

export interface OpzioniCliente {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
  adesso?: () => number;
  timeoutMs?: number;            // per richiesta (default 30 s)
  timeoutConnessioneMs?: number; // per /salute e le richieste brevi (default 5 s)
}

interface Parte { nome: string; nomeFile?: string; tipo: string; dati: Buffer }

/** Multipart fatto a mano: serve il corpo esatto per firmarlo (fetch non lo mostra). */
export function costruisciMultipart(parti: Parte[], boundary = `----ferrari${randomUUID().replace(/-/g, '')}`): { corpo: Buffer; tipo: string } {
  const pezzi: Buffer[] = [];
  for (const p of parti) {
    const nome = p.nome.replace(/["\r\n]/g, '');
    const file = p.nomeFile ? `; filename="${p.nomeFile.replace(/["\r\n\\]/g, '_')}"` : '';
    pezzi.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${nome}"${file}\r\nContent-Type: ${p.tipo}\r\n\r\n`), p.dati, Buffer.from('\r\n'));
  }
  pezzi.push(Buffer.from(`--${boundary}--\r\n`));
  return { corpo: Buffer.concat(pezzi), tipo: `multipart/form-data; boundary=${boundary}` };
}

export class ClienteIa {
  private readonly base: URL;
  private readonly f: typeof fetch;
  private readonly adesso: () => number;
  private readonly timeoutMs: number;
  private readonly timeoutBreveMs: number;

  constructor(private readonly o: OpzioniCliente) {
    let u: URL;
    try { u = new URL(o.url); } catch { throw new ErroreContratto(`Indirizzo della PC IA non valido: ${o.url}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ErroreContratto('L\'indirizzo della PC IA deve iniziare con http:// o https://');
    this.base = u;
    this.f = o.fetchImpl ?? fetch;
    this.adesso = o.adesso ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.timeoutBreveMs = o.timeoutConnessioneMs ?? 5_000;
  }

  private percorso(p: string): string {
    return `${this.base.pathname.replace(/\/+$/, '')}${p}`;
  }

  private async chiama<T>(metodo: string, p: string, schema: ZodType<T>, opt: { corpo?: Buffer | string; tipo?: string; breve?: boolean } = {}): Promise<T> {
    const percorso = this.percorso(p);
    const corpo = opt.corpo ?? '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opt.breve ? this.timeoutBreveMs : this.timeoutMs);
    let r: Response;
    try {
      r = await this.f(new URL(percorso, this.base), {
        method: metodo,
        headers: { ...intestazioniFirmate(this.o.secret, metodo, percorso, corpo, this.adesso), ...(opt.tipo ? { 'Content-Type': opt.tipo } : {}), Accept: 'application/json' },
        body: corpo.length ? new Uint8Array(typeof corpo === 'string' ? Buffer.from(corpo) : corpo) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e as Error).name === 'AbortError';
      throw new ErroreRete(aborted ? 'La PC IA non risponde in tempo' : `La PC IA non e' raggiungibile (${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message})`, aborted ? 'timeout' : 'rete');
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try { json = await r.json(); } catch { throw r.ok ? new ErroreContratto('Risposta della PC IA non valida (non e\' JSON)') : new ErroreIa(`La PC IA ha risposto ${r.status}`, r.status, 'risposta_non_json'); }
    if (!r.ok) {
      const e = ErroreSchema.safeParse(json);
      throw e.success ? new ErroreIa(e.data.errore.messaggio, r.status, e.data.errore.codice) : new ErroreIa(`La PC IA ha risposto ${r.status}`, r.status, 'sconosciuto');
    }
    const ok = schema.safeParse(json);
    if (!ok.success) throw new ErroreContratto(`Risposta della PC IA fuori contratto: ${ok.error.issues[0]?.path.join('.') || 'radice'} — ${ok.error.issues[0]?.message ?? ''}`);
    return ok.data;
  }

  salute(): Promise<Salute> {
    return this.chiama('GET', '/v1/salute', SaluteSchema, { breve: true });
  }

  /** Manda le sigle (idempotente: stessa versione = stesso contenuto). */
  async inviaSigle(s: SnapshotSigle): Promise<string> {
    return (await this.chiama('PUT', '/v1/sigle', SigleOkSchema, { corpo: JSON.stringify(s), tipo: 'application/json' })).versione_sigle;
  }

  avviaAnalisi(file: Buffer, nomeFile: string, meta: MetaAnalisi): Promise<Avvio> {
    const { corpo, tipo } = costruisciMultipart([
      { nome: 'meta', tipo: 'application/json', dati: Buffer.from(JSON.stringify(meta)) },
      { nome: 'file', nomeFile, tipo: 'application/octet-stream', dati: file },
    ]);
    return this.chiama('POST', '/v1/analisi', AvvioSchema, { corpo, tipo });
  }

  stato(id: string): Promise<StatoAnalisi> {
    return this.chiama('GET', `/v1/analisi/${encodeURIComponent(id)}`, StatoAnalisiSchema, { breve: true });
  }

  async annulla(id: string): Promise<void> {
    await this.chiama('DELETE', `/v1/analisi/${encodeURIComponent(id)}`, AvvioSchema, { breve: true });
  }
}
