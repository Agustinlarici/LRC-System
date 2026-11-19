import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { leggiPrezzo, leggiRegoleExcel } from '../import-regole.js';

const excel = (righe: unknown[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Regole');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const INT = ['Articolo', 'Cerca 1', 'Cerca 2', 'Cerca 3', 'Distanza', 'Prezzo', 'Note'];

describe('import regole da Excel', () => {
  it('una distanza per ogni parola (Distanza 1, 2, 3); vuota = ovunque', () => {
    const e = leggiRegoleExcel(excel([
      ['Articolo', 'Cerca 1', 'Distanza 1', 'Cerca 2', 'Distanza 2', 'Cerca 3', 'Distanza 3', 'Prezzo'],
      ['A1', 'PPE1', 30, 'ROSSO', 20, 'OPACO', '', 9],
      ['A2', 'X', '', '', 5, 'Z', 7, 9],   // 2ª parola vuota: la 3ª passa al suo posto con la sua distanza
    ]));
    expect(e.regole[0]!.passi).toEqual([{ cerca: ['PPE1'], finestra: 30 }, { cerca: ['ROSSO'], finestra: 20 }, { cerca: ['OPACO'], finestra: null }]);
    expect(e.regole[1]!.passi).toEqual([{ cerca: ['X'], finestra: null }, { cerca: ['Z'], finestra: 7 }]);
  });
  it('legge catena di parole, distanza unica (formato vecchio), prezzo e note', () => {
    const e = leggiRegoleExcel(excel([INT, ['art1', 'PPE1', 'ROSSO, NERO', 'OPACO', 20, '12,50', 'vernice']]));
    expect(e.skipped).toBe(0);
    expect(e.regole[0]).toEqual({
      nome: 'vernice', attiva: true, article_code: 'art1', prezzo: 12.5,
      passi: [{ cerca: ['PPE1'], finestra: null }, { cerca: ['ROSSO', 'NERO'], finestra: 20 }, { cerca: ['OPACO'], finestra: 20 }],
    });
  });
  it('senza parole = prezzo base; «tutti» = *; le colonne vuote in mezzo si compattano', () => {
    const e = leggiRegoleExcel(excel([INT, ['tutti', '', '', '', '', 5, ''], ['A2', 'X', '', 'Y', '', 3, '']]));
    expect(e.regole[0]).toMatchObject({ article_code: '*', passi: [], prezzo: 5 });
    expect(e.regole[1]!.passi.map(x => x.cerca)).toEqual([['X'], ['Y']]);
  });
  it('salta le righe senza articolo o con prezzo non valido, e dice quali', () => {
    const e = leggiRegoleExcel(excel([INT, ['', 'X', '', '', '', 1, ''], ['A1', 'X', '', '', '', 'abc', ''], ['A1', 'X', '', '', '', 2, '']]));
    expect(e.regole).toHaveLength(1);
    expect(e.skipped).toBe(2);
    expect(e.warnings.join(' ')).toMatch(/Riga 2.*articolo/);
    expect(e.warnings.join(' ')).toMatch(/Riga 3.*prezzo/);
  });
  it('colonne minime mancanti: non carica nulla', () => {
    const e = leggiRegoleExcel(excel([['Foo', 'Bar'], ['a', 'b']]));
    expect(e.regole).toHaveLength(0);
    expect(e.warnings[0]).toMatch(/Colonne minime/);
  });
  it('prezzi in formato italiano e inglese', () => {
    expect(leggiPrezzo('1.234,56')).toBe(1234.56);
    expect(leggiPrezzo('12,5')).toBe(12.5);
    expect(leggiPrezzo('12.5')).toBe(12.5);
    expect(leggiPrezzo('€ 10')).toBe(10);
    expect(leggiPrezzo('')).toBeNaN();
  });
});
