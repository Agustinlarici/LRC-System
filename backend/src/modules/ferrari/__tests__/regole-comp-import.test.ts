import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applicaRegole, fattiDaScheda, type RegolaComp } from '../regole-comp-base.js';
import { esportaRegoleExcel, ImportRegoleError, leggiRegoleExcel } from '../regole-comp-import.js';
import type { RegolaCompInput } from '../regole-comp-base.js';
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

  describe('esportazione', () => {
    const base: Pick<RegolaCompInput, 'attiva' | 'modello' | 'logica' | 'eccezioni' | 'ferma'> = { attiva: true, modello: '*', logica: 'tutte', eccezioni: [], ferma: false };
    const sig = (componente: string, sigla: string) => ({ componente, valore: { tipo: 'sigla' as const, sigla } });
    const fisso = (componente: string, testo: string) => ({ componente, valore: { tipo: 'fisso' as const, testo } });
    const semplici: RegolaCompInput[] = [
      { ...base, nome: 'a', condizioni: [{ tipo: 'presente', sigla: 'AS06' }, { tipo: 'presente', sigla: 'AS07' }], azioni: [sig('Paraurti', 'AS06')], ferma: true },
      { ...base, nome: 'b', condizioni: [{ tipo: 'presente', sigla: 'AS06' }], azioni: [sig('Paraurti', 'AS06'), sig('Minigonne', 'AS06')] },
      { ...base, nome: 'c', modello: 'F171VS', condizioni: [{ tipo: 'assente', sigla: 'EXAB' }], azioni: [fisso('Paraurti', 'EXAT')] },
      { ...base, nome: 'd', attiva: false, condizioni: [{ tipo: 'valore', sigla: 'MRKT', testo: 'CINA' }, { tipo: 'assente', sigla: 'CEMP' }], azioni: [fisso('Mercato', 'Cina'), fisso('Altro', 'Cina')] },
      { ...base, nome: 'e', condizioni: [{ tipo: 'presente', sigla: 'CEXD' }], azioni: [sig('Estrattore', 'CEXD'), fisso('Estrattore', 'carbonio')] },
    ];
    const leggi = (b: Buffer) => { const wb = XLSX.read(b, { type: 'buffer' }); return wb.SheetNames; };

    it('esportando e reimportando si ottengono le stesse regole (nome a parte)', () => {
      const out = esportaRegoleExcel(semplici);
      expect([out.esportate, out.nonEsportate]).toEqual([5, 0]);
      expect(leggi(out.buffer)).toEqual(['Regole']);
      const r = leggiRegoleExcel(out.buffer);
      expect(r.errori).toEqual([]);
      const senzaNome = (x: RegolaCompInput) => { const { nome: _n, ...resto } = x; return resto; };
      expect(r.regole.map(senzaNome)).toEqual(semplici.map(senzaNome));
    });

    it('la regola con una sola sigla lascia il valore vuoto (come nel modello)', () => {
      const wb = XLSX.read(esportaRegoleExcel([semplici[1]!]).buffer, { type: 'buffer' });
      const righe = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Regole']!, { header: 1, defval: '' });
      expect(righe[1]).toEqual(['AS06', '', 'Paraurti, Minigonne', '', '', '', '']);
    });

    it('quello che non sta nel formato va in un secondo foglio con il motivo, e non si perde', () => {
      const difficili: RegolaCompInput[] = [
        { ...base, nome: 'con eccezione', condizioni: [{ tipo: 'presente', sigla: 'A1' }], eccezioni: [{ tipo: 'presente', sigla: 'B1' }], azioni: [fisso('P', 'x')] },
        { ...base, nome: 'oppure', logica: 'qualsiasi', condizioni: [{ tipo: 'presente', sigla: 'A1' }, { tipo: 'presente', sigla: 'B1' }], azioni: [fisso('P', 'x')] },
        { ...base, nome: 'testo', condizioni: [{ tipo: 'testo', sigla: 'LIVR', testo: 'giallo' }], azioni: [fisso('P', 'x')] },
        { ...base, nome: 'testo della sigla', condizioni: [{ tipo: 'presente', sigla: 'LIVR' }], azioni: [{ componente: 'C', valore: { tipo: 'testo', sigla: 'LIVR' } }] },
        { ...base, nome: 'valori diversi', condizioni: [{ tipo: 'presente', sigla: 'A1' }], azioni: [fisso('P', 'x'), fisso('Q', 'y')] },
        { ...base, nome: 'sigla non in se ha', condizioni: [{ tipo: 'presente', sigla: 'A1' }], azioni: [sig('P', 'ZZ9')] },
      ];
      const out = esportaRegoleExcel([...semplici.slice(0, 1), ...difficili]);
      expect([out.esportate, out.nonEsportate]).toEqual([1, 6]);
      expect(leggi(out.buffer)).toEqual(['Regole', 'Non esportate']);
      const f2 = XLSX.utils.sheet_to_json<string[]>(XLSX.read(out.buffer, { type: 'buffer' }).Sheets['Non esportate']!, { header: 1, defval: '' });
      expect(f2.slice(3).map(x => x[1])).toEqual(difficili.map(d => d.nome));
      expect(f2[3]![2]).toContain('eccezioni');
      expect(f2[3]![0]).toBe('2');                                                         // il numero della regola nella lista
    });
  });
});
