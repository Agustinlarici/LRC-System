import { describe, expect, it } from 'vitest';
import { calcola, type Passo, type Regola } from '../regole-base.js';

let n = 0;
const r = (x: Partial<Regola> & Pick<Regola, 'prezzo'>): Regola =>
  ({ id: ++n, nome: `r${n}`, attiva: true, gruppo: null, passi: [], ...x });
const p = (cerca: string[], finestra: number | null = null): Passo => ({ cerca, finestra });
const gruppi = new Map([['COLORI', ['ROSSO', 'NERO']]]);
const articoli = new Map([['COFANO SF90', new Set(['A1', 'A2'])], ['PORTA', new Set(['B2'])]]);
const calc = (descr: string, art: string, regole: Regola[]) => calcola(descr, art, regole, gruppi, articoli);

describe('regole di prezzo Fatturazione', () => {
  it('regola senza passi = prezzo base sempre', () => {
    expect(calc('qualsiasi', 'A1', [r({ prezzo: 100 })]).totale).toBe(100);
  });
  it('colore nei primi 30 caratteri', () => {
    const reg = r({ prezzo: 50, passi: [p(['@COLORI'], 30)] });
    expect(calc('Cofano rosso lucido', 'A1', [reg]).totale).toBe(50);
    expect(calc('Cofano standard senza trattamento speciale rosso', 'A1', [reg]).totale).toBe(0);
  });
  it('catena PPE1 → colore entro 20 → opaco: se un passo non trova, non fa nulla', () => {
    const reg = r({ prezzo: 30, passi: [p(['PPE1']), p(['ROSSO'], 20), p(['OPACO'], 15)] });
    expect(calc('KIT PPE1 VERNICE ROSSO OPACO', 'A1', [reg]).totale).toBe(30);
    expect(calc('KIT PPE1 VERNICE ROSSO LUCIDO', 'A1', [reg]).totale).toBe(0);
    expect(calc('KIT PPE1 VERNICE NERO OPACO', 'A1', [reg]).totale).toBe(0);
    expect(calc('KIT VERNICE ROSSO OPACO', 'A1', [reg]).totale).toBe(0);
  });
  it('prova altre occorrenze (backtracking)', () => {
    const reg = r({ prezzo: 10, passi: [p(['PPE1']), p(['ROSSO'], 10)] });
    expect(calc('PPE1 BLU ................ PPE1 ROSSO', 'A1', [reg]).totale).toBe(10);
  });
  it('gruppo di articoli: vale solo per i suoi codici (maiuscole e spazi ininfluenti)', () => {
    const reg = r({ prezzo: 40, gruppo: 'cofano sf90' });
    expect(calc('x', 'A1', [reg]).totale).toBe(40);
    expect(calc('x', ' a2 ', [reg]).totale).toBe(40);
    expect(calc('x', 'B2', [reg]).totale).toBe(0);
  });
  it('gruppo inesistente: la regola non si applica', () => {
    expect(calc('x', 'A1', [r({ prezzo: 40, gruppo: 'CANCELLATO' })]).totale).toBe(0);
  });
  it('somma regole, ignora le disattive', () => {
    const regole = [
      r({ prezzo: 100, gruppo: 'COFANO SF90' }),
      r({ prezzo: 7, gruppo: 'PORTA' }),
      r({ prezzo: 5, attiva: false }),
      r({ prezzo: 2.5, passi: [p(['OPACO'])] }),
    ];
    const c = calc('x opaco', 'A1', regole);
    expect(c.totale).toBe(102.5);
    expect(c.applicate).toHaveLength(2);
  });
});
