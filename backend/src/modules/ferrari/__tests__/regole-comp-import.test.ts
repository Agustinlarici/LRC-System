import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applicaRegole, fattiDaScheda, type RegolaComp } from '../regole-comp-base.js';
import { ImportRegoleError, leggiRegoleExcel } from '../regole-comp-import.js';
import type { Canonico, Opzione } from '../types.js';

const xlsx = (righe: unknown[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Regole');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const INT = ['Se ha', 'Non ha', 'Aggiungi a', 'Valore', 'Modello', 'Ferma'];

describe('carica regole da Excel', () => {
  it('i tre esempi dell\'utente', () => {
    const r = leggiRegoleExcel(xlsx([INT,
      ['AS06 + AS07', '', 'Paraurti', 'AS06', '', 'SI'],
      ['AS06', '', 'Paraurti, Minigonne', '', '', ''],
      ['', 'EXAB', 'Paraurti', 'EXAT', 'F171VS', '']]));
    expect(r.errori).toEqual([]);
    expect(r.righe).toBe(3);
    expect(r.regole.map(x => [x.condizioni.map(c => `${c.tipo}:${'sigla' in c ? c.sigla : ''}`), x.ferma, x.modello])).toEqual([
      [['presente:AS06', 'presente:AS07'], true, '*'],
      [['presente:AS06'], false, '*'],
      [['assente:EXAB'], false, 'F171VS'],
    ]);
    expect(r.regole[0]!.azioni).toEqual([{ componente: 'Paraurti', valore: { tipo: 'sigla', sigla: 'AS06' } }]);
    expect(r.regole[1]!.azioni).toEqual([                                                    // valore vuoto = la sigla di «Se ha»
      { componente: 'Paraurti', valore: { tipo: 'sigla', sigla: 'AS06' } }, { componente: 'Minigonne', valore: { tipo: 'sigla', sigla: 'AS06' } }]);
    expect(r.regole[2]!.azioni).toEqual([{ componente: 'Paraurti', valore: { tipo: 'fisso', testo: 'EXAT' } }]);       // EXAT non e' in «Se ha»: testo fisso
  });

  it('le regole lette funzionano davvero sulle schede (come se fossero state scritte a mano)', () => {
    const r = leggiRegoleExcel(xlsx([INT, ['AS06 + AS07', '', 'Paraurti', 'AS06', '', 'SI'], ['AS06', '', 'Paraurti, Minigonne', '', '', ''], ['', 'EXAB', 'Paraurti', 'EXAT', '', '']]));
    const regole: RegolaComp[] = r.regole.map((x, i) => ({ ...x, id: i + 1 }));
    const opz = (codice: string): Opzione => ({ riga: 1, sezione: null, codice, descrizione: codice, valore: 'SI', nota: '', blocchi_testo: [] });
    const scheda = (cod: string[]): Canonico => ({ schema_version: 1, source: { filename: 'x', sha256: 'x', format: 'xlsx', sheet: 'x' },
      header: { commessa: '1', variante: { codice: null, revisione: null, data: null }, tipo_matricola: { raw: null, modello: 'F171VS', versione: null, mercato_codice: null, mercato_sigla: null, matricola: null, progressivo: null },
        destinazione: { paese: null, codice_mercato: null, raw_mrkt: null }, telaio: null }, opzioni: cod.map(opz), anomalie: [], celle: [] });
    const due = applicaRegole(regole, fattiDaScheda(scheda(['AS06', 'AS07'])));
    expect(Object.keys(due.celle)).toEqual(['Paraurti']);                                   // la specifica ferma la generica
    expect(due.celle['Paraurti']!.map(v => v.testo)).toEqual(['AS06']);
    const uno = applicaRegole(regole, fattiDaScheda(scheda(['AS06'])));
    expect(Object.keys(uno.celle).sort()).toEqual(['Minigonne', 'Paraurti']);
    expect(uno.celle['Paraurti']!.map(v => v.testo)).toEqual(['AS06', 'EXAT']);             // + «senza EXAB»
  });

  it('intestazioni con altri nomi, righe vuote, «=» per il valore, modello «tutti», e il csv', () => {
    const r = leggiRegoleExcel(xlsx([['regole dei componenti'], ['Sigle', 'Senza', 'Componente', 'Valori', 'Modello', 'Stop'],
      ['mrkt=cina', '', 'Mercato', 'Cina', 'tutti', 'x'], [], ['as06', 'exab, extc', 'Paraurti', 'AS06, EXAT', 'f171vs', 'no']]));
    expect(r.errori).toEqual([]);
    expect(r.regole[0]!.condizioni).toEqual([{ tipo: 'valore', sigla: 'MRKT', testo: 'CINA' }]);
    expect(r.regole[0]!.modello).toBe('*');
    expect(r.regole[0]!.ferma).toBe(true);
    expect(r.regole[1]!.condizioni.map(c => c.tipo)).toEqual(['presente', 'assente', 'assente']);
    expect(r.regole[1]!.modello).toBe('F171VS');
    expect(r.regole[1]!.azioni.map(a => a.valore.tipo)).toEqual(['sigla', 'fisso']);       // AS06 e' in «Se ha», EXAT no
    const csv = leggiRegoleExcel(Buffer.from('Se ha,Aggiungi a\nAS06,Paraurti\n', 'utf8'));
    expect(csv.regole).toHaveLength(1);
  });

  it('gli errori dicono la riga di Excel e il motivo; le righe buone si leggono lo stesso', () => {
    const r = leggiRegoleExcel(xlsx([INT,
      ['AS06', '', 'Paraurti', '', '', ''],                      // ok
      ['', '', 'Paraurti', 'X', '', ''],                         // manca la condizione
      ['AS06', '', '', '', '', ''],                              // manca il componente
      ['AS06 + AS07', '', 'Paraurti', '', '', ''],               // due sigle e nessun valore
      ['questa non e una sigla!', '', 'Paraurti', 'X', '', '']]));
    expect(r.regole).toHaveLength(1);
    expect(r.errori.map(e => e.riga)).toEqual([3, 4, 5, 6]);
    expect(r.errori[0]!.motivo).toContain('condizione');
    expect(r.errori[1]!.motivo).toContain('componente');
    expect(r.errori[2]!.motivo).toContain('valore');
    expect(r.errori[3]!.motivo).toContain('sigla');
  });

  it('file sbagliati: errore chiaro', () => {
    expect(() => leggiRegoleExcel(xlsx([['A', 'B'], ['1', '2']]))).toThrow(ImportRegoleError);              // manca «Aggiungi a»
    expect(() => leggiRegoleExcel(xlsx([['Aggiungi a', 'Valore'], ['P', 'x']]))).toThrow(/Se ha/);            // manca la condizione
    expect(() => leggiRegoleExcel(xlsx([INT]))).toThrow(/nessuna regola/);
    expect(() => leggiRegoleExcel(Buffer.from([0, 1, 2, 3]))).toThrow(ImportRegoleError);
  });
});
