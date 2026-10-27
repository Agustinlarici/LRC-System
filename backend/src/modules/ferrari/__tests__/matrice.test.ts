import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import { cellaOpzione, cellaTermine, classeValore, costruisciMatrice, suggerimenti } from '../matrice.js';
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
    [o('EXTRACAMPIONARIO - NOT STANDAR', ['COLORE BLU']), 'Sì — COLORE BLU'],
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
  it('sigla con testo libero e riassunto', () => expect(c('PNT1', { PNT1: 'Blu elder' })).toBe('Sì — Blu elder'));
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

  it('suggerisce le sigle dell\'Excel non ancora scelte, dalla più frequente', () => {
    const s = suggerimenti(schede, ['BIC2']);
    expect(s.map(x => x.codice)).not.toContain('BIC2');
    expect(s[0]!.codice).toBe('CEL2');                                    // presente in entrambe le schede
    expect(s.find(x => x.codice === 'CEL2')?.nome).toBe('ALLEST.VANO MOTORE IN CARBONIO');
  });
});
