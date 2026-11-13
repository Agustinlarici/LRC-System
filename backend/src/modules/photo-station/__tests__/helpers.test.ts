import { describe, it, expect } from 'vitest';
import { bearerToken, CAMERA_RE, isJpeg, newStationToken, normalizeCommessa, sha256Hex } from '../helpers.js';

describe('Photo Station — helpers', () => {
  it('normalizza la commessa come Photo Station (trim e caratteri di controllo)', () => {
    expect(normalizeCommessa('  ORD-1\r\n')).toBe('ORD-1');
    expect(normalizeCommessa('A\tB')).toBe('AB');
    expect(normalizeCommessa('   ')).toBe('');
  });
  it('riconosce un JPEG completo e rifiuta il resto', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]))).toBe(true);
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBe(false);   // tagliato
    expect(isJpeg(Buffer.from('<html>'))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
  it('il nome camera non può contenere percorsi', () => {
    for (const bad of ['../x', 'CAM/01', 'a b', '', 'x'.repeat(21), 'CAM01.jpg']) expect(CAMERA_RE.test(bad)).toBe(false);
    expect(CAMERA_RE.test('CAM01')).toBe(true);
  });
  it('il token si genera lungo, si legge dal header e nel DB va solo l\'hash', () => {
    const { token, hash } = newStationToken();
    expect(token).toHaveLength(64);
    expect(hash).toBe(sha256Hex(token));
    expect(hash).not.toContain(token);
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken('Bearer corto')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

import { bearerTokenAny, normalizePhase } from '../helpers.js';
import { parseDataOra } from '../iknow.js';

describe('Photo Station — iKnow', () => {
  it('normalizza la fase come codice del catalogo', () => {
    expect(normalizePhase('Delibera Finale')).toBe('delibera_finale');
    expect(normalizePhase(' delibera-finale-proximiti ')).toBe('delibera_finale_proximiti');
    expect(normalizePhase('!!!')).toBeNull();
    expect(normalizePhase('x'.repeat(41))).toBeNull();
  });
  it('legge data_ora con e senza fuso', () => {
    expect(parseDataOra('2026-10-27 10:00:00+02:00')?.toISOString()).toBe('2026-10-27T08:00:00.000Z');
    expect(parseDataOra('2026-10-27T10:00:00Z')?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
    expect(parseDataOra('ieri')).toBeNull();
  });
  it('il token di iKnow ammette solo caratteri sicuri e lunghezza minima', () => {
    expect(bearerTokenAny('Bearer abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(bearerTokenAny('Bearer corto')).toBeNull();
    expect(bearerTokenAny('Bearer con spazio nel token')).toBeNull();
  });
});
