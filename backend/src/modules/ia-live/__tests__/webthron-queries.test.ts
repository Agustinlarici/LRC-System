import { beforeEach, describe, expect, it, vi } from 'vitest';

// La base di dati è simulata: si verifica forma delle risposte e validazione dei parametri, senza toccare PostgreSQL.
const dbMock = vi.hoisted(() => vi.fn());
vi.mock('../../../db/client.js', () => ({ db: dbMock }));
vi.mock('../../edi/dynamics-client.js', () => ({ getDynamicsConfig: vi.fn() }));
vi.mock('../../fatturazione/bc.js', () => ({ getRigheDespachi: vi.fn() }));

import { IA_QUERIES } from '../queries.js';

beforeEach(() => dbMock.mockReset());

describe('query IA sullo storico WebThron (copia in PostgreSQL)', () => {
  it('wt_events_commessa: colonne e righe, data in ISO, esito nullo ammesso', async () => {
    dbMock.mockResolvedValue([{ fase: 'F1', componente: 'C1', cod_seriale: 'S1', esito_delibera: null, data_inserimento: '2026-10-12T08:00:00Z' }]);
    const q = IA_QUERIES.wt_events_commessa;
    const r = await q.esegui(q.parametri.parse({ commessa: 'C-100' }));
    expect(r.colonne).toEqual(['fase', 'componente', 'seriale', 'esito', 'data']);
    expect(r.righe).toEqual([['F1', 'C1', 'S1', null, '2026-10-12T08:00:00.000Z']]);
    // il valore passa come parametro del template (mai concatenato nel testo SQL)
    expect(dbMock.mock.calls[0].slice(1)).toContain('C-100');
  });

  it('wt_serial_history e wt_daily_counts rispondono con la forma attesa', async () => {
    dbMock.mockResolvedValueOnce([{ fase: 'F1', modello: 'M', componente: 'C', commessa: 'X', esito_delibera: 'OK', data_inserimento: '2026-10-12T08:00:00Z' }]);
    const s = IA_QUERIES.wt_serial_history;
    expect((await s.esegui(s.parametri.parse({ seriale: 'S1' }))).righe[0][0]).toBe('F1');
    dbMock.mockResolvedValueOnce([{ fase: 'F1', esito: 'OK', n: 3 }]);
    const d = IA_QUERIES.wt_daily_counts;
    expect((await d.esegui(d.parametri.parse({ data: '2026-10-12' }))).righe).toEqual([['F1', 'OK', 3]]);
  });

  it('i parametri non validi o extra vengono rifiutati', () => {
    expect(IA_QUERIES.wt_daily_counts.parametri.safeParse({ data: '12/10/2026' }).success).toBe(false);
    expect(IA_QUERIES.wt_events_commessa.parametri.safeParse({ commessa: '' }).success).toBe(false);
    expect(IA_QUERIES.wt_serial_history.parametri.safeParse({ seriale: 'S1', extra: 1 }).success).toBe(false);
  });
});
