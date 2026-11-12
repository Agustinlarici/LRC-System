import { describe, it, expect } from 'vitest';
import { dayBoundsNaive, buildRangeSlices, isQuietHour, pastDays, daysToReread } from '../webthron-time.js';

describe('daysToReread', () => {
  it('alle 01:00 rilegge ieri e l\'altro ieri', () => {
    expect(daysToReread('2026-11-11', 2, false)).toEqual(['2026-11-10', '2026-11-09']);
  });

  it('alle 23:30 rilegge oggi e ieri', () => {
    expect(daysToReread('2026-11-11', 2, true)).toEqual(['2026-11-11', '2026-11-10']);
  });

  it('attraversa il cambio di mese e con un solo giorno legge solo oggi', () => {
    expect(daysToReread('2026-12-01', 2, true)).toEqual(['2026-12-01', '2026-11-30']);
    expect(daysToReread('2026-12-01', 1, true)).toEqual(['2026-12-01']);
  });
});

describe('pastDays', () => {
  it('parte da ieri e va indietro, senza includere oggi', () => {
    expect(pastDays('2026-11-06', 3)).toEqual(['2026-11-05', '2026-11-04', '2026-11-03']);
  });

  it('attraversa mese e anno', () => {
    expect(pastDays('2027-01-02', 3)).toEqual(['2027-01-01', '2026-12-31', '2026-12-30']);
    expect(pastDays('2026-03-02', 2)).toEqual(['2026-03-01', '2026-02-28']);
  });

  it('90 giorni = 90 date distinte, in ordine decrescente', () => {
    const d = pastDays('2026-11-06', 90);
    expect(d).toHaveLength(90);
    expect(new Set(d).size).toBe(90);
    expect(d[0]).toBe('2026-11-05');
    expect(d[89]).toBe('2026-08-08');
    expect([...d].sort().reverse()).toEqual(d);
  });
});

describe('dayBoundsNaive', () => {
  it('equivale a DATE(CONVERT_TZ(datain, +00:00, +01:00)) = giorno: da 23:00 del giorno prima a 23:00', () => {
    expect(dayBoundsNaive('2026-11-05')).toEqual({ from: '2026-11-04 23:00:00', to: '2026-11-05 23:00:00' });
  });

  it('gestisce cambio di mese e di anno', () => {
    expect(dayBoundsNaive('2026-03-01')).toEqual({ from: '2026-02-28 23:00:00', to: '2026-03-01 23:00:00' });
    expect(dayBoundsNaive('2027-01-01')).toEqual({ from: '2026-12-31 23:00:00', to: '2027-01-01 23:00:00' });
  });
});

describe('buildRangeSlices', () => {
  it('un giorno = 6 rebanadine da 4 ore, contigue e senza buchi', () => {
    const s = buildRangeSlices('2026-11-05', '2026-11-05', 4);
    expect(s).toHaveLength(6);
    expect(s[0].from).toBe('2026-11-04 23:00:00');
    expect(s[5].to).toBe('2026-11-05 23:00:00');
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBe(s[i - 1].to);
  });

  it('più giorni: copre l\'intero intervallo e rispetta il limite di ogni rebanadina', () => {
    const s = buildRangeSlices('2026-11-03', '2026-11-05', 4);
    expect(s).toHaveLength(18);
    expect(s[0].from).toBe('2026-11-02 23:00:00');
    expect(s[17].to).toBe('2026-11-05 23:00:00');
  });

  it('se la durata non divide il giorno, l\'ultima rebanadina si ferma al limite', () => {
    const s = buildRangeSlices('2026-11-05', '2026-11-05', 5);
    expect(s).toHaveLength(5);
    expect(s[4].to).toBe('2026-11-05 23:00:00');
  });

  it('intervallo invertito: nessuna rebanadina', () => {
    expect(buildRangeSlices('2026-11-06', '2026-11-05')).toEqual([]);
  });
});

describe('isQuietHour (ora di Roma)', () => {
  // 7 novembre 2026: ora solare (UTC+1)
  const at = (utc: string) => new Date(`2026-11-07T${utc}:00Z`);

  it('fascia a cavallo della mezzanotte (23 → 5)', () => {
    expect(isQuietHour(at('22:00'), 23, 5)).toBe(true);   // 23:00 Roma
    expect(isQuietHour(at('23:30'), 23, 5)).toBe(true);   // 00:30 Roma
    expect(isQuietHour(at('03:30'), 23, 5)).toBe(true);   // 04:30 Roma
    expect(isQuietHour(at('04:00'), 23, 5)).toBe(false);  // 05:00 Roma
    expect(isQuietHour(at('10:00'), 23, 5)).toBe(false);  // 11:00 Roma
    expect(isQuietHour(at('21:59'), 23, 5)).toBe(false);  // 22:59 Roma
  });

  it('fascia nello stesso giorno e fascia disattivata', () => {
    expect(isQuietHour(at('12:00'), 13, 15)).toBe(true);   // 13:00 Roma
    expect(isQuietHour(at('09:00'), 13, 15)).toBe(false);
    expect(isQuietHour(at('12:00'), 0, 0)).toBe(false);
  });
});
