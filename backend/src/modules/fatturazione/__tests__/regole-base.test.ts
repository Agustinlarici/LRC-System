import { describe, expect, it } from 'vitest';
import { calcola, type Condizione, type Passo, type Regola } from '../regole-base.js';

let n = 0;
const r = (x: Partial<Regola> & Pick<Regola, 'prezzo'>): Regola =>
  ({ id: ++n, nome: `r${n}`, attiva: true, article_code: '*', logica: 'tutte', condizioni: [], eccezioni: [], ...x });
const p = (cerca: string[], finestra: number | null = null): Passo => ({ cerca, finestra });
const cond = (...passi: Passo[]): Condizione => ({ passi });
const gruppi = new Map([['COLORI', ['ROSSO', 'NERO']]]);

describe('regole di prezzo Fatturazione', () => {
  it('regola senza condizioni = prezzo base sempre', () => {
    expect(calcola('qualsiasi', 'A1', [r({ prezzo: 100 })], gruppi).totale).toBe(100);
  });
  it('colore nei primi 30 caratteri', () => {
    const reg = r({ prezzo: 50, condizioni: [cond(p(['@COLORI'], 30))] });
    expect(calcola('Cofano rosso lucido', 'A1', [reg], gruppi).totale).toBe(50);
    expect(calcola('Cofano standard senza trattamento speciale rosso', 'A1', [reg], gruppi).totale).toBe(0);
  });
  it('catena PPE1 → colore entro 20 → opaco', () => {
    const reg = r({ prezzo: 30, condizioni: [cond(p(['PPE1']), p(['ROSSO'], 20), p(['OPACO'], 15))] });
    expect(calcola('KIT PPE1 VERNICE ROSSO OPACO', 'A1', [reg], gruppi).totale).toBe(30);
    expect(calcola('KIT PPE1 VERNICE ROSSO LUCIDO', 'A1', [reg], gruppi).totale).toBe(0);
    expect(calcola('KIT PPE1 VERNICE NERO OPACO', 'A1', [reg], gruppi).totale).toBe(0);
  });
  it('prova altre occorrenze (backtracking)', () => {
    const reg = r({ prezzo: 10, condizioni: [cond(p(['PPE1']), p(['ROSSO'], 10))] });
    expect(calcola('PPE1 BLU ................ PPE1 ROSSO', 'A1', [reg], gruppi).totale).toBe(10);
  });
  it('più condizioni: «tutte» richiede ogni catena, «qualsiasi» ne basta una', () => {
    const c = [cond(p(['PPE1']), p(['ROSSO'], 20)), cond(p(['CARBONIO']))];
    const tutte = r({ prezzo: 5, logica: 'tutte', condizioni: c });
    const qualsiasi = r({ prezzo: 5, logica: 'qualsiasi', condizioni: c });
    expect(calcola('PPE1 ROSSO CARBONIO', 'A1', [tutte], gruppi).totale).toBe(5);
    expect(calcola('PPE1 ROSSO', 'A1', [tutte], gruppi).totale).toBe(0);
    expect(calcola('PPE1 ROSSO', 'A1', [qualsiasi], gruppi).totale).toBe(5);
    expect(calcola('CARBONIO', 'A1', [qualsiasi], gruppi).totale).toBe(5);
    expect(calcola('NIENTE', 'A1', [qualsiasi], gruppi).totale).toBe(0);
  });
  it('eccezione: se combacia la regola non si applica', () => {
    const reg = r({ prezzo: 20, condizioni: [cond(p(['PPE1']))], eccezioni: [cond(p(['SENZA']), p(['VERNICE'], 10))] });
    expect(calcola('PPE1 STANDARD', 'A1', [reg], gruppi).totale).toBe(20);
    expect(calcola('PPE1 SENZA VERNICE', 'A1', [reg], gruppi).totale).toBe(0);
    const soloEcc = r({ prezzo: 3, eccezioni: [cond(p(['USATO']))] });   // prezzo base «tranne se usato»
    expect(calcola('NUOVO', 'A1', [soloEcc], gruppi).totale).toBe(3);
    expect(calcola('USATO', 'A1', [soloEcc], gruppi).totale).toBe(0);
  });
  it('somma regole, filtra per codice e ignora le disattive', () => {
    const regole = [
      r({ prezzo: 100, article_code: 'A1' }),
      r({ prezzo: 7, article_code: 'B2' }),
      r({ prezzo: 5, attiva: false }),
      r({ prezzo: 2.5, condizioni: [cond(p(['OPACO']))] }),
    ];
    const c = calcola('x opaco', 'A1', regole, gruppi);
    expect(c.totale).toBe(102.5);
    expect(c.applicate).toHaveLength(2);
  });
});
