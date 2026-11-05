// Firma delle richieste VM → PC IA (HMAC-SHA256, nessun login). Stesso segreto dei pacchetti (FERRARI_BUNDLE_SECRET).
// Intestazioni: X-Ferrari-Time (epoch s), X-Ferrari-Nonce (UUID), X-Ferrari-Signature (hex).

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const FINESTRA_S = 300;                 // la PC IA rifiuta richieste con l'ora piu' lontana di 5 minuti

export interface DatiFirma { metodo: string; percorso: string; time: number; nonce: string; corpo: Buffer | string }

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Stringa firmata: metodo, percorso (senza host), ora, nonce e hash del corpo, uno per riga. */
export function stringaDaFirmare(d: DatiFirma): string {
  return [d.metodo.toUpperCase(), d.percorso, String(d.time), d.nonce, sha256(d.corpo)].join('\n');
}

export function firma(secret: string, d: DatiFirma): string {
  return createHmac('sha256', secret).update(stringaDaFirmare(d)).digest('hex');
}

export function intestazioniFirmate(
  secret: string, metodo: string, percorso: string, corpo: Buffer | string, adesso: () => number = () => Date.now(), nonce: () => string = randomUUID,
): Record<string, string> {
  const time = Math.floor(adesso() / 1000);
  const n = nonce();
  return { 'X-Ferrari-Time': String(time), 'X-Ferrari-Nonce': n, 'X-Ferrari-Signature': firma(secret, { metodo, percorso, time, nonce: n, corpo }) };
}

export type EsitoVerifica = { ok: true } | { ok: false; motivo: 'intestazioni' | 'tempo' | 'firma' };

/** Verifica lato ricevente (la usa la PC IA finta dei test; la PC IA vera fa la stessa cosa in Python). */
export function verificaFirma(secret: string, d: Omit<DatiFirma, 'time' | 'nonce'>, h: Record<string, string | undefined>, adesso: () => number = () => Date.now()): EsitoVerifica {
  const time = Number(h['x-ferrari-time']);
  const nonce = h['x-ferrari-nonce'];
  const atteso = h['x-ferrari-signature'];
  if (!Number.isInteger(time) || !nonce || !atteso) return { ok: false, motivo: 'intestazioni' };
  if (Math.abs(adesso() / 1000 - time) > FINESTRA_S) return { ok: false, motivo: 'tempo' };
  const vero = Buffer.from(firma(secret, { ...d, time, nonce }), 'hex');
  const dato = Buffer.from(atteso, 'hex');
  return vero.length === dato.length && timingSafeEqual(vero, dato) ? { ok: true } : { ok: false, motivo: 'firma' };
}
