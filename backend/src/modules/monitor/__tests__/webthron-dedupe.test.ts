import { describe, it, expect } from 'vitest';
import { dedupeByKey } from '../webthron-dedupe.js';

const at = (s: string) => new Date(`2026-10-12T${s}Z`);
const row = (over: Record<string, unknown> = {}) => ({
  fase: 'F1', cod_seriale: 'S1', data_inserimento: at('08:00:00'),
  commessa: null as string | null, versione: null as string | null, ...over,
});

describe('dedupeByKey', () => {
  it('lascia invariate le righe con chiavi diverse', () => {
    const out = dedupeByKey([row(), row({ cod_seriale: 'S2' }), row({ data_inserimento: at('08:00:01') })]);
    expect(out).toHaveLength(3);
  });

  it('unisce due righe con la stessa chiave e completa i campi vuoti', () => {
    const out = dedupeByKey([row({ versione: 'DX' }), row({ commessa: 'C1', versione: 'SX' })]);
    expect(out).toHaveLength(1);
    expect(out[0].versione).toBe('DX');      // vince la prima non vuota
    expect(out[0].commessa).toBe('C1');      // completata dalla seconda
  });

  it('non modifica le righe di partenza e mantiene l\'ordine della prima comparsa', () => {
    const a = row({ cod_seriale: 'A' });
    const b = row({ cod_seriale: 'B' });
    const out = dedupeByKey([a, b, row({ cod_seriale: 'A', commessa: 'X' })]);
    expect(out.map(r => r.cod_seriale)).toEqual(['A', 'B']);
    expect(a.commessa).toBeNull();
  });
});
