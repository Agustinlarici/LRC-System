import { describe, it, expect } from 'vitest';
import { parseCapoHeader, parseTaglia, parseSiNo, isGiletHeader, buildImportPlan, dataConsegnaValida, type EmpLite } from '../vestiario.js';

describe('parseCapoHeader', () => {
  it('separa nome e colore tra parentesi', () => {
    expect(parseCapoHeader('FELPA BCWG004 (GRIGIA)')).toEqual({ nome: 'FELPA BCWG004', colore: 'GRIGIA' });
    expect(parseCapoHeader('POLO BSW201 E BS201 (ROSSA)')).toEqual({ nome: 'POLO BSW201 E BS201', colore: 'ROSSA' });
    expect(parseCapoHeader('T-SHIRT R040 (GRIGIO CHIARO)')).toEqual({ nome: 'T-SHIRT R040', colore: 'GRIGIO CHIARO' });
  });
  it('senza parentesi il colore è vuoto', () => {
    expect(parseCapoHeader('GILET')).toEqual({ nome: 'GILET', colore: '' });
    expect(parseCapoHeader('PANTALONI POWER UNISEX SMOKE')).toEqual({ nome: 'PANTALONI POWER UNISEX SMOKE', colore: '' });
  });
  it('intestazione vuota = nessun capo', () => {
    expect(parseCapoHeader('  ')).toBeNull();
  });
});

describe('parseTaglia', () => {
  it('riconosce la taglia semplice', () => {
    expect(parseTaglia('L')).toBe('L');
    expect(parseTaglia(' xl ')).toBe('XL');
    expect(parseTaglia('3XL')).toBe('3XL');
    expect(parseTaglia('XXS')).toBe('XXS');
    expect(parseTaglia('xxs donna')).toBe('XXS');
  });
  it('estrae la taglia quando la cella ha altro testo', () => {
    expect(parseTaglia('L uomo')).toBe('L');
    expect(parseTaglia('M - donna')).toBe('M');
    expect(parseTaglia('XXL uomo')).toBe('XXL');
  });
  it('vuota, ambigua o sconosciuta', () => {
    expect(parseTaglia('')).toBe('');
    expect(parseTaglia('S M')).toBe('ambigua');
    expect(parseTaglia('uomo')).toBe('sconosciuta');
  });
});

describe('buildImportPlan', () => {
  const emps: EmpLite[] = [
    { id: 1, cognome: 'Rossi', nome: 'Mario', stato: 'attivo' },
    { id: 2, cognome: 'De Luca', nome: 'Anna', stato: 'attivo' },
    { id: 3, cognome: 'Bianchi', nome: 'Luca', stato: 'cessato' },
    { id: 4, cognome: 'Bianchi', nome: 'Luca', stato: 'attivo' },
  ];
  const header = ['COGNOME E NOME', 'PANTALONI', 'FELPA (GRIGIA)', 'T-SHIRT'];

  it('assegna le taglie e salta le celle vuote', () => {
    const p = buildImportPlan(header, [['ROSSI MARIO', 'L', '', 'xl uomo']], emps);
    expect(p.capi.map(c => c.col)).toEqual([1, 2, 3]);
    expect(p.assegnazioni).toEqual([
      { employee_id: 1, col: 1, taglia: 'L' },
      { employee_id: 1, col: 3, taglia: 'XL' },
    ]);
  });
  it('gestisce cognomi composti, accenti e righe più corte', () => {
    const p = buildImportPlan(header, [['de luca  anna', 'M']], emps);
    expect(p.assegnazioni).toEqual([{ employee_id: 2, col: 1, taglia: 'M' }]);
  });
  it('segnala non trovati e taglie illeggibili', () => {
    const p = buildImportPlan(header, [['NESSUNO QUI', 'L'], ['ROSSI MARIO', 'boh', 'S M']], emps);
    expect(p.non_trovati).toEqual([{ riga: 2, nome: 'NESSUNO QUI', motivo: 'Dipendente non trovato' }]);
    expect(p.avvisi.map(a => a.motivo)).toEqual(['Taglia non riconosciuta', 'Più taglie nella cella']);
    expect(p.assegnazioni).toEqual([]);
  });
  it('tra omonimi sceglie l\'unico attivo', () => {
    const p = buildImportPlan(header, [['BIANCHI LUCA', 'S']], emps);
    expect(p.assegnazioni).toEqual([{ employee_id: 4, col: 1, taglia: 'S' }]);
  });
});

describe('dataConsegnaValida', () => {
  const now = new Date('2026-11-27T10:00:00Z');
  it('accetta oggi e il passato', () => {
    expect(dataConsegnaValida('2026-11-27', now)).toBe(true);
    expect(dataConsegnaValida('2026-01-05', now)).toBe(true);
  });
  it('rifiuta il futuro, date inesistenti e formati sbagliati', () => {
    expect(dataConsegnaValida('2026-12-30', now)).toBe(false);
    expect(dataConsegnaValida('2026-02-31', now)).toBe(false);
    expect(dataConsegnaValida('27/11/2026', now)).toBe(false);
    expect(dataConsegnaValida('1999-01-01', now)).toBe(false);
  });
});

describe('gilet sì/no', () => {
  const emps: EmpLite[] = [{ id: 1, cognome: 'Rossi', nome: 'Mario', stato: 'attivo' }];
  it('riconosce sì/no', () => {
    expect(parseSiNo('SI')).toBe(true);
    expect(parseSiNo(' sì ')).toBe(true);
    expect(parseSiNo('No')).toBe(false);
    expect(parseSiNo('')).toBe('');
    expect(parseSiNo('forse')).toBeNull();
  });
  it('la colonna GILET non è un capo con taglia', () => {
    expect(isGiletHeader('GILET')).toBe(true);
    expect(isGiletHeader('GILET (BLU)')).toBe(false);
    const p = buildImportPlan(['COGNOME E NOME', 'PANTALONI', 'GILET'], [['ROSSI MARIO', 'L', 'SI']], emps);
    expect(p.capi.map(c => c.nome)).toEqual(['PANTALONI']);
    expect(p.gilet).toEqual([{ employee_id: 1, valore: true }]);
    expect(p.assegnazioni).toEqual([{ employee_id: 1, col: 1, taglia: 'L' }]);
  });
  it('valore non riconosciuto = avviso', () => {
    const p = buildImportPlan(['COGNOME E NOME', 'GILET'], [['ROSSI MARIO', 'M']], emps);
    expect(p.gilet).toEqual([]);
    expect(p.avvisi[0].capo).toBe('GILET');
  });
});
