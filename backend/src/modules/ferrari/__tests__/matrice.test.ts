import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import { cellaOpzione, cellaTermine, chiaveTesto, classeValore, costruisciMatrice, nuoveSigle, sottosigle } from '../matrice.js';
import type { Opzione } from '../types.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const o = (valore: string, blocchi: string[] = [], nota = ''): Opzione => ({
  riga: 1, sezione: null, codice: 'ABCD', descrizione: 'X', valore, nota,
  blocchi_testo: blocchi.map((testo, n) => ({ n, righe: [n + 2], testo })),
});

describe('cellaOpzione (stessa regola della PC IA)', () => {
  it.each([
    [o('SI'), 'Sì'],
    [o('ROSSO IMOLA'), 'ROSSO IMOLA'],
    [o('SI', ['IN BLU']), 'Sì — IN BLU'],
    [o('EXTRACAMPIONARIO-NOT STANDARD'), 'Extra campionario'],
    [o('EXTRACAMPIONARIO - NOT STANDAR', ['COLORE BLU']), 'Extra campionario — COLORE BLU'],
    [o('SI', ['RIGA UNO', 'RIGA DUE']), 'Sì — RIGA UNO RIGA DUE'],
    [o('50'), '50'],
    [o('', [], 'CLIENTE'), 'CLIENTE'],
    [o('SI', [], 'CLIENTE'), 'Sì'],
  ])('%j → %s', (opz, atteso) => expect(cellaOpzione(opz)).toBe(atteso));

  it('con il riassunto della IA al posto del testo', () => {
    expect(cellaOpzione(o('SI', ['LUNGO TESTO']), 'Blu elder')).toBe('Sì — Blu elder');
  });
  it('classi di valore', () => {
    expect(classeValore('  si ')).toBe('SI');
    expect(classeValore('')).toBe('VUOTO');
  });
});

const OPZ: Opzione[] = [
  { ...o('NERO DS 1250'), codice: 'BIC2', descrizione: 'CARROZZERIA BICOLORE' },
  { ...o('SI'), codice: 'CEL2', descrizione: 'ALLEST.VANO MOTORE IN CARBONIO' },
  { ...o('EXTRACAMPIONARIO-NOT STANDARD', ['CAVALLINO RICAMATO IN FILO MADEIRA 1810. VEDERE IMMAGINI.']), codice: 'EMPH', descrizione: 'CAVALL. CUCITI SU POGGIATESTA' },
  { ...o('EXTRACAMPIONARIO-NOT STANDARD', ['VERNICIARE IN COLORE BLU ELDER']), codice: 'PNT1', descrizione: 'VERNICI' },
];
const c = (t: string, det: Record<string, string> = {}) => cellaTermine(t, OPZ, det).testo;

describe('cellaTermine (stessa regola della PC IA)', () => {
  it('sigla con valore', () => { expect(c('BIC2')).toBe('NERO DS 1250'); expect(c('bic2')).toBe('NERO DS 1250'); });
  it('sigla con "SI"', () => expect(c('CEL2')).toBe('Sì'));
  it('sigla con testo libero e riassunto', () => expect(c('PNT1', { PNT1: 'Blu elder' })).toBe('Extra campionario — Blu elder'));
  it('sigla assente o vuota: cella vuota', () => { expect(c('ZZZ9')).toBe(''); expect(c('')).toBe(''); });
  it('parola nel valore', () => expect(c('NERO')).toBe('NERO DS 1250'));
  it('parola nel testo libero: riassunto o estratto', () => {
    expect(c('elder', { PNT1: 'Blu elder' })).toBe('Blu elder');
    expect(c('cavallino')).toContain('CAVALLINO RICAMATO');
  });
  it('parola nella descrizione', () => expect(c('carbonio')).toBe('Sì'));
  it('solo parole intere', () => expect(c('CARBON')).toBe(''));
  it('testo completo per il suggerimento', () => expect(cellaTermine('EMPH', OPZ).completo).toContain('VEDERE IMMAGINI'));
});

