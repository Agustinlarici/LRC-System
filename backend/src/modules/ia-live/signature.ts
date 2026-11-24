// Firma HMAC delle richieste della PC IA verso la VM (stesso schema di /v1, vedi STR-IASystem docs/VM-CONTRATO.md §2.2 e §11).
// Messaggio: METODO \n percorso \n ts \n nonce \n sha256(corpo) — HMAC-SHA256 con il segreto condiviso, in esadecimale minuscolo.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const FINESTRA_S = 300;
const MAX_NONCE = 100;
const MAX_NONCE_CACHE = 10_000;

const nonceViste = new Map<string, number>();   // nonce -> scadenza (ms); un solo uso entro la finestra

export function firma(segreto: string, metodo: string, percorso: string, corpo: Buffer, ts: number, nonce: string): string {
  const msg = [metodo.toUpperCase(), percorso, String(ts), nonce, createHash('sha256').update(corpo).digest('hex')].join('\n');
  return createHmac('sha256', segreto).update(msg).digest('hex');
}

export interface InputFirma {
  segreto: string;
  metodo: string;
  percorso: string;
  corpo: Buffer;
  ts: string | undefined;
  nonce: string | undefined;
  firma: string | undefined;
  ora?: number;   // ms, per i test
}

/** true solo se la firma è valida, il timestamp è nella finestra e il nonce non è già stato usato. */
export function verificaFirma(i: InputFirma): boolean {
  if (!i.segreto || !i.ts || !i.nonce || !i.firma) return false;
  if (!/^[1-9]\d{0,12}$/.test(i.ts)) return false;
  if (i.nonce.length > MAX_NONCE || !/^[\x21-\x7e]+$/.test(i.nonce)) return false;
  if (!/^[0-9a-f]{64}$/.test(i.firma)) return false;
  const ora = i.ora ?? Date.now();
  const ts = Number(i.ts);
  if (Math.abs(ora / 1000 - ts) > FINESTRA_S) return false;
  const atteso = Buffer.from(firma(i.segreto, i.metodo, i.percorso, i.corpo, ts, i.nonce), 'hex');
  const ricevuto = Buffer.from(i.firma, 'hex');
  if (atteso.length !== ricevuto.length || !timingSafeEqual(atteso, ricevuto)) return false;
  // il nonce si registra SOLO dopo aver verificato la firma (chi non conosce il segreto non può riempire la cache)
  for (const [n, scade] of nonceViste) if (scade <= ora) nonceViste.delete(n);
  if (nonceViste.has(i.nonce) || nonceViste.size >= MAX_NONCE_CACHE) return false;
  nonceViste.set(i.nonce, ora + 2 * FINESTRA_S * 1000);
  return true;
}

export function svuotaNonceViste(): void {
  nonceViste.clear();
}
