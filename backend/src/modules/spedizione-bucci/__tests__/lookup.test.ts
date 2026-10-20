import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseScan, dedupeBySeriale, lookbackDays } from '../lookup.js';

vi.mock('../../monitor/mysql-client.js', () => ({ getWebthronPool: vi.fn() }));

describe('parseScan', () => {
  it('riconosce una commessa BUCC e prende le ultime 4 cifre', () => {
    expect(parseScan('BUCC1234')).toEqual({ kind: 'commessa', commessa: '1234' });
    expect(parseScan('bucc-00987')).toEqual({ kind: 'commessa', commessa: '0987' });
  });

  it('rifiuta BUCC senza 4 cifre finali', () => {
    expect(parseScan('BUCC12AB')).toBeNull();
    expect(parseScan('BUCC')).toBeNull();
  });

  it('tratta gli altri codici come seriale, con trim', () => {
    expect(parseScan('  ABC123 ')).toEqual({ kind: 'seriale', seriale: 'ABC123' });
  });

  it('rifiuta vuoti, troppo lunghi e caratteri di controllo', () => {
    expect(parseScan('   ')).toBeNull();
    expect(parseScan('A'.repeat(65))).toBeNull();
    expect(parseScan('AB\u0000C')).toBeNull();
  });
});

describe('dedupeBySeriale', () => {
  it('mantiene la prima occorrenza di ogni seriale', () => {
    const rows = [
      { seriale: 'A', componente: 'cofano', commessa: '1', modello: null },
      { seriale: 'B', componente: 'cofano', commessa: '1', modello: null },
      { seriale: 'A', componente: 'cofano', commessa: '2', modello: null },
    ];
    expect(dedupeBySeriale(rows)).toEqual([rows[0], rows[1]]);
  });
});

describe('lookbackDays', () => {
  afterEach(() => { delete process.env.BUCCI_LOOKBACK_DAYS; });

  it('usa 90 giorni di default', () => {
    expect(lookbackDays()).toBe(90);
  });
  it('legge la variabile d\'ambiente e la limita a 365', () => {
    process.env.BUCCI_LOOKBACK_DAYS = '30';
    expect(lookbackDays()).toBe(30);
    process.env.BUCCI_LOOKBACK_DAYS = '9999';
    expect(lookbackDays()).toBe(365);
  });
  it('ignora valori non validi', () => {
    process.env.BUCCI_LOOKBACK_DAYS = 'abc';
    expect(lookbackDays()).toBe(90);
    process.env.BUCCI_LOOKBACK_DAYS = '0';
    expect(lookbackDays()).toBe(90);
  });
});
