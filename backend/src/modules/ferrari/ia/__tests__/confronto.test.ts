import { describe, expect, it } from 'vitest';
import { confrontaPerCodice, normalizzaValore, tokenTesto } from '../confronto.js';
import type { LetturaOpzione } from '../contratto.js';
import type { Opzione } from '../../types.js';

const vm = (codice: string, valore: string, testo = '', extra: Partial<Opzione> = {}): Opzione => ({
  riga: 1, sezione: null, codice, descrizione: 'QUALSIASI', valore, nota: '', blocchi_testo: testo ? [{ n: 1, righe: [2], testo }] : [], ...extra,
});
const ia = (codice: string, valore: string, testo = ''): LetturaOpzione => ({ riga: 1, codice, descrizione: 'DESCRIZIONE RISCRITTA DALLA IA', valore, nota: '', testi: testo ? [testo] : [] });
const interesse = new Set(['LIVR', 'BIC2']);

describe('normalizzazione', () => {
  it('SI e Sì sono uguali; numeri con virgola; testo senza maiuscole/spazi', () => {
    expect(normalizzaValore('Sì')).toBe(normalizzaValore(' si '));
    expect(normalizzaValore('1,50')).toBe(normalizzaValore('1.5'));
    expect(normalizzaValore('Nero  DS 1250')).toBe(normalizzaValore('NERO DS 1250'));
    expect(normalizzaValore('')).toBe('');
    expect(normalizzaValore('EXTRACAMPIONARIO-NOT STANDARD')).toBe('EXTRA');
  });
  it('le parole-codice sono quelle con una cifra', () => {
    expect([...tokenTesto('Livrea TLM13 sugli specchi, cod. FYM.*0357 e 1810')].sort()).toEqual(['1810', 'FYM.*0357', 'TLM13']);
    expect(tokenTesto('solo parole').size).toBe(0);
  });
});

describe('confronto per codice', () => {
  it('uguale: stesso codice e valore, le descrizioni diverse non contano', () => {
    const r = confrontaPerCodice([vm('LIVR', 'SI'), vm('BIC2', 'NERO DS 1250')], [ia('LIVR', 'Sì'), ia('BIC2', 'nero ds 1250')], interesse);
    expect(r).toMatchObject({ esito: 'uguale', discrepanze: [], confrontati: 2 });
  });
  it('codice solo nella VM o solo nella IA', () => {
    const r = confrontaPerCodice([vm('LIVR', 'SI'), vm('CEXS', 'SI')], [ia('LIVR', 'SI'), ia('BIC2', 'NERO')], interesse);
    expect(r.discrepanze.map(d => [d.codice, d.tipo, d.peso])).toEqual([['BIC2', 'solo_ia', 'sigla'], ['CEXS', 'solo_vm', 'info']]);
    expect(r.esito).toBe('discrepanze');
  });
  it('valore diverso', () => {
    const r = confrontaPerCodice([vm('BIC2', 'NERO DS 1250')], [ia('BIC2', 'NERO DS 1260')], interesse);
    expect(r.discrepanze).toEqual([expect.objectContaining({ tipo: 'valore_diverso', vm: 'NERO DS 1250', ia: 'NERO DS 1260', peso: 'sigla' })]);
  });
  it('testo: codici o numeri persi o aggiunti, o testo solo da una parte', () => {
    const uguale = confrontaPerCodice([vm('LIVR', 'SI', 'LIVREA TLM13 SPECCHI')], [ia('LIVR', 'SI', 'Livrea sugli specchi TLM13')], interesse);
    expect(uguale.esito).toBe('uguale');                                // parole diverse, stessi codici: va bene
    const perso = confrontaPerCodice([vm('LIVR', 'SI', 'LIVREA TLM13 E TLM5')], [ia('LIVR', 'SI', 'LIVREA TLM13')], interesse);
    expect(perso.discrepanze[0]).toMatchObject({ tipo: 'testo_diverso' });
    expect(perso.discrepanze[0]!.dettaglio).toContain('solo VM: TLM5');
    const mancante = confrontaPerCodice([vm('LIVR', 'SI', 'TESTO LIBERO')], [ia('LIVR', 'SI', '')], interesse);
    expect(mancante.discrepanze[0]!.dettaglio).toContain('solo da una parte');
  });
  it('codice ripetuto un numero diverso di volte', () => {
    const r = confrontaPerCodice([vm('LIVR', 'SI'), vm('LIVR', 'SI')], [ia('LIVR', 'SI')], interesse);
    expect(r.discrepanze.map(d => d.tipo)).toEqual(['conteggio_diverso']);
    expect(r.confrontati).toBe(1);
  });
  it('le sigle che non sono colonne sono solo informative e non cambiano l\'esito', () => {
    const r = confrontaPerCodice([vm('CEXS', 'SI')], [ia('CEXS', 'NO')], interesse);
    expect(r.discrepanze).toEqual([expect.objectContaining({ tipo: 'valore_diverso', peso: 'info' })]);
    expect(r.esito).toBe('uguale');
  });
  it('senza nessuna sigla scelta contano tutte', () => {
    expect(confrontaPerCodice([vm('CEXS', 'SI')], [ia('CEXS', 'NO')], new Set()).esito).toBe('discrepanze');
  });
  it('una riga che la VM stessa sospetta (codice scritto male) e\' sempre informativa', () => {
    const r = confrontaPerCodice([vm('LIVR', 'SI', '', { suggerito: 'LIV2' })], [], interesse);
    expect(r.discrepanze[0]).toMatchObject({ tipo: 'solo_vm', peso: 'info' });
    expect(r.esito).toBe('uguale');
  });
  it('i codici si confrontano senza maiuscole e spazi', () => {
    expect(confrontaPerCodice([vm(' livr ', 'SI')], [ia('LIVR', 'SI')], interesse).discrepanze).toEqual([]);
  });
  it('e\' deterministica: stesso ingresso, stesso ordine', () => {
    const a = confrontaPerCodice([vm('Z', 'A'), vm('B', 'A')], [ia('B', 'X'), ia('A', 'A')], new Set());
    const b = confrontaPerCodice([vm('B', 'A'), vm('Z', 'A')], [ia('A', 'A'), ia('B', 'X')], new Set());
    expect(a.discrepanze.map(d => d.codice)).toEqual(b.discrepanze.map(d => d.codice));
  });
});
