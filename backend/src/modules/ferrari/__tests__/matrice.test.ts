import { describe, it, expect } from 'vitest';
import { parseScheda } from '../parser.js';
import { cellaOpzione, classeValore, costruisciMatrice } from '../matrice.js';
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

describe('costruisciMatrice', () => {
  const a = parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls');
  const b = parseScheda(toXlsBuffer(schedaPersonalizzata({ commessa: 100002 })), 'b.xls');
  const m = costruisciMatrice([{ id: 1, stato: 'IN_REVISIONE', canonico: a }, { id: 2, stato: 'VALIDATO', canonico: b }]);

  it('una colonna per codice, nell\'ordine in cui compaiono', () => {
    expect(m.colonne.map(c => c.codice).slice(0, 4)).toEqual(['EXTC', 'PNCC', 'CEL2', 'TYBR']);
    expect(new Set(m.colonne.map(c => c.codice)).size).toBe(m.colonne.length);
    expect(m.colonne.find(c => c.codice === 'CEL2')?.nome).toBe('ALLEST.VANO MOTORE IN CARBONIO');
  });

  it('celle: Sì, valore o dettaglio; vuota dove la scheda non ha l\'opzione', () => {
    expect(m.righe[0]!.celle['CEL2']).toBe('Sì');
    expect(m.righe[0]!.celle['INTC']).toBe('ALCANTARA NERA 9440');
    expect(m.righe[0]!.celle['LLOG']).toBeUndefined();
    expect(m.righe[1]!.celle['LLOG']).toBe('Sì — SCUDETTO LASERIZZATO COME DA IMMAGINE.');
    expect(m.righe[1]!.testi['PNT1']).toContain('VERNICIARE VETTURA');
  });

  it('riporta commessa, modello e paese', () => {
    expect(m.righe.map(r => [r.commessa, r.modello, r.paese])).toEqual([['100001', 'F999XX', 'CINA'], ['100002', 'F999XX', 'CINA']]);
  });
});
