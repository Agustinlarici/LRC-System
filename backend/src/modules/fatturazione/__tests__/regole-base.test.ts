import { describe, expect, it } from 'vitest';
import { calcola, type Regola } from '../regole-base.js';

let n = 0;
const r = (x: Partial<Regola> & Pick<Regola, 'prezzo' | 'passi'>): Regola =>
  ({ id: ++n, nome: `r${n}`, attiva: true, article_code: '*', ...x });
const gruppi = new Map([['COLORI', ['ROSSO', 'NERO']]]);

describe('regole di prezzo Fatturazione', () => {
  it('regola senza passi = prezzo base sempre', () => {
    expect(calcola('qualsiasi', 'A1', [r({ prezzo: 100, passi: [] })], gruppi).totale).toBe(100);
  });
  it('colore nei primi 30 caratteri', () => {
    const reg = r({ prezzo: 50, passi: [{ cerca: ['@COLORI'], finestra: 30 }] });
    expect(calcola('Cofano rosso lucido', 'A1', [reg], gruppi).totale).toBe(50);
    expect(calcola('Cofano standard senza trattamento speciale rosso', 'A1', [reg], gruppi).totale).toBe(0);
  });
  it('catena PPE1 → colore entro 20 → opaco', () => {
    const reg = r({ prezzo: 30, passi: [
      { cerca: ['PPE1'], finestra: null }, { cerca: ['ROSSO'], finestra: 20 }, { cerca: ['OPACO'], finestra: 15 },
    ] });
    expect(calcola('KIT PPE1 VERNICE ROSSO OPACO', 'A1', [reg], gruppi).totale).toBe(30);
    expect(calcola('KIT PPE1 VERNICE ROSSO LUCIDO', 'A1', [reg], gruppi).totale).toBe(0);
    expect(calcola('KIT PPE1 VERNICE NERO OPACO', 'A1', [reg], gruppi).totale).toBe(0);
  });
  it('prova altre occorrenze (backtracking)', () => {
    const reg = r({ prezzo: 10, passi: [{ cerca: ['PPE1'], finestra: null }, { cerca: ['ROSSO'], finestra: 10 }] });
    expect(calcola('PPE1 BLU ................ PPE1 ROSSO', 'A1', [reg], gruppi).totale).toBe(10);
  });
  it('somma regole, filtra per codice e ignora le disattive', () => {
    const regole = [
      r({ prezzo: 100, article_code: 'A1', passi: [] }),
      r({ prezzo: 7, article_code: 'B2', passi: [] }),
      r({ prezzo: 5, attiva: false, passi: [] }),
      r({ prezzo: 2.5, passi: [{ cerca: ['OPACO'], finestra: null }] }),
    ];
    const c = calcola('x opaco', 'A1', regole, gruppi);
    expect(c.totale).toBe(102.5);
    expect(c.applicate).toHaveLength(2);
  });
});
