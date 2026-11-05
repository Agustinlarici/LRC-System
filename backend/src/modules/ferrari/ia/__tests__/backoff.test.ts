import { describe, expect, it } from 'vitest';
import { ATTESE_MINUTI, attesaMs, hasSuperatoMax, JITTER, prossimoTentativo } from '../backoff.js';

describe('attesa crescente', () => {
  it('segue 1, 2, 5, 15, 60 minuti e poi resta a 60', () => {
    const mezzo = () => 0.5;                                   // rand = 0.5 → nessuno scarto
    expect([1, 2, 3, 4, 5, 6, 20].map(n => attesaMs(n, mezzo) / 60_000)).toEqual([1, 2, 5, 15, 60, 60, 60]);
    expect(ATTESE_MINUTI).toEqual([1, 2, 5, 15, 60]);
  });
  it('il casuale resta entro ±20%', () => {
    for (const n of [1, 3, 5]) {
      const base = ATTESE_MINUTI[n - 1]! * 60_000;
      expect(attesaMs(n, () => 0)).toBe(Math.round(base * (1 - JITTER)));
      expect(attesaMs(n, () => 0.999999)).toBeLessThanOrEqual(Math.round(base * (1 + JITTER)));
    }
  });
  it('tentativi 0 o negativi si trattano come il primo', () => {
    expect(attesaMs(0, () => 0.5)).toBe(60_000);
    expect(attesaMs(-3, () => 0.5)).toBe(60_000);
  });
  it('prossimoTentativo parte dall\'ora data e il massimo si controlla con >=', () => {
    const t = new Date('2026-11-05T10:00:00Z');
    expect(prossimoTentativo(t, 2, () => 0.5).toISOString()).toBe('2026-11-05T10:02:00.000Z');
    expect(hasSuperatoMax(5, 6)).toBe(false);
    expect(hasSuperatoMax(6, 6)).toBe(true);
  });
});
