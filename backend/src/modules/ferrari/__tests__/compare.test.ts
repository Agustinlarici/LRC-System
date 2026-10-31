import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import { analizzaVm, TIPO_NEUTRO } from '../analyzer.js';
import { confronta } from '../compare.js';
import type { AnalisiIa, AnalisiVm, Conoscenza, OpzioneIa } from '../types.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';
import { iaPerfetta as iaBase } from './testutil.js';

// Scheda senza la riga BOLN (che porta sempre un "ATTENZIONE" e quindi la revisione)
const righeComplete = () => schedaSemplice().filter(r => !String(r[0]).startsWith('BOLN'));

const K_COMPLETA: Conoscenza = {
  versione: 5,
  codici: ['EXTC', 'PNCC', 'CEL2', 'TYBR', 'RSFD', 'INTC'].map(codice =>
    ({ codice, modello: null, significato: codice, categoria: null })),
  componenti: [
    { pattern: 'rosso test', tipo: 'COLORE', valore: 'ROSSO TEST', modello: null },
    { pattern: 'cliente', tipo: TIPO_NEUTRO, valore: '-', modello: null },
    { pattern: 'alcantara nera', tipo: 'MATERIALE', valore: 'ALCANTARA NERA', modello: null },
    { pattern: '9440', tipo: 'COLORE', valore: '9440', modello: null },
  ],
};

const iaPerfetta = (vm: AnalisiVm, knowledge = vm.versione_conoscenza): AnalisiIa => iaBase(vm, { knowledge });

const vmDi = (rows: ReturnType<typeof schedaSemplice>, k: Conoscenza) =>
  analizzaVm(parseScheda(toXlsBuffer(rows), 'a.xls'), k);

const tipi = (r: ReturnType<typeof confronta>) => r.items.map(i => i.tipo);

describe('confronta — percorso verde', () => {
  it('VM e IA concordano, tutto noto → VERDE senza item', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const r = confronta(vm, iaPerfetta(vm));
    expect(r.items).toEqual([]);
    expect(r.esito).toBe('VERDE');
    expect(r.righe.every(x => x.esito === 'VERDE')).toBe(true);
    expect(r.header.find(h => h.campo === 'modello')?.stato).toBe('uguale');
  });
});

describe('confronta — IA assente', () => {
  it('senza IA non è mai VERDE', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const r = confronta(vm, null);
    expect(r.ia_assente).toBe(true);
    expect(r.esito).toBe('ROSSO');
    expect(tipi(r)).toContain('ia_assente');
  });
});

describe('confronta — conoscenza mancante', () => {
  it('codici ignoti → AMBRA', () => {
    const vm = vmDi(righeComplete(), { ...K_COMPLETA, codici: [] });
    const r = confronta(vm, iaPerfetta(vm));
    expect(r.esito).toBe('AMBRA');
    expect(tipi(r).filter(t => t === 'codice_ignoto')).toHaveLength(6);
  });

  it('parole non riconosciute dalla VM → AMBRA (sconosciuto_vm)', () => {
    const vm = vmDi(righeComplete(), { ...K_COMPLETA, componenti: [] });
    const r = confronta(vm, iaPerfetta(vm));
    expect(tipi(r)).toContain('sconosciuto_vm');
    expect(r.esito).toBe('AMBRA');
  });

  it('versioni di conoscenza diverse: solo informazione, non blocca se il contenuto coincide', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const r = confronta(vm, iaPerfetta(vm, 4));
    expect(r.items).toEqual([]);
    expect(r.esito).toBe('VERDE');
    expect(r.versioni).toEqual({ vm: 5, ia: 4 });
    expect(r.header.find(h => h.campo === 'conoscenza')?.stato).toBe('versione_diversa');
  });
});

describe('confronta — scheda', () => {
  it('modello diverso → ROSSO', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const ia = iaPerfetta(vm);
    ia.modello = { valore: 'F888YY' };
    const r = confronta(vm, ia);
    expect(r.esito).toBe('ROSSO');
    expect(tipi(r)).toContain('evidenza_non_valida');   // F888YY non compare nella scheda
  });

  it('modello della IA non indicato → ROSSO', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const ia = iaPerfetta(vm);
    ia.modello = null;
    expect(confronta(vm, ia).esito).toBe('ROSSO');
  });

  it('mercato incoerente nella VM → ROSSO anche con IA perfetta', () => {
    const rows = [...righeComplete(), ['MRKT', 'MARKET FEATURE', 'GIAPPONE']];
    const vm = vmDi(rows, { ...K_COMPLETA, codici: [...K_COMPLETA.codici, { codice: 'MRKT', modello: null, significato: 'm', categoria: null }] });
    const r = confronta(vm, iaPerfetta(vm));
    expect(r.esito).toBe('ROSSO');
    expect(tipi(r)).toContain('mercato_incoerente');
  });

  it('mercato diverso tra IA e VM → AMBRA', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const ia = iaPerfetta(vm);
    ia.mercato = { valore: '90' };
    expect(tipi(confronta(vm, ia))).toContain('mercato_diverso');
  });

  it('anomalie del parser non informative → AMBRA', () => {
    const vm = vmDi([...righeComplete(), [null, 'XX', 'YY']], K_COMPLETA);
    expect(tipi(confronta(vm, iaPerfetta(vm)))).toContain('anomalia_parser');
  });
});

