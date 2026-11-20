import { describe, expect, it } from 'vitest';
import { calcola, chiaveRegola, indicizza, type Passo, type Regola } from '../regole-base.js';

let n = 0;
const r = (x: Partial<Regola> & Pick<Regola, 'prezzo'>): Regola =>
  ({ id: ++n, nome: `r${n}`, attiva: true, article_code: '*', passi: [], ...x });
const p = (cerca: string[], finestra: number | null = null): Passo => ({ cerca, finestra });
const gruppi = new Map([['COLORI', ['ROSSO', 'NERO']]]);
const calc = (descr: string, art: string, regole: Regola[]) => calcola(descr, art, regole, gruppi);

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
  it('articolo singolo: vale solo per il suo codice (maiuscole e spazi ininfluenti); * = tutti', () => {
    const reg = r({ prezzo: 40, article_code: 'a1' });
    expect(calc('x', 'A1', [reg]).totale).toBe(40);
    expect(calc('x', ' A1 ', [reg]).totale).toBe(40);
    expect(calc('x', 'A2', [reg]).totale).toBe(0);
    expect(calc('x', 'ZZ', [r({ prezzo: 1, article_code: '*' })]).totale).toBe(1);
  });
  it('somma regole, ignora le disattive', () => {
    const regole = [
      r({ prezzo: 100, article_code: 'A1' }),
      r({ prezzo: 7, article_code: 'B2' }),
      r({ prezzo: 5, attiva: false }),
      r({ prezzo: 2.5, passi: [p(['OPACO'])] }),
    ];
    const c = calc('x opaco', 'A1', regole);
    expect(c.totale).toBe(102.5);
    expect(c.applicate).toHaveLength(2);
  });
  it('chiave: stessa regola = stessa chiave, a prescindere da maiuscole, ordine delle alternative e spazi', () => {
    const a = chiaveRegola({ article_code: 'a1', passi: [p(['rosso', 'Nero']), p(['opaco'], 20)] });
    expect(chiaveRegola({ article_code: ' A1', passi: [p(['NERO', 'ROSSO ']), p(['OPACO'], 20)] })).toBe(a);
    expect(chiaveRegola({ article_code: 'A1', passi: [p(['NERO', 'ROSSO']), p(['OPACO'], 30)] })).not.toBe(a);
    expect(chiaveRegola({ article_code: 'A2', passi: [p(['NERO', 'ROSSO']), p(['OPACO'], 20)] })).not.toBe(a);
  });
  it('con migliaia di regole: il risultato con l\u2019indice è identico a scorrerle tutte', () => {
    const regole: Regola[] = [r({ prezzo: 1 }), r({ prezzo: 2, passi: [p(['OPACO'])] })];
    for (let i = 0; i < 5000; i++) regole.push(r({ prezzo: i + 1, article_code: `ART-${i}`, passi: i % 2 ? [p(['ROSSO'])] : [] }));
    const per = indicizza(regole);
    for (const art of ['ART-0', 'art-1 ', 'ART-4999', 'ART-5000', 'ZZ']) {
      const tutte = calc('x rosso opaco', art, regole);
      const indice = calcola('x rosso opaco', art, per(art), gruppi);
      expect(indice.totale).toBe(tutte.totale);
      expect(indice.applicate.map(a => a.id).sort()).toEqual(tutte.applicate.map(a => a.id).sort());
    }
  });
});
