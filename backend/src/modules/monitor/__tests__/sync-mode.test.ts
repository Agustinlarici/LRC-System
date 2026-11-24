import { describe, it, expect } from 'vitest';
import { planTick, isSyncMode } from '../sync-mode.js';

describe('planTick', () => {
  // ciclo da 300 s: full ogni 2 cicli (10 min), mixed ogni 6 (30 min)
  it('incrementale: sempre e solo l\'incrementale', () => {
    for (const cycle of [1, 3, 6, 12]) {
      expect(planTick('incremental', cycle, 300, false)).toEqual({ incremental: true, full: false });
    }
  });

  it('full: 90 giorni ogni 10 min, mai l\'incrementale', () => {
    expect(planTick('full', 1, 300, false)).toEqual({ incremental: false, full: false });
    expect(planTick('full', 2, 300, false)).toEqual({ incremental: false, full: true });
    expect(planTick('full', 4, 300, false)).toEqual({ incremental: false, full: true });
  });

  it('full: se la precedente gira ancora, salta', () => {
    expect(planTick('full', 2, 300, true)).toEqual({ incremental: false, full: false });
  });

  it('mista: incrementale sempre, 90 giorni ogni 30 min', () => {
    expect(planTick('mixed', 5, 300, false)).toEqual({ incremental: true, full: false });
    expect(planTick('mixed', 6, 300, false)).toEqual({ incremental: true, full: true });
    expect(planTick('mixed', 6, 300, true)).toEqual({ incremental: true, full: false });
  });

  it('ciclo più lungo dell\'intervallo: lancia a ogni ciclo, senza dividere per zero', () => {
    expect(planTick('full', 1, 900, false).full).toBe(true);
    expect(planTick('mixed', 3, 0, false)).toBeDefined();
  });
});

describe('isSyncMode', () => {
  it('accetta solo i tre modi', () => {
    expect(isSyncMode('mixed')).toBe(true);
    expect(isSyncMode('full')).toBe(true);
    expect(isSyncMode('incremental')).toBe(true);
    expect(isSyncMode('altro')).toBe(false);
    expect(isSyncMode(undefined)).toBe(false);
  });
});
