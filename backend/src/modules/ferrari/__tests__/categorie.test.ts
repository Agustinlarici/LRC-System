// Raggruppamento delle colonne per categoria: funzione pura, senza database.
import { describe, expect, it } from 'vitest';
import { raggruppa, type Categoria } from '../categorie-base.js';
import { normTerminiCategoria } from '../categorie.js';

const cat = (id: number, nome: string, termini: string[]): Categoria => ({ id, nome, ordine: id, termini });
const descr = (o: Record<string, string> = {}) => new Map(Object.entries(o));

describe('raggruppa', () => {
  it('senza categorie ritorna [] (la tabella resta com\'e\')', () => {
    expect(raggruppa(['A', 'B'], descr(), [])).toEqual([]);
  });

  it('un codice esatto entra nella sua categoria; il resto va nell\'ultimo gruppo senza nome', () => {
    const g = raggruppa(['PN5X', 'HBSA', 'ZZZ1', 'CASP'], descr(), [cat(1, 'LIVREA', ['PN5X']), cat(2, 'CAVAL.', ['HBSA', 'HBMB']), cat(3, 'CARB.', ['CASP'])]);
    expect(g).toEqual([
      { categoria: 'LIVREA', termini: ['PN5X'] }, { categoria: 'CAVAL.', termini: ['HBSA'] }, { categoria: 'CARB.', termini: ['CASP'] },
      { categoria: null, termini: ['ZZZ1'] },
    ]);
  });

  it('l\'ordine delle categorie e\' quello dell\'elenco e dentro un gruppo si conserva l\'ordine delle colonne', () => {
    const g = raggruppa(['B2', 'A1', 'C3'], descr(), [cat(1, 'SECONDA', ['A1', 'B2']), cat(2, 'PRIMA', ['C3'])]);
    expect(g.map(x => x.categoria)).toEqual(['SECONDA', 'PRIMA']);
    expect(g[0]!.termini).toEqual(['B2', 'A1']);
  });

  it('maiuscole e accenti non contano', () => {
    expect(raggruppa(['PN5X'], descr(), [cat(1, 'LIVREA', ['pn5x'])])).toEqual([{ categoria: 'LIVREA', termini: ['PN5X'] }]);
  });

  it('un termine di 3+ caratteri e\' anche l\'inizio del codice (TLM per TLM13)', () => {
    expect(raggruppa(['TLM13', 'TL'], descr(), [cat(1, 'DREAMLINE', ['TLM'])])).toEqual([
      { categoria: 'DREAMLINE', termini: ['TLM13'] }, { categoria: null, termini: ['TL'] }]);
  });

  it('una parola e\' l\'inizio di una parola della descrizione (CAVALL per CAVALLINO), non un pezzo in mezzo', () => {
    const d = descr({ XXXX: 'Cavallino rampante laterale', YYYY: 'Scudetti con cavallino', ZZZZ: 'ESCAVALLO' });
    const g = raggruppa(['XXXX', 'YYYY', 'ZZZZ'], d, [cat(1, 'CAVAL.', ['CAVALL'])]);
    expect(g).toEqual([{ categoria: 'CAVAL.', termini: ['XXXX', 'YYYY'] }, { categoria: null, termini: ['ZZZZ'] }]);
  });

  it('un termine corto (1-2 caratteri) non cerca nelle descrizioni ne\' come inizio del codice', () => {
    expect(raggruppa(['AB12'], descr({ AB12: 'AB qualcosa' }), [cat(1, 'X', ['AB'])])).toEqual([{ categoria: null, termini: ['AB12'] }]);
  });

  it('il codice esatto vince sempre sulle corrispondenze parziali delle categorie precedenti', () => {
    const g = raggruppa(['TLM5'], descr(), [cat(1, 'PARZIALE', ['TLM']), cat(2, 'ESATTA', ['TLM5'])]);
    expect(g).toEqual([{ categoria: 'ESATTA', termini: ['TLM5'] }]);
  });

  it('a parita\' vince la prima categoria', () => {
    expect(raggruppa(['TLM13'], descr(), [cat(1, 'A', ['TLM']), cat(2, 'B', ['TLM1'])])[0]!.categoria).toBe('A');
  });

  it('i caratteri speciali nei termini non rompono la ricerca', () => {
    expect(raggruppa(['ABCD'], descr({ ABCD: 'x' }), [cat(1, 'S', ['(A.*', '[B'])])).toEqual([{ categoria: null, termini: ['ABCD'] }]);
  });
});

describe('normTerminiCategoria', () => {
  it('maiuscolo, senza spazi in piu\', senza doppioni e senza voci vuote', () => {
    expect(normTerminiCategoria([' pn5x ', 'PN5X', '', 'Tmsp', '  '])).toEqual(['PN5X', 'TMSP']);
  });
  it('rifiuta troppe voci', () => {
    expect(() => normTerminiCategoria(Array.from({ length: 151 }, (_, i) => `T${i}`))).toThrow(/Massimo/);
  });
});
