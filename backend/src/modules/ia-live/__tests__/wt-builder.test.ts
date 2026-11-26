import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/client.js', () => ({ db: { begin: vi.fn() } }));
vi.mock('../../edi/dynamics-client.js', () => ({ getDynamicsConfig: vi.fn() }));
vi.mock('../../fatturazione/bc.js', () => ({ getRigheDespachi: vi.fn() }));

import { ParametriWt, pianoWt } from '../wt-builder.js';
import { IA_QUERIES } from '../queries.js';

const ok = (p: unknown) => ParametriWt.safeParse(p).success;

describe('costruttore WebThron: validazione (il modello compila una scheda, non scrive SQL)', () => {
  it('accetta le domande tipiche', () => {
    expect(ok({ commessa: 'C1', componente: 'X', raggruppa: 'fase' })).toBe(true);                       // a che fase è?
    expect(ok({ modello: 'M', dal: '2026-11-26', al: '2026-11-26', raggruppa: 'esito' })).toBe(true);    // deliberati di oggi
    expect(ok({ seriale: 'S1' })).toBe(true);
  });
  it('rifiuta richieste senza alcun filtro (scansione dell’intera tabella)', () => {
    expect(ok({})).toBe(false);
    expect(ok({ raggruppa: 'fase' })).toBe(false);
  });
  it('limita l’intervallo di date', () => {
    expect(ok({ dal: '2026-01-01', al: '2026-12-31' })).toBe(false);
    expect(ok({ dal: '2026-11-10', al: '2026-11-01' })).toBe(false);
    expect(ok({ dal: '2026-11-01' })).toBe(false);                 // dal senza al
    expect(ok({ dal: '2026-09-01', al: '2026-11-26' })).toBe(true); // 86 giorni
  });
  it('raggruppa: solo colonne dell’elenco chiuso, al massimo 3, senza duplicati', () => {
    expect(ok({ commessa: 'C', raggruppa: 'id;drop table x' })).toBe(false);
    expect(ok({ commessa: 'C', raggruppa: 'password' })).toBe(false);
    expect(ok({ commessa: 'C', raggruppa: 'fase,fase' })).toBe(false);
    expect(ok({ commessa: 'C', raggruppa: 'fase,componente,modello,esito' })).toBe(false);
    expect(ok({ commessa: 'C', raggruppa: 'fase,esito' })).toBe(true);
  });
  it('parametri sconosciuti o vuoti rifiutati', () => {
    expect(ok({ commessa: 'C', extra: 1 })).toBe(false);
    expect(ok({ commessa: '' })).toBe(false);
    expect(ok({ commessa: 'x'.repeat(101) })).toBe(false);
  });
});

describe('pianoWt', () => {
  it('traduce i nomi esposti nelle colonne reali', () => {
    const p = pianoWt(ParametriWt.parse({ commessa: 'C1', seriale: 'S1', esito: 'KO', raggruppa: 'esito,seriale,data' }));
    expect(p.filtri).toEqual([{ colonna: 'commessa', valore: 'C1' }, { colonna: 'cod_seriale', valore: 'S1' }, { colonna: 'esito_delibera', valore: 'KO' }]);
    expect(p.gruppi.map(g => g.colonna)).toEqual(['esito_delibera', 'cod_seriale', 'data_cache']);
  });
  it('senza commessa/seriale/date usa gli ultimi 7 giorni; con commessa nessun limite di date', () => {
    const a = pianoWt(ParametriWt.parse({ fase: 'DELIBERA FINALE - PROX', raggruppa: 'commessa' }));
    expect(a.dal && a.al).toBeTruthy();
    expect((Date.parse(a.al!) - Date.parse(a.dal!)) / 86_400_000).toBe(6);
    const b = pianoWt(ParametriWt.parse({ commessa: 'C1', raggruppa: 'fase' }));
    expect(b.dal).toBeUndefined();
  });
  it('il dataset wt_events è nel catalogo IA e accetta parametri facoltativi', () => {
    expect(IA_QUERIES.wt_events).toBeDefined();
    expect(IA_QUERIES.wt_events.parametri.safeParse({ commessa: 'C1' }).success).toBe(true);
  });
});
