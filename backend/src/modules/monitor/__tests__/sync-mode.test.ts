import { describe, it, expect } from 'vitest';
import { planTick, isSyncMode } from '../sync-mode.js';

describe('planTick', () => {
  it('incrementale: sempre e solo l\'incrementale', () => {
    for (const cycle of [1, 3, 6, 12]) {
      expect(planTick('incremental', cycle, 6, false)).toEqual({ incremental: true, full: false });
    }
  });

  it('full: lancia i 90 giorni solo se non ce n\'è già uno in corso, mai l\'incrementale', () => {
    expect(planTick('full', 1, 6, false)).toEqual({ incremental: false, full: true });
    expect(planTick('full', 2, 6, true)).toEqual({ incremental: false, full: false });
  });

  it('mista: incrementale sempre, 90 giorni ogni N cicli', () => {
    expect(planTick('mixed', 5, 6, false)).toEqual({ incremental: true, full: false });
    expect(planTick('mixed', 6, 6, false)).toEqual({ incremental: true, full: true });
    expect(planTick('mixed', 12, 6, false)).toEqual({ incremental: true, full: true });
  });

  it('mista: se i 90 giorni girano ancora, salta senza accodare', () => {
    expect(planTick('mixed', 6, 6, true)).toEqual({ incremental: true, full: false });
  });

  it('mista con 0 cicli configurati non divide per zero', () => {
    expect(planTick('mixed', 3, 0, false).full).toBe(true);
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