describe('costruisciMatrice / suggerimenti', () => {
  const bic2 = ['BIC2            ', 'CARROZZERIA BICOLORE          ', 'NERO DS 1250                  '];
  const a = parseScheda(toXlsBuffer([...schedaSemplice(), bic2]), 'a.xls');
  const b = parseScheda(toXlsBuffer([...schedaPersonalizzata({ commessa: 100002 }), bic2]), 'b.xls');
  const schede = [{ id: 1, stato: 'IN_REVISIONE', canonico: a }, { id: 2, stato: 'VALIDATO', canonico: b }];

  it('colonne = sigle scelte; celle = Sì o il valore trovato', () => {
    const righe = costruisciMatrice(schede, ['BIC2', 'CEL2', 'LLOG']);
    expect(righe.map(r => r.commessa)).toEqual(['100001', '100002']);
    expect(righe[0]!.celle).toEqual({ BIC2: 'NERO DS 1250', CEL2: 'Sì', LLOG: '' });
    expect(righe[1]!.celle['LLOG']).toBe('Sì — SCUDETTO LASERIZZATO COME DA IMMAGINE.');
    expect(righe[1]!.testi['LLOG']).toContain('SCUDETTO');
  });

  it('il riassunto della PC IA vale solo se il testo e\' ancora lo stesso', () => {
    const testo = 'SCUDETTO LASERIZZATO COME DA IMMAGINE.';
    const giusto = new Map([['100002', new Map([[chiaveTesto(testo), { dettaglio: 'Scudetto laserizzato', stato: 'ok' }]])]]);
    expect(costruisciMatrice(schede, ['LLOG'], giusto)[1]!.celle['LLOG']).toBe('Sì — Scudetto laserizzato');
    const vecchio = new Map([['100002', new Map([[chiaveTesto('ALTRO TESTO'), { dettaglio: 'Scudetto laserizzato', stato: 'ok' }]])]]);
    expect(costruisciMatrice(schede, ['LLOG'], vecchio)[1]!.celle['LLOG']).toContain('COME DA IMMAGINE');
  });

  it('la IA non sicura: la cella mostra l\'originale e segnala che serve una persona', () => {
    const testo = 'SCUDETTO LASERIZZATO COME DA IMMAGINE.';
    const dubbio = new Map([['100002', new Map([[chiaveTesto(testo), { dettaglio: '', stato: 'rivedere' }]])]]);
    const riga = costruisciMatrice(schede, ['LLOG'], dubbio)[1]!;
    expect(riga.celle['LLOG']).toContain('COME DA IMMAGINE');
    expect(riga.rivedere['LLOG']).toBe(true);
    const rivisto = new Map([['100002', new Map([[chiaveTesto(testo), { dettaglio: '', stato: 'rivisto' }]])]]);
    expect(costruisciMatrice(schede, ['LLOG'], rivisto)[1]!.rivedere['LLOG']).toBeUndefined();
  });

  it('chiave del testo uguale a quella calcolata dalla PC IA (Python)', () => {
    expect(chiaveTesto('VERNICIARE VETTURA  in colore blu — è così')).toBe('cdcdbad0bdeff79bf9a8491da52ad04080fb21a2');
    expect(chiaveTesto('VERNICIARE\u001cVETTURA in colore BLU, e cosi')).toBe('cdcdbad0bdeff79bf9a8491da52ad04080fb21a2');   // spazi strani e punteggiatura non contano
  });

  it('le sigle ancora da decidere, nell\'ordine dell\'Excel, con un esempio', () => {
    const n = nuoveSigle(schede, new Set(['EXTC']));
    expect(n.map(x => x.codice).slice(0, 3)).toEqual(['PNCC', 'CEL2', 'TYBR']);        // EXTC già deciso: non si chiede
    expect(new Set(n.map(x => x.codice)).size).toBe(n.length);
    const bic = n.find(x => x.codice === 'BIC2')!;
    expect(bic).toMatchObject({ nome: 'CARROZZERIA BICOLORE', esempio: 'NERO DS 1250' });
    expect(n.find(x => x.codice === 'CEL2')?.esempio).toBe('Sì');
    expect(nuoveSigle(schede, new Set(n.map(x => x.codice).concat(['EXTC'])))).toEqual([]);
  });
});


describe('sotto-sigle (codici dentro i testi liberi, stessa regola della PC IA)', () => {
  const LIVR = 'LIVR: LIVREA TML5 CON PARTE PRINCIPALE IN BIANCO PROVA COD.VERN FYM.*0002 E STRISCE IN NERO DS 1250 (VEDI IMMAGINI). '
    + 'LIVR: LIVREA TLM13 CON IL TRICOLORE SUGLI SPECCHIETTI (VEDI IMMAGINI)';
  const livr = { ...o('SI', [LIVR]), codice: 'LIVR', descrizione: 'LIVREA SPECIALE' };

  it('riconosce i codici con la frase che li contiene', () => {
    const t = sottosigle(livr);
    expect(t.map(x => x.codice)).toEqual(['TML5', 'TLM13']);
    expect(t[0]!.frase.startsWith('LIVR: LIVREA TML5')).toBe(true);
    expect(t[0]!.frase.endsWith('(VEDI IMMAGINI).')).toBe(true);
    expect(t[1]!.frase.startsWith('LIVR: LIVREA TLM13')).toBe(true);
    expect(sottosigle(o('SI', ['COLORE 4000 FILO 816 P2 FYM.*0585 DS 1250']))).toEqual([]);        // numeri e codici corti: no
    expect(sottosigle(o('SI', ['PELLE 2J8B'])).map(x => x.codice)).toEqual(['2J8B']);
    expect(sottosigle(livr, new Set(['TML5']))[0]!.codice).toBe('TLM13');                           // le opzioni vere sono sigle normali
  });

  it('si chiede come per le sigle normali e, se vanno, compaiono dentro la cella (non come colonna)', () => {
    const bic2 = { ...o('NERO DS 1250'), codice: 'BIC2', descrizione: 'CARROZZERIA BICOLORE' };
    const canonico = { ...parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls'), opzioni: [bic2, livr] } as ReturnType<typeof parseScheda>;
    const schede = [{ id: 1, stato: 'IN_REVISIONE', canonico }];
    const nuove = nuoveSigle(schede, new Set());
    expect(nuove.filter(n => n.sub).map(n => n.codice)).toEqual(['TML5', 'TLM13']);
    expect(nuove.find(n => n.codice === 'TML5')).toMatchObject({ sub: true, padre: 'LIVR' });
    expect(nuoveSigle(schede, new Set(['TML5', 'TLM13'])).filter(n => n.sub)).toEqual([]);          // gia' decise
    const riga = costruisciMatrice(schede, ['LIVR'], undefined, new Set(['TML5']))[0]!;
    expect(riga.sub['LIVR']!.map(x => x.codice)).toEqual(['TML5']);
    expect(riga.sub['LIVR']![0]!.testo).toContain('BIANCO PROVA');
    expect(costruisciMatrice(schede, ['LIVR'])[0]!.sub).toEqual({});
  });
});
