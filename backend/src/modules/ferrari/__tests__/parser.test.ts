import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseScheda, SchedaError } from '../parser.js';
import { schedaSemplice, schedaPersonalizzata, testata, toXlsBuffer } from './fixtures.js';

describe('parseScheda — testata', () => {
  const c = parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls');

  it('legge formato e foglio', () => {
    expect(c.source.format).toBe('xls-biff8');
    expect(c.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separa modello da versione (modello = prima di " - ")', () => {
    expect(c.header.tipo_matricola.modello).toBe('F999XX');
    expect(c.header.tipo_matricola.versione).toBe('F999XXAB850/27 CHI MY27');
    expect(c.header.tipo_matricola.mercato_codice).toBe('27');
    expect(c.header.tipo_matricola.mercato_sigla).toBe('CHI');
  });

  it('legge matricola, progressivo, destinazione e codice mercato', () => {
    expect(c.header.tipo_matricola.matricola).toBe('999000027');
    expect(c.header.tipo_matricola.progressivo).toBe('100001');
    expect(c.header.destinazione.paese).toBe('CINA');
    expect(c.header.destinazione.codice_mercato).toBe('27');
  });

  it('riporta i numeri come testo senza ".0" e segnala il telaio come numero', () => {
    expect(c.header.commessa).toBe('100001');
    expect(c.header.telaio).toBe('110');
    expect(c.anomalie.find(a => a.tipo === 'numero_come_testo')?.livello).toBe('info');
  });

  it('legge revisione e data della variante', () => {
    expect(c.header.variante).toEqual({ codice: '123456789', revisione: '0', data: '2026-10-26T12:58' });
  });
});

describe('parseScheda — opzioni e sezioni', () => {
  const c = parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls');

  it('riconosce le opzioni e toglie gli spazi di riempimento', () => {
    expect(c.opzioni.map(o => o.codice)).toEqual(['EXTC', 'PNCC', 'CEL2', 'TYBR', 'BOLN', 'RSFD', 'INTC']);
    const tybr = c.opzioni.find(o => o.codice === 'TYBR')!;
    expect(tybr).toMatchObject({ descrizione: 'PNEUMATICI MARCA X', valore: 'SI', nota: 'CLIENTE', sezione: 'ESTERNI' });
  });

  it('assegna la sezione corrente a ogni opzione', () => {
    expect(c.opzioni.find(o => o.codice === 'RSFD')?.sezione).toBe('CERCHI');
    expect(c.opzioni.find(o => o.codice === 'INTC')?.sezione).toBe('INTERNI');
  });

  it('un valore numerico resta come testo', () => {
    expect(c.opzioni.find(o => o.codice === 'BOLN')?.valore).toBe('50');
  });

  it('non genera anomalie di riga su una scheda pulita', () => {
    expect(c.anomalie.filter(a => a.livello !== 'info')).toEqual([]);
  });
});

describe('parseScheda — testo libero', () => {
  const c = parseScheda(toXlsBuffer(schedaPersonalizzata()), 'b.xls');
  const opt = (cod: string) => c.opzioni.find(o => o.codice === cod)!;

  it('unisce le righe consecutive in un solo blocco con le righe di origine', () => {
    const b = opt('PNT1').blocchi_testo;
    expect(b).toHaveLength(1);
    expect(b[0]!.testo).toBe('VERNICIARE VETTURA IN COLORE BLU PROVA LUCIDO COD.VERN XYZ.*0229. VEDERE IMMAGINI.');
    expect(b[0]!.righe).toHaveLength(2);
  });

  it('apre un blocco nuovo a ogni "LATO GUIDATORE/PASSEGGERO"', () => {
    const b = opt('EMPH').blocchi_testo;
    expect(b).toHaveLength(2);
    expect(b[0]!.testo.startsWith('LATO GUIDATORE')).toBe(true);
    expect(b[1]!.testo.startsWith('LATO PASSEGGERO')).toBe(true);
  });

  it('il testo appartiene sempre all\'opzione di sopra, anche con valore SI', () => {
    expect(opt('LLOG').blocchi_testo[0]!.testo).toBe('SCUDETTO LASERIZZATO COME DA IMMAGINE.');
    expect(opt('NDSP').blocchi_testo[0]!.testo).toBe('VETTURA TAILOR MADE');
  });

  it('una sezione ripetuta interrompe l\'opzione e non finisce nel testo', () => {
    expect(opt('STC1').sezione).toBe('INTERNI');
    expect(opt('EMPH').blocchi_testo.map(b => b.testo).join(' ')).not.toContain('INTERNI');
  });

  it('nessun testo orfano né riga ignota', () => {
    expect(c.anomalie.filter(a => a.livello !== 'info')).toEqual([]);
  });
});

describe('parseScheda — ordine delle righe', () => {
  it('l\'ordine di testata e opzioni non cambia il risultato', () => {
    const rows = schedaPersonalizzata();
    const head = rows.slice(0, 5);
    const rest = rows.slice(5);
    const shuffledHead = [head[3]!, head[0]!, head[4]!, head[2]!, head[1]!];
    const a = parseScheda(toXlsBuffer(rows), 'x.xls');
    const b = parseScheda(toXlsBuffer([...shuffledHead, ...rest]), 'x.xls');
    expect(b.header).toEqual(a.header);
    expect(b.opzioni.map(o => [o.codice, o.blocchi_testo.map(x => x.testo)]))
      .toEqual(a.opzioni.map(o => [o.codice, o.blocchi_testo.map(x => x.testo)]));
  });

  it('scambiare di posto due gruppi di opzioni porta con sé il loro testo', () => {
    const base = schedaPersonalizzata();
    const iPnt1 = base.findIndex(r => String(r[0]).startsWith('PNT1'));
    const iCel2 = base.findIndex(r => String(r[0]).startsWith('CEL2'));
    const gruppo1 = base.slice(iPnt1, iCel2);               // PNT1 + il suo testo
    const swapped = [...base.slice(0, iPnt1), ...base.slice(iCel2, iCel2 + 1), ...gruppo1, ...base.slice(iCel2 + 1)];
    const c = parseScheda(toXlsBuffer(swapped), 'x.xls');
    expect(c.opzioni.find(o => o.codice === 'PNT1')!.blocchi_testo[0]!.testo).toContain('BLU PROVA');
    expect(c.opzioni.find(o => o.codice === 'CEL2')!.blocchi_testo).toHaveLength(0);
  });
});

describe('parseScheda — anomalie', () => {
  it('testo senza opzione precedente → testo_orfano', () => {
    const rows = [...testata(), ['ESTERNI'], ['TESTO SOLO SOLETTO'], ['EXTC', 'Esterni', 'SI']];
    const c = parseScheda(toXlsBuffer(rows), 'x.xls');
    expect(c.anomalie.map(a => a.tipo)).toContain('testo_orfano');
  });

  it('riga con testo solo nelle colonne di destra → riga_ignota (mai scartata)', () => {
    const rows = [...schedaSemplice(), [null, 'XX', 'YY']];
    const c = parseScheda(toXlsBuffer(rows), 'x.xls');
    expect(c.anomalie.filter(a => a.tipo === 'riga_ignota')).toHaveLength(1);
  });

  it('un secondo foglio con dati viene segnalato', () => {
    const wb = XLSX.read(toXlsBuffer(schedaSemplice()), { type: 'buffer' });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['altro']]), 'Extra');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    expect(parseScheda(buf, 'x.xls').anomalie.map(a => a.tipo)).toContain('foglio_extra');
  });
});

describe('parseScheda — quarantena', () => {
  it('file che non è un Excel', () => {
    expect(() => parseScheda(Buffer.from('questo non è un excel'), 'x.xls')).toThrow(SchedaError);
  });
  it('file vuoto', () => {
    expect(() => parseScheda(Buffer.alloc(0), 'x.xls')).toThrow(/non è un Excel|vuoto/);
  });
  it('testata mancante', () => {
    const rows = [['ESTERNI'], ['EXTC', 'Esterni', 'SI']];
    expect(() => parseScheda(toXlsBuffer(rows), 'x.xls')).toThrow(/Testata mancante/);
  });
  it('nessuna opzione', () => {
    expect(() => parseScheda(toXlsBuffer(testata()), 'x.xls')).toThrow(/Nessuna opzione/);
  });
  it('legge anche .xlsx', () => {
    const c = parseScheda(toXlsBuffer(schedaSemplice(), 'xlsx'), 'x.xlsx');
    expect(c.source.format).toBe('xlsx');
    expect(c.opzioni).toHaveLength(7);
  });
});
