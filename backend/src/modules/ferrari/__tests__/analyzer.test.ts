import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import { analizzaTesto, analizzaVm, classificaValore, TIPO_NEUTRO } from '../analyzer.js';
import type { Conoscenza } from '../types.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const VUOTA: Conoscenza = { versione: 0, codici: [], componenti: [] };

describe('classificaValore', () => {
  it.each([
    ['SI', 'SI'], ['  si ', 'SI'], ['', 'VUOTO'], ['50', 'NUMERO'], ['ROSSO IMOLA', 'TESTO'],
    ['EXTRACAMPIONARIO-NOT STANDARD', 'EXTRACAMPIONARIO'],
    ['EXTRACAMPIONARIO - NOT STANDAR', 'EXTRACAMPIONARIO'],   // troncato a 30 caratteri
  ])('%s → %s', (v, atteso) => expect(classificaValore(v)).toBe(atteso));
});

describe('analizzaTesto — regole fisse', () => {
  const a = analizzaTesto(
    'VERNICIARE VETTURA IN COLORE BLU PROVA LUCIDO COD.VERN XYZ.*0229. VEDERE IMMAGINI.', 'F999XX', VUOTA);

  it('trova codice vernice senza il punto finale', () => {
    const c = a.componenti.find(x => x.tipo === 'CODICE_VERNICE')!;
    expect(c.valore).toBe('XYZ.*0229');
    expect(c.frammento).toBe('COD.VERN XYZ.*0229');
  });

  it('trova il riferimento alle immagini e alza il flag', () => {
    expect(a.componenti.some(x => x.tipo === 'RIFERIMENTO_IMMAGINI')).toBe(true);
    expect(a.flags).toContain('immagini');
  });

  it('con dizionario vuoto le parole di contenuto restano come residuo (articoli/preposizioni no)', () => {
    const testi = a.residuo.map(r => r.testo);
    expect(testi).toContain('VERNICIARE VETTURA');
    expect(testi.join(' ')).not.toMatch(/\bIN\b/);
  });

  it('"COME DA IMMAGINE" conta come riferimento alle immagini', () => {
    expect(analizzaTesto('SCUDETTO COME DA IMMAGINE.', null, VUOTA).flags).toContain('immagini');
  });

  it('LATO e FILO (anche con parole in mezzo)', () => {
    const b = analizzaTesto('LATO GUIDATORE: CAVALLINO RICAMATO IN FILO MADEIRA POLYNEON 1810.', null, VUOTA);
    expect(b.componenti.find(x => x.tipo === 'LATO')?.valore).toBe('GUIDATORE');
    expect(b.componenti.find(x => x.tipo === 'FILO')?.valore).toBe('1810');
  });

  it('più fili nello stesso testo', () => {
    const b = analizzaTesto('CON FILO 816 SU X   FILO 4000 SU Y IN FILO 411.', null, VUOTA);
    expect(b.componenti.filter(x => x.tipo === 'FILO').map(x => x.valore)).toEqual(['816', '4000', '411']);
  });

  it('segnaposto ZZZZ', () => {
    const b = analizzaTesto('SCRITTA SOTTO IL RIGHINO ZZZZ IN ARGENTO', null, VUOTA);
    expect(b.flags).toContain('placeholder');
  });
});

describe('analizzaTesto — dizionario', () => {
  const k: Conoscenza = {
    versione: 3, codici: [],
    componenti: [
      { pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null },
      { pattern: 'vetture', tipo: TIPO_NEUTRO, valore: '-', modello: null },
      { pattern: 'ultrasuede', tipo: 'MATERIALE', valore: 'ULTRASUEDE', modello: null },
      { pattern: 'ultrasuede', tipo: 'MATERIALE', valore: 'ULTRASUEDE F999', modello: 'F999XX' },
    ],
  };

  it('riconosce il pattern senza distinguere maiuscole né accenti e riporta il frammento originale', () => {
    const a = analizzaTesto('Rivestito in Blu  Prova lucido', null, k);
    const c = a.componenti.find(x => x.tipo === 'COLORE')!;
    expect(c.frammento).toBe('Blu  Prova');
    expect(c.valore).toBe('BLU PROVA');
  });

  it('il dizionario del modello prevale su quello generale', () => {
    const per = analizzaTesto('ULTRASUEDE NERO', 'F999XX', k).componenti.find(x => x.tipo === 'MATERIALE')!;
    const altro = analizzaTesto('ULTRASUEDE NERO', 'F888YY', k).componenti.find(x => x.tipo === 'MATERIALE')!;
    expect(per.valore).toBe('ULTRASUEDE F999');
    expect(altro.valore).toBe('ULTRASUEDE');
  });

  it('i componenti NEUTRI coprono il testo ma non si riportano', () => {
    const a = analizzaTesto('VETTURE', null, k);
    expect(a.componenti).toEqual([]);
    expect(a.residuo).toEqual([]);
  });

  it('parola intera: "BLU PROVAX" non corrisponde a "BLU PROVA"', () => {
    expect(analizzaTesto('BLU PROVAX', null, k).componenti.filter(x => x.tipo === 'COLORE')).toEqual([]);
  });

  it('i riconoscimenti più lunghi vincono e non si sovrappongono', () => {
    const kk: Conoscenza = { versione: 1, codici: [], componenti: [
      { pattern: 'blu', tipo: 'COLORE', valore: 'BLU', modello: null },
      { pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null },
    ] };
    const a = analizzaTesto('BLU PROVA', null, kk);
    expect(a.componenti.map(c => c.valore)).toEqual(['BLU PROVA']);
  });
});

