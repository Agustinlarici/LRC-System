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

describe('vettore condiviso con la PC IA (stesso hash in TypeScript e in Python)', () => {
  it('la versione delle sigle coincide con quella calcolata dalla PC IA', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const v = JSON.parse(readFileSync(fileURLToPath(new URL('./contratto-v1.json', import.meta.url)), 'utf8')) as { snapshot: ReturnType<typeof costruisciSnapshot> };
    const { versione_sigle: _versione, ...corpo } = v.snapshot;
    expect(costruisciSnapshot(corpo).versione_sigle).toBe(v.snapshot.versione_sigle);
    expect(v.snapshot.versione_sigle).toBe('cfdf59342ec54ad64c34779e424e8730e14b94102f8f532329085ae33349de4b');
  });
});

describe('decisioni complete e componenti (campi facoltativi)', () => {
  const dec = (modello: string, codice: string, va: boolean) => ({ modello, codice, va, sub: false, alias: null, nosigla: false, padre: null });
  it('senza decisioni ne\' componenti l\'hash resta quello di prima; con le decisioni cambia', () => {
    const a = costruisciSnapshot(base);
    expect('decisioni' in a || 'componenti' in a).toBe(false);
    const b = costruisciSnapshot({ ...base, decisioni: [dec('*', '0TMC', false)] });
    expect(b.decisioni).toHaveLength(1);
    expect(b.versione_sigle).not.toBe(a.versione_sigle);
  });
  it('doppioni (stesso modello e codice) si tolgono; l\'ordine della VM si conserva', () => {
    const s = costruisciSnapshot({ ...base, decisioni: [dec('*', 'B', true), dec('F1', 'A', false), dec('*', 'B', false)] });
    expect(s.decisioni?.map(d => `${d.modello}:${d.codice}:${d.va}`)).toEqual(['*:B:true', 'F1:A:false']);
  });
  it('vettore condiviso con le decisioni: stesso hash in TypeScript e in Python', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const v = JSON.parse(readFileSync(fileURLToPath(new URL('./contratto-v1.json', import.meta.url)), 'utf8')) as { snapshot_v2: ReturnType<typeof costruisciSnapshot> };
    const { versione_sigle: _v, ...corpo } = v.snapshot_v2;
    expect(costruisciSnapshot(corpo)).toEqual(v.snapshot_v2);
    expect(SnapshotSigleSchema.parse(v.snapshot_v2)).toEqual(v.snapshot_v2);
    expect(v.snapshot_v2.versione_sigle).toBe('88ba7a685291ad08ad8e0aae2c2ac0dc563268ec11ab3a0d787c3f0dcdf887f3');
  });
});
