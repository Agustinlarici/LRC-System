import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import {
  cellaOpzione, cellaTermine, chiaveTesto, classeValore, costruisciMatrice, entroUno, nuoveSigle, simileA, sottosigle, sottosigleAccettate,
  dividiSottoSigle, type CtxSigle,
} from '../matrice.js';
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


describe('tolleranza agli errori di scrittura (stessa regola della PC IA)', () => {
  const ctx = (alias: Record<string, string> = {}, decisi: string[] = []): CtxSigle => ({ alias: new Map(Object.entries(alias)), decisi: new Set(decisi) });
  const opz = (cod: string, valore: string, testi: string[] = []) => ({ ...o(valore, testi), codice: cod, descrizione: 'D ' + cod });

  it('un carattere di distanza', () => {
    for (const [a, b] of [['TLM15', 'TLM16'], ['TML5', 'TLM5'], ['BIC2', 'BLC2'], ['TLM5', 'TLM55'], ['TLM55', 'TLM5']]) expect(entroUno(a!, b!)).toBe(true);
    for (const [a, b] of [['TLM5', 'TLM5'], ['TLM15', 'TLM26'], ['ABC', 'ABCDE']]) expect(entroUno(a!, b!)).toBe(false);
    expect(simileA('AB1', ['AB2'])).toBeNull();                                  // troppo corto
    expect(simileA('TLM15', ['TLM5', 'TLM16', 'ZZZ9'])).toBe('TLM16');          // prima lo stesso numero di caratteri
  });

  it('codici scritti con spazi o trattini', () => {
    const r = sottosigleAccettate(opz('LIVR', 'SI', ['LIVREA TL m5 E TLM-13 SUGLI SPECCHI']), new Set(['TLM5', 'TLM13']), ctx());
    const per = Object.fromEntries(r.map(x => [x.codice, x.avviso]));
    expect(per).toEqual({ TLM5: 'scritta «TL m5»', TLM13: 'scritta «TLM-13»' });
  });

  it('errore di una cifra: avviso; alias deciso: correzione; deciso come codice vero: niente avviso', () => {
    const livr = opz('LIVR', 'SI', ['LIVREA TLM15 SUGLI SPECCHI']);
    const acc = new Set(['TLM16']);
    expect(sottosigleAccettate(livr, acc, ctx())[0]).toMatchObject({ codice: 'TLM16', scritto: 'TLM15', avviso: 'scritta TLM15: forse TLM16? controlla' });
    expect(sottosigleAccettate(livr, acc, ctx({ TLM15: 'TLM16' }, ['TLM15']))[0]).toMatchObject({ codice: 'TLM16', avviso: 'scritta TLM15 (corretta in TLM16)' });
    expect(sottosigleAccettate(livr, new Set(['TLM15', 'TLM16']), ctx({}, ['TLM15']))[0]).toMatchObject({ codice: 'TLM15', avviso: null });
    expect(sottosigleAccettate(livr, acc, ctx({}, ['TLM15']))).toEqual([]);                           // deciso (anche «no»): non e' un sospetto
  });

  it('sigla di colonna scritta male, con alias, e codici veri simili che non si confondono', () => {
    const blc2 = [opz('BLC2', 'NERO DS 1250')];
    const cella = (c?: CtxSigle) => cellaTermine('BIC2', blc2, {}, c);
    expect(cella(ctx())).toMatchObject({ testo: 'NERO DS 1250', avviso: 'scritta BLC2: forse BIC2? controlla' });
    expect(cella(ctx({ BLC2: 'BIC2' }, ['BLC2']))).toMatchObject({ testo: 'NERO DS 1250', avviso: 'scritta BLC2, corretta in BIC2' });
    expect(cella(ctx({}, ['BLC2']))).toMatchObject({ testo: '', opzione: null });                    // deciso come codice vero: colonna vuota
    const cexs = [opz('CEXS', 'SI')];
    expect(cellaTermine('CEXD', cexs, {}, ctx({}, ['CEXS', 'CEXD'])).testo).toBe('');                // CEXD e CEXS sono due opzioni vere
  });

  it('la domanda ha l\'indizio «simile a»', () => {
    const livr = opz('LIVR', 'SI', ['LIVREA TLM15 CON PARTE PRINCIPALE']);
    const canonico = { ...parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls'), opzioni: [livr] } as ReturnType<typeof parseScheda>;
    const n = nuoveSigle([{ canonico }], new Set(['TLM16']), ['TLM16']).find(x => x.codice === 'TLM15');
    expect(n).toMatchObject({ sub: true, simile_a: 'TLM16' });
  });
});


describe('niente ripetizioni: ogni parte del testo sta in un posto solo (come sulla PC IA)', () => {
  const DET = 'LIVR: LIVREA TML5: bianco prova cod. vern. FYM.*0002, strisce nero DS 1250 (vedi immagini) | LIVR: LIVREA TLM13: tricolore sugli specchietti (vedi immagini)';
  const RAW = 'LIVR: LIVREA TML5 CON PARTE PRINCIPALE IN BIANCO PROVA (VEDI IMMAGINI). LIVR: LIVREA TLM13 CON IL TRICOLORE (VEDI IMMAGINI)';
  const mk = (testi: string[]) => ({ ...o('SI', testi), codice: 'LIVR', descrizione: 'LIVREA SPECIALE' });
  const scheda = (op: ReturnType<typeof mk>) => [{
    id: 1, stato: 'IN_REVISIONE',
    canonico: { ...parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls'), opzioni: [op] } as ReturnType<typeof parseScheda>,
  }];

  it('con il riassunto della IA: ogni sotto-sigla ha il suo pezzo e nella cella resta solo «Sì»', () => {
    const dettagli = new Map([[scheda(mk([RAW]))[0]!.canonico.header.commessa ?? '', new Map([[chiaveTesto(RAW), { dettaglio: DET, stato: 'ok' }]])]]);
    const riga = costruisciMatrice(scheda(mk([RAW])), ['LIVR'], dettagli, new Set(['TML5', 'TLM13']))[0]!;
    expect(riga.celle['LIVR']).toBe('Sì');
    expect(riga.sub['LIVR']!.map(x => [x.codice, x.testo])).toEqual([['TML5', DET.split(' | ')[0]], ['TLM13', DET.split(' | ')[1]]]);
  });

  it('quello che non e\' di nessuna sigla resta fuori, una volta sola; con una sola accettata, l\'altra parte resta fuori', () => {
    const { resto, sub } = dividiSottoSigle(mk([RAW]), new Set(['TML5']));
    expect(resto.startsWith('LIVR: LIVREA TLM13 CON IL TRICOLORE')).toBe(true);
    expect(sub.map(x => x.codice)).toEqual(['TML5']);
    const riga = costruisciMatrice(scheda(mk([RAW])), ['LIVR'], undefined, new Set(['TML5']))[0]!;
    expect(riga.celle['LIVR']!.startsWith('Sì — LIVR: LIVREA TLM13 CON IL TRICOLORE')).toBe(true);
    expect(riga.celle['LIVR']).not.toContain('TML5');
  });

  it('due sotto-sigle nella stessa parte non la ripetono', () => {
    const { resto, sub } = dividiSottoSigle(mk(['LIVREA TML5 E TLM13 INSIEME. ALTRA COSA SENZA CODICI']), new Set(['TML5', 'TLM13']));
    expect(resto).toBe('ALTRA COSA SENZA CODICI');
    expect(sub.map(x => [x.codice, x.testo !== ''])).toEqual([['TML5', true], ['TLM13', false]]);
  });
});
