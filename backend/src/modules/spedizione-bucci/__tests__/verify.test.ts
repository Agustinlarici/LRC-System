import { describe, it, expect, vi } from 'vitest';
import { planResolution } from '../verify.js';
import type { BucciUnit } from '../lookup.js';

vi.mock('../../monitor/mysql-client.js', () => ({ getWebthronPool: vi.fn() }));

const unit = (seriale: string, commessa: string): BucciUnit =>
  ({ seriale, commessa, componente: 'cofano', modello: null });

describe('planResolution', () => {
  it('risolve un seriale ignorando maiuscole/minuscole', () => {
    const { resolved, problems } = planResolution(
      [{ id: 1, scanned_code: 'abc123' }], new Set(), [unit('ABC123', '1111')], []);
    expect(problems).toEqual([]);
    expect(resolved).toEqual([{ item_id: 1, unit: unit('ABC123', '1111') }]);
  });

  it('segnala un seriale non trovato', () => {
    const { resolved, problems } = planResolution([{ id: 1, scanned_code: 'XYZ' }], new Set(), [], []);
    expect(resolved).toEqual([]);
    expect(problems).toEqual([{ item_id: 1, scanned_code: 'XYZ', kind: 'not_found' }]);
  });

  it('segnala come doppio un seriale già presente nella spedizione', () => {
    const { problems } = planResolution(
      [{ id: 2, scanned_code: 'ABC123' }], new Set(['ABC123']), [unit('ABC123', '1111')], []);
    expect(problems).toEqual([{ item_id: 2, scanned_code: 'ABC123', kind: 'duplicate', seriale: 'ABC123' }]);
  });

  it('risolve una commessa con un solo seriale', () => {
    const { resolved } = planResolution(
      [{ id: 1, scanned_code: "BUCC'0'1002P.1'0003119" }], new Set(), [], [unit('S1', '3119')]);
    expect(resolved).toEqual([{ item_id: 1, unit: unit('S1', '3119') }]);
  });

  it('chiede di scegliere se la commessa ha più seriali del numero di scansioni', () => {
    const { resolved, problems } = planResolution(
      [{ id: 1, scanned_code: 'BUCC0003119' }], new Set(), [], [unit('S1', '3119'), unit('S2', '3119')]);
    expect(resolved).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ item_id: 1, kind: 'ambiguous' });
  });

  it('non propone come candidati i seriali già presenti', () => {
    const { resolved } = planResolution(
      [{ id: 1, scanned_code: 'BUCC0003119' }], new Set(['S1']), [], [unit('S1', '3119'), unit('S2', '3119')]);
    expect(resolved).toEqual([{ item_id: 1, unit: unit('S2', '3119') }]);
  });

  it('assegna in ordine quando scansioni e seriali della commessa sono pari', () => {
    const { resolved, problems } = planResolution(
      [{ id: 1, scanned_code: 'BUCC0003119' }, { id: 2, scanned_code: 'BUCC0003119' }],
      new Set(), [], [unit('S1', '3119'), unit('S2', '3119')]);
    expect(problems).toEqual([]);
    expect(resolved.map(r => r.unit.seriale)).toEqual(['S1', 'S2']);
  });

  it('commessa senza righe in iKnow → non trovato', () => {
    const { problems } = planResolution([{ id: 1, scanned_code: 'BUCC0009999' }], new Set(), [], []);
    expect(problems).toEqual([{ item_id: 1, scanned_code: 'BUCC0009999', kind: 'not_found' }]);
  });

  it('commessa con tutti i seriali già presenti → doppio', () => {
    const { problems } = planResolution(
      [{ id: 1, scanned_code: 'BUCC0003119' }], new Set(['S1']), [], [unit('S1', '3119')]);
    expect(problems).toEqual([{ item_id: 1, scanned_code: 'BUCC0003119', kind: 'duplicate', seriale: 'S1' }]);
  });
});
