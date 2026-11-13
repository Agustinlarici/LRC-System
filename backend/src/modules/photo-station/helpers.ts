// Photo Station: funzioni pure (senza DB) per commessa, foto e token delle stazioni.
import { createHash, randomBytes } from 'node:crypto';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;   // un JPEG da 16 MP a qualità 100 pesa ~4 MB
export const CAMERA_RE = /^[A-Za-z0-9_-]{1,20}$/;  // "CAM01": finisce nel nome del file, mai altro
export const STALE_CLAIM_MINUTES = 5;              // ordine preso da una stazione che poi sparisce
export const MAX_ATTEMPTS = 3;

/** Come CommessaService di Photo Station: niente caratteri di controllo, spazi tagliati. */
export function normalizeCommessa(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newStationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256Hex(token) };
}

export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9]{32,128})$/.exec(header ?? '');
  return m ? m[1] : null;
}

/** Token di iKnow: scelto dall'azienda, quindi più libero del token stazione (solo caratteri sicuri in un header). */
export function bearerTokenAny(header: string | undefined): string | null {
  const m = /^Bearer ([\x21-\x7e]{16,200})$/.exec(header ?? '');
  return m ? m[1] : null;
}

/** "Delibera Finale" / "delibera-finale" -> "delibera_finale" (codice fase del catalogo). */
export function normalizePhase(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z0-9_]{1,40}$/.test(key) ? key : null;
}
