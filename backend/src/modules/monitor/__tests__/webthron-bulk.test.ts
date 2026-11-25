import { describe, it, expect, vi, beforeEach } from 'vitest';

// Senza pausa minima nella guardia: il test non deve aspettare tempo vero
vi.hoisted(() => { process.env.WEBTHRON_MIN_GAP_MS = '0'; });

vi.mock('../../../lib/system-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/system-flags.js')>()),
  getIKnowFlags: async () => ({ iknow_enabled: true }),
}));

type Params = unknown[];
const calls: Array<{ from: string; to: string }> = [];
const setLog: string[] = [];
const sqls: string[] = [];
let behave: (from: string, to: string) => Array<Record<string, unknown>> = () => [];

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: () => ({
      on: () => undefined,
      end: async () => undefined,
      query: async (sql: string) => { setLog.push(sql); return [[]]; },
      execute: async (q: unknown, params: Params) => {
        sqls.push(typeof q === 'string' ? q : (q as { sql: string }).sql);
        const [from, to] = params as [string, string];
        calls.push({ from, to });
        return [behave(from, to)];
      },
    }),
  },
}));

import { queryWebthronEvents, BULK_SLICE_HOURS } from '../mysql-client.js';

const combos = [{ fase: 'F', modello: 'M', componente: 'C' }];
const hours = (from: string, to: string) =>
  (Date.parse(to.replace(' ', 'T') + 'Z') - Date.parse(from.replace(' ', 'T') + 'Z')) / 3_600_000;
const row = (id: number) => ({
  fase: 'F', modello: 'M', componente: 'C', cod_seriale: `S${id}`, commessa: null,
  esito_delibera: null, data_inserimento: new Date(2026, 2, 5), versione: null, operatore: null, colore: null, protocollo_cesta: null,
});
const week = { mode: 'range' as const, from: '2026-03-04', to: '2026-03-10', sliceHours: 168 };

beforeEach(() => { calls.length = 0; setLog.length = 0; sqls.length = 0; behave = () => []; });

describe('lettura a settimane da WebThron', () => {
  it('di default la carica usa una settimana intera (168 ore)', () => {
    expect(BULK_SLICE_HOURS).toBe(168);
  });

  it('una settimana = una sola query', async () => {
    behave = () => [row(1), row(2)];
    const rows = await queryWebthronEvents(combos, [], week);
    expect(calls).toHaveLength(1);
    expect(hours(calls[0].from, calls[0].to)).toBe(168);
    expect(rows).toHaveLength(2);
  });

  it('la settimana gira con limite di 30 s e poi si torna a 15 s', async () => {
    await queryWebthronEvents(combos, [], week);
    expect(setLog).toEqual([
      'SET SESSION max_statement_time = 30',
      'SET SESSION max_statement_time = 15',
    ]);
  });

  it('il limite si ripristina anche se la query fallisce', async () => {
    behave = () => { throw Object.assign(new Error('connessione persa'), { code: 'ECONNRESET' }); };
    await queryWebthronEvents(combos, [], week).catch(() => undefined);
    expect(setLog.at(-1)).toBe('SET SESSION max_statement_time = 15');
  });

  it('le rebanadine corte non toccano il limite', async () => {
    await queryWebthronEvents(combos, [], { mode: 'range', from: '2026-03-10', to: '2026-03-10' });
    expect(setLog).toEqual([]);
  });

  it('senza sliceHours resta a rebanadine di 4 ore (rilettura di un giorno)', async () => {
    await queryWebthronEvents(combos, [], { mode: 'range', from: '2026-03-10', to: '2026-03-10' });
    expect(calls).toHaveLength(6);
    expect(calls.every(c => hours(c.from, c.to) === 4)).toBe(true);
  });

  it('se la settimana scade la divide a metà e non perde righe', async () => {
    const timeout = Object.assign(new Error('timeout'), { errno: 1969 });
    behave = (from, to) => {
      if (hours(from, to) > 100) throw timeout;
      return [row(hours(from, to))];
    };
    const rows = await queryWebthronEvents(combos, [], week);
    expect(calls[0]).toMatchObject({ from: '2026-03-03 23:00:00', to: '2026-03-10 23:00:00' });
    expect(calls).toHaveLength(3);                        // settimana (scaduta) + 2 metà
    expect(calls[1].to).toBe(calls[2].from);              // metà contigue
    expect(calls[1].from).toBe('2026-03-03 23:00:00');
    expect(calls[2].to).toBe('2026-03-10 23:00:00');
    expect(rows).toHaveLength(2);
  });

  it('se la settimana arriva al limite di righe la divide a metà invece di troncare', async () => {
    behave = (from, to) => hours(from, to) > 100
      ? Array.from({ length: 150_000 }, (_, i) => row(i))
      : [row(1)];
    const rows = await queryWebthronEvents(combos, [], week);
    expect(calls).toHaveLength(3);
    expect(rows).toHaveLength(2);                         // le righe della settimana troncata si scartano
  });

  it('un errore che non è un timeout non si maschera dividendo', async () => {
    behave = () => { throw Object.assign(new Error('connessione persa'), { code: 'ECONNRESET' }); };
    await expect(queryWebthronEvents(combos, [], week)).rejects.toThrow('connessione persa');
    expect(calls).toHaveLength(1);
  });
});

describe('schede modificate (lastup)', () => {
  const since      = new Date('2026-11-25T10:00:00Z');
  const datainFrom = new Date('2026-05-30T22:00:00Z');

  it('la query è limitata anche su datain (indice), non solo su lastup', async () => {
    await queryWebthronEvents(combos, [], { mode: 'modified', since, datainFrom });
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('ubi.lastup > ?');
    expect(sqls[0]).toContain('ubi.datain >= ?');
    expect(sqls[0]).toContain('LIMIT 40000');
    // i primi due parametri sono `since` e `datainFrom`, nell'ordine dei segnaposto
    expect(calls[0]).toEqual({ from: since, to: datainFrom });
  });

  it('incrementale (senza bulk): resta al limite di 15 s, nessun SET SESSION', async () => {
    await queryWebthronEvents(combos, [], { mode: 'modified', since, datainFrom });
    expect(setLog).toEqual([]);
  });

  it('carica notturna/pulsante (bulk): limite lungo e poi si torna a 15 s, anche se la query fallisce', async () => {
    await queryWebthronEvents(combos, [], { mode: 'modified', since, datainFrom, bulk: true });
    expect(setLog).toEqual(['SET SESSION max_statement_time = 30', 'SET SESSION max_statement_time = 15']);

    setLog.length = 0;
    behave = () => { throw Object.assign(new Error('timeout'), { errno: 1969 }); };
    await expect(queryWebthronEvents(combos, [], { mode: 'modified', since, datainFrom, bulk: true })).rejects.toThrow('timeout');
    expect(setLog.at(-1)).toBe('SET SESSION max_statement_time = 15');
  });
});
