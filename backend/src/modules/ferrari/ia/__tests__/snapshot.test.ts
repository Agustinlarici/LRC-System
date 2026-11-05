import { describe, expect, it } from 'vitest';
import { costruisciSnapshot } from '../snapshot.js';
import { SnapshotSigleSchema } from '../contratto.js';

const base = { colonne: ['LIVR', 'BIC2'], sotto_sigle: [{ codice: 'TLM13', padre: 'LIVR' }], alias: { TLM15: 'TLM16' }, modelli: ['F999XX'] };

describe('snapshot delle sigle', () => {
  it('e\' valido secondo il contratto e la versione e\' lo sha256 del contenuto', () => {
    const s = costruisciSnapshot(base);
    expect(SnapshotSigleSchema.parse(s)).toEqual(s);
    expect(s.versione_sigle).toMatch(/^[0-9a-f]{64}$/);
  });
  it('l\'ordine e i doppioni non cambiano la versione; il contenuto si', () => {
    const a = costruisciSnapshot(base);
    const b = costruisciSnapshot({ ...base, colonne: ['BIC2', 'LIVR', 'LIVR'], modelli: ['F999XX', 'F999XX'] });
    expect(b.versione_sigle).toBe(a.versione_sigle);
    expect(costruisciSnapshot({ ...base, colonne: [...base.colonne, 'CEXS'] }).versione_sigle).not.toBe(a.versione_sigle);
    expect(costruisciSnapshot({ ...base, alias: { TLM15: 'TLM17' } }).versione_sigle).not.toBe(a.versione_sigle);
  });
  it('una sotto-sigla con padri diversi nei modelli vale «in qualsiasi voce»', () => {
    const s = costruisciSnapshot({ ...base, sotto_sigle: [{ codice: 'TLM13', padre: 'LIVR' }, { codice: 'TLM13', padre: 'BIC2' }] });
    expect(s.sotto_sigle).toEqual([{ codice: 'TLM13', padre: null }]);
  });
  it('vuoto e' + ' valido (nessuna sigla ancora)', () => {
    const s = costruisciSnapshot({ colonne: [], sotto_sigle: [], alias: {}, modelli: [] });
    expect(SnapshotSigleSchema.parse(s).colonne).toEqual([]);
  });
});
