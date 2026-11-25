import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => { process.env.WEBTHRON_HOST = 'webthron.test'; });

const log: string[] = [];
let lastupOn = true;
let nuovi: Array<Record<string, unknown>> = [];

vi.mock('../../../lib/logger.js', () => ({ logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } }));
vi.mock('../../../lib/system-flags.js', () => ({
  isIKnowEnabled: async (k: string) => (k === 'iknow_andon_lastup_enabled' ? lastupOn : true),
}));
vi.mock('../mysql-client.js', () => ({
  BULK_SLICE_HOURS: 168,
  getWebthronPool: () => ({}),
  queryWebthronEvents: async (_c: unknown, _f: unknown, filter: { mode: string }) => {
    if (filter.mode === 'modified') { log.push('lettura-lastup'); throw new Error('Query execution was interrupted (max_statement_time exceeded)'); }
    log.push('lettura-nuovi');
    return nuovi;
  },
}));
vi.mock('../../../db/client.js', () => ({
  db: (strings: unknown, ..._v: unknown[]) => {
    if (!Array.isArray(strings) || !('raw' in strings)) return { records: strings };   // db(records)
    const sql = (strings as string[]).join('?');
    if (sql.includes('iknow_tracked_fasi'))            return [{ fase: 'F', modello: 'M', componente: 'C' }];
    if (sql.includes('MAX(data_inserimento)'))         return [{ ultimo: null }];
    if (sql.includes('INSERT INTO webthron_events_history')) { log.push('insert'); return Object.assign([], { count: nuovi.length }); }
    if (sql.includes('WITH esiste'))                   { log.push('sostituzione'); return [{ trovate: 1, cambiate: 0 }]; }
    return [];
  },
}));

const evento = (id: number) => ({
  fase: 'F', modello: 'M', componente: 'C', cod_seriale: `S${id}`, commessa: null, esito_delibera: null,
  data_inserimento: new Date(), versione: null, operatore: null, colore: null, protocollo_cesta: null,
});

// Modulo nuovo a ogni test: lo stato interno (ultimo evento visto, fascia notturna) non si trascina.
// sync-stats si importa dopo il reset, così è la stessa istanza usata da pg-webthron-sync.
async function sync() {
  vi.resetModules();
  const { syncWebthronToPostgres } = await import('../pg-webthron-sync.js');
  const { getAllStats } = await import('../../../lib/sync-stats.js');
  await syncWebthronToPostgres();
  return getAllStats();
}

beforeEach(() => { log.length = 0; lastupOn = true; nuovi = [evento(1), evento(2)]; });

describe('incrementale con lastup che fallisce', () => {
  it('gli eventi nuovi entrano comunque, e prima della passata lastup', async () => {
    const stats = await sync();   // non lancia
    expect(log).toEqual(['lettura-nuovi', 'insert', 'lettura-lastup']);
    const s = stats['sync_lastup'];
    expect(s.status).toBe('error');
    expect(s.lastError).toContain('max_statement_time');
  });

  it('il job dell\'incrementale resta ok: l\'errore è solo di sync_lastup', async () => {
    const stats = await sync();
    const inc = stats['sync_full'] ?? stats['sync_incremental'];
    expect(inc.status).toBe('ok');
    expect(inc.lastRowCount).toBe(2);
  });

  it('senza eventi nuovi la passata lastup viene tentata e l\'errore non esce', async () => {
    nuovi = [];
    await sync();   // non lancia
    expect(log).toEqual(['lettura-nuovi', 'lettura-lastup']);
  });

  it('con il flag spento la passata lastup non parte', async () => {
    lastupOn = false;
    await sync();
    expect(log).toEqual(['lettura-nuovi', 'insert']);
  });
});