describe('confronta — righe', () => {
  it('riga mancante nella IA → ROSSO', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const ia = iaPerfetta(vm);
    ia.opzioni = ia.opzioni.slice(1);
    const r = confronta(vm, ia);
    expect(r.esito).toBe('ROSSO');
    expect(tipi(r)).toContain('riga_mancante_ia');
  });

  it('codice letto diversamente dalla IA → ROSSO', () => {
    const vm = vmDi(righeComplete(), K_COMPLETA);
    const ia = iaPerfetta(vm);
    ia.opzioni[0]!.codice = 'ZZZZ';
    expect(tipi(confronta(vm, ia))).toContain('codice_diverso');
  });

  it('l\'esito di riga è il peggiore tra i suoi item', () => {
    const vm = vmDi(righeComplete(), { ...K_COMPLETA, codici: K_COMPLETA.codici.filter(c => c.codice !== 'CEL2') });
    const r = confronta(vm, iaPerfetta(vm));
    expect(r.righe.find(x => x.codice === 'CEL2')?.esito).toBe('AMBRA');
    expect(r.righe.find(x => x.codice === 'RSFD')?.esito).toBe('VERDE');
  });
});

describe('confronta — testo libero', () => {
  const kTesto: Conoscenza = { versione: 1, codici: [], componenti: [
    { pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null },
  ] };
  const vm = analizzaVm(parseScheda(toXlsBuffer(schedaPersonalizzata()), 'b.xls'), kTesto);
  const pnt1 = (ia: AnalisiIa): OpzioneIa => ia.opzioni.find(o => o.codice === 'PNT1')!;

  it('ogni riferimento alle immagini richiede revisione anche con IA perfetta', () => {
    const r = confronta(vm, iaPerfetta(vm));
    expect(r.items.filter(i => i.tipo === 'immagini').length).toBeGreaterThanOrEqual(4);
    expect(r.esito).not.toBe('VERDE');
  });

  it('il segnaposto ZZZZ viene segnalato', () => {
    expect(tipi(confronta(vm, iaPerfetta(vm)))).toContain('placeholder');
  });

  it('componente trovato solo dalla IA → componente_solo_ia', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).componenti.push({ tipo: 'ALTRO', valore: 'LUCIDO', frammento: 'LUCIDO' });
    const it = confronta(vm, ia).items.find(i => i.tipo === 'componente_solo_ia')!;
    expect(it.codice).toBe('PNT1');
    expect(it.frammento).toBe('LUCIDO');
  });

  it('componente trovato solo dalla VM → componente_solo_vm', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).componenti = pnt1(ia).componenti.filter(c => c.tipo !== 'COLORE');
    const it = confronta(vm, ia).items.find(i => i.tipo === 'componente_solo_vm')!;
    expect(it.vm).toMatchObject({ tipo: 'COLORE', valore: 'BLU PROVA' });
  });

  it('stesso frammento con valore diverso → valore_diverso', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).componenti.find(c => c.tipo === 'COLORE')!.valore = 'BLU ALTRO';
    const it = confronta(vm, ia).items.find(i => i.tipo === 'valore_diverso')!;
    expect(it.vm).toMatchObject({ valore: 'BLU PROVA' });
    expect(it.ia).toMatchObject({ valore: 'BLU ALTRO' });
  });

  it('frammento che non esiste nella scheda → evidenza_non_valida, valore scartato', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).componenti.push({ tipo: 'COLORE', valore: 'VERDE INVENTATO', frammento: 'VERDE INVENTATO' });
    const r = confronta(vm, ia);
    expect(tipi(r)).toContain('evidenza_non_valida');
    expect(tipi(r)).not.toContain('componente_solo_ia');
  });

  it('la IA non può far "sparire" un problema: i flag della VM restano', () => {
    const ia = iaPerfetta(vm);
    for (const o of ia.opzioni) o.componenti = o.componenti.filter(c => c.tipo !== 'RIFERIMENTO_IMMAGINI' && c.tipo !== 'PLACEHOLDER');
    const r = confronta(vm, ia);
    expect(tipi(r)).toContain('immagini');
    expect(tipi(r)).toContain('placeholder');
  });

  it('sconosciuti, ambigui e incoerenze dichiarati dalla IA diventano item', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).sconosciuti.push({ testo: 'VERNICIARE VETTURA', motivo: 'verbo mai visto' });
    pnt1(ia).ambigui.push({ testo: 'LUCIDO', motivo: 'finitura?' });
    pnt1(ia).incoerenze.push({ descrizione: 'colore e codice vernice non coincidono' });
    const t = tipi(confronta(vm, ia));
    expect(t).toContain('sconosciuto_ia');
    expect(t).toContain('ambiguo_ia');
    expect(t).toContain('incoerenza_ia');
  });

  it('uno "sconosciuto" della IA che non è nel testo è un\'evidenza non valida', () => {
    const ia = iaPerfetta(vm);
    pnt1(ia).sconosciuti.push({ testo: 'PAROLA CHE NON ESISTE' });
    expect(tipi(confronta(vm, ia))).toContain('evidenza_non_valida');
  });

  it('due frammenti uguali nel testo non si abbinano allo stesso punto', () => {
    const ia = iaPerfetta(vm);
    const emph = ia.opzioni.find(o => o.codice === 'EMPH')!;
    const filo = emph.componenti.filter(c => c.tipo === 'FILO');
    expect(filo.length).toBe(2);
    const r = confronta(vm, ia);
    expect(r.items.filter(i => i.codice === 'EMPH' && (i.tipo === 'componente_solo_ia' || i.tipo === 'valore_diverso'))).toEqual([]);
  });
});

describe('confronta — chiavi degli item', () => {
  it('sono uniche e stabili tra due esecuzioni', () => {
    const vm = analizzaVm(parseScheda(toXlsBuffer(schedaPersonalizzata()), 'b.xls'), { versione: 0, codici: [], componenti: [] });
    const a = confronta(vm, iaPerfetta(vm)).items.map(i => i.key);
    const b = confronta(vm, iaPerfetta(vm)).items.map(i => i.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
