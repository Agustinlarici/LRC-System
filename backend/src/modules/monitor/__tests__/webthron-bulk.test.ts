import { describe, it, expect, vi, beforeEach } from 'vitest';

// Senza pausa minima nella guardia: il test non deve aspettare tempo vero
vi.hoisted(() => { process.env.WEBTHRON_MIN_GAP_MS = '0'; });

vi.mock('../../../lib/system-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/system-flags.js')>()),
  getIKnowFlags: async () => ({ iknow_enabled: true }),
}));

type Params = unknown[];
const calls: Array<{ from: string; to: string }> = [];
let behave: (from: string, to: string) => Array<Record<string, unknown>> = () => [];

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: () => ({
      on: () => undefined,
      end: async () => undefined,
      execute: async (_q: unknown, params: Params) => {
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

beforeEach(() => { calls.length = 0; behave = () => []; });

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
