import { describe, it, expect } from 'vitest';
import { peekFields, cleanIp } from '../iknow-log.js';

describe('peekFields', () => {
  it('prende solo i campi noti, come stringa e troncati', () => {
    const r = peekFields({ seriale: 'A1', commessa: 123, fase: 'x'.repeat(500), extra: 'segreto', componente: { a: 1 } });
    expect(r).toEqual({ seriale: 'A1', commessa: '123', fase: 'x'.repeat(80) });
  });
  it('corpo non oggetto o assente: nessun campo', () => {
    expect(peekFields(null)).toEqual({});
    expect(peekFields('testo')).toEqual({});
    expect(peekFields([1, 2])).toEqual({});
  });
});

describe('cleanIp', () => {
  it('usa il primo indirizzo, senza caratteri di controllo, max 64', () => {
    expect(cleanIp('10.0.0.5, 192.168.1.1')).toBe('10.0.0.5');
    expect(cleanIp('1.2.3.4\r\nX-Evil: 1')).toBe('1.2.3.4X-Evil: 1');
    expect(cleanIp('a'.repeat(200))).toHaveLength(64);
    expect(cleanIp(undefined)).toBeNull();
    expect(cleanIp('')).toBeNull();
  });
});
