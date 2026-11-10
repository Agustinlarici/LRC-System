import { describe, it, expect } from 'vitest';
import { buildBomRecords, chunk } from '../bom-sync.js';

describe('chunk', () => {
  it('spezza in gruppi e tiene il resto', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('buildBomRecords', () => {
  const d = new Date('2026-10-01T10:00:00Z');
  const lista = new Map([['10', 'MODELLO A'], ['20', 'COMP X'], ['30', 'V2']]);

  it('unisce i campi extra e risolve le liste con ikExtraTab', () => {
    const out = buildBomRecords(
      [{ iddocu: 1, datain: d }],
      [
        { iddocu: 1, idcampo: 205, stringa: 'CV-1' },
        { iddocu: 1, idcampo: 246, stringa: 'Descrizione' },
        { iddocu: 1, idcampo: 43,  stringa: '10' },
        { iddocu: 1, idcampo: 265, stringa: 'CI-9' },
        { iddocu: 1, idcampo: 45,  stringa: '20' },
        { iddocu: 1, idcampo: 44,  stringa: '30' },
      ],
      lista,
    );
    expect(out).toEqual([{
      iddocu: 1, data_inserimento: d, codice_vendita: 'CV-1', descrizione: 'Descrizione',
      modello: 'MODELLO A', codint: 'CI-9', componente: 'COMP X', versione: 'V2',
    }]);
  });

  it('un documento senza campi extra resta con i valori vuoti (come il LEFT JOIN)', () => {
    const out = buildBomRecords([{ iddocu: 2, datain: null }], [], lista);
    expect(out[0]).toMatchObject({ iddocu: 2, codice_vendita: null, modello: null, versione: null });
  });

  it('una voce di lista non presente in ikExtraTab resta vuota e un campo non richiesto si ignora', () => {
    const out = buildBomRecords(
      [{ iddocu: 3, datain: d }],
      [
        { iddocu: 3, idcampo: 43, stringa: '999' },
        { iddocu: 3, idcampo: 77, stringa: 'altro' },
        { iddocu: 99, idcampo: 205, stringa: 'di un altro documento' },
      ],
      lista,
    );
    expect(out[0].modello).toBeNull();
    expect(out[0].codice_vendita).toBeNull();
  });
});