describe('analizzaVm', () => {
  const c = parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls');

  it('senza conoscenza nessun codice è noto', () => {
    expect(analizzaVm(c, VUOTA).opzioni.every(o => !o.codice_noto)).toBe(true);
  });

  it('un codice approvato per tutti i modelli è noto; uno di un altro modello no', () => {
    const k: Conoscenza = { versione: 2, componenti: [], codici: [
      { codice: 'CEL2', modello: null, significato: 'Vano motore carbonio', categoria: null },
      { codice: 'RSFD', modello: 'F888YY', significato: 'Cerchi', categoria: null },
      { codice: 'TYBR', modello: 'F999XX', significato: 'Pneumatici', categoria: null },
    ] };
    const a = analizzaVm(c, k);
    const noto = (cod: string) => a.opzioni.find(o => o.codice === cod)!.codice_noto;
    expect(noto('CEL2')).toBe(true);
    expect(noto('RSFD')).toBe(false);
    expect(noto('TYBR')).toBe(true);
    expect(a.versione_conoscenza).toBe(2);
  });

  it('analizza il valore solo quando è testo', () => {
    const a = analizzaVm(c, VUOTA);
    const pncc = a.opzioni.find(o => o.codice === 'PNCC')!;
    expect(pncc.unita.map(u => u.origine)).toEqual(['valore']);
    const cel2 = a.opzioni.find(o => o.codice === 'CEL2')!;
    expect(cel2.unita).toEqual([]);
    const boln = a.opzioni.find(o => o.codice === 'BOLN')!;
    expect(boln.unita.map(u => u.origine)).toEqual(['nota']);
    expect(boln.unita[0]!.flags).toContain('attenzione');
  });

  it('è deterministica', () => {
    expect(analizzaVm(c, VUOTA)).toEqual(analizzaVm(c, VUOTA));
  });

  it('i blocchi di testo libero diventano unità con i loro flag', () => {
    const p = analizzaVm(parseScheda(toXlsBuffer(schedaPersonalizzata()), 'b.xls'), VUOTA);
    const emph = p.opzioni.find(o => o.codice === 'EMPH')!;
    expect(emph.unita.filter(u => u.origine === 'blocco')).toHaveLength(2);
    expect(emph.unita.every(u => u.flags.includes('immagini'))).toBe(true);
    const dedi = p.opzioni.find(o => o.codice === 'DEDI')!;
    expect(dedi.unita[0]!.flags).toContain('placeholder');
  });
});

describe('controllo mercato', () => {
  it('coerente quando codice versione, destinazione, matricola e MRKT coincidono', () => {
    const rows = [...schedaSemplice(), ['MRKT', 'MARKET FEATURE', 'CINA']];
    const a = analizzaVm(parseScheda(toXlsBuffer(rows), 'a.xls'), VUOTA);
    expect(a.mercato.coerente).toBe(true);
  });

  it('incoerente se l\'opzione MRKT indica un altro paese', () => {
    const rows = [...schedaSemplice(), ['MRKT', 'MARKET FEATURE', 'GIAPPONE']];
    const a = analizzaVm(parseScheda(toXlsBuffer(rows), 'a.xls'), VUOTA);
    expect(a.mercato.coerente).toBe(false);
    expect(a.mercato.dettaglio).toContain('MRKT');
  });

  it('incoerente se la matricola non termina con il codice mercato', () => {
    const rows = schedaSemplice();
    rows[2] = [rows[2]![0]!, rows[2]![1]!, '         999000099                               100001'];
    const a = analizzaVm(parseScheda(toXlsBuffer(rows), 'a.xls'), VUOTA);
    expect(a.mercato.coerente).toBe(false);
  });
});
