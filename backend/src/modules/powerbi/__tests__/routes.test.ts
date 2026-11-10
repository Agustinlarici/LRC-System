import { describe, it, expect } from 'vitest';
import { keyMatches, toCsv, BOM_COLUMNS } from '../routes.js';

describe('keyMatches', () => {
  it('accetta solo la chiave esatta', () => {
    expect(keyMatches('segreto-lungo', 'segreto-lungo')).toBe(true);
    expect(keyMatches('segreto-lungo ', 'segreto-lungo')).toBe(false);
    expect(keyMatches('altro', 'segreto-lungo')).toBe(false);
  });

  it('rifiuta chiave assente o vuota', () => {
    expect(keyMatches(undefined, 'segreto')).toBe(false);
    expect(keyMatches('', 'segreto')).toBe(false);
  });
});

describe('toCsv', () => {
  it('scrive l\'intestazione con i nomi e l\'ordine della query originale', () => {
    expect(toCsv([]).split('\r\n')[0]).toBe('Data_Inserimento,Descrizione,Codice_Vendita,Modello,Codint,Componente,Versione');
    expect(BOM_COLUMNS).toHaveLength(7);
  });

  it('formatta la data senza fuso e lascia vuoti i valori nulli', () => {
    const csv = toCsv([{ Data_Inserimento: new Date('2026-10-01T08:30:15Z'), Codice_Vendita: 'CV1', Descrizione: null }]);
    expect(csv.split('\r\n')[1]).toBe('2026-10-01 08:30:15,,CV1,,,,');
  });

  it('mette tra virgolette virgole, virgolette e a capo', () => {
    const csv = toCsv([{ Descrizione: 'Pannello, "DX"\nnuovo' }]);
    expect(csv).toContain('"Pannello, ""DX""\nnuovo"');
  });
});
