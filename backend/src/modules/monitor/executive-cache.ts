/**
 * Executive cache — reads from PostgreSQL (populated by pg-webthron-sync).
 * Zero direct WebThron queries at read time.
 */

import { logger } from '../../lib/logger.js';
import { syncWebthronToPostgres, getProdRowsFromPG, type ProdRow } from './pg-webthron-sync.js';

export type { ProdRow as ProductionRow };

export interface ExecutiveCacheData {
  rows:      ProdRow[];
  updatedAt: Date;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getDeliberaFasi(): string[] {
  return (process.env.DELIBERA_FASI ?? 'DELIBERA FINALE,DELIBERA FINALE PROX')
    .split(',').map(s => s.trim()).filter(Boolean);
}

export function isConforming(esito: string | null): boolean {
  if (!esito) return false;
  const okVals = (process.env.DELIBERA_ESITO_OK ?? 'OK')
    .split(',').map(s => s.trim().toUpperCase());
  const e = esito.toUpperCase();
  return okVals.some(v => e === v || e.startsWith(v));
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let cache: ExecutiveCacheData | null = null;

export function getExecutiveCache(): ExecutiveCacheData | null {
  return cache;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Incremental refresh (every 5 min):
 * 1. Fetches only NEW WebThron rows since last sync → ~2-3 sec WebThron lock
 * 2. Saves them to PostgreSQL
 * 3. Reads full day from PostgreSQL → updates in-memory cache
 */
export async function executiveRefresh(): Promise<void> {
  try {
    await syncWebthronToPostgres();
    const rows = await getProdRowsFromPG();
    cache = { rows, updatedAt: new Date() };
    logger.info(`[ExecutiveCache] Aggiornato — ${rows.length} righe da PostgreSQL`);
  } catch (err) {
    logger.error(`[ExecutiveCache] Errore refresh: ${err}`);
    // Keep stale cache on error
  }
}

/**
 * Initial load (at startup, delayed 2 min):
 * 1. Full day query to WebThron → saves to PostgreSQL (~60 sec lock, once/day)
 * 2. Reads from PostgreSQL → populates cache
 */
export async function startExecutiveCache(): Promise<void> {
  try {
    await syncWebthronToPostgres(true);   // fullLoad=true → fetches all of today
    const rows = await getProdRowsFromPG();
    cache = { rows, updatedAt: new Date() };
    logger.info(`[ExecutiveCache] Cache iniziale — ${rows.length} righe`);
  } catch (err) {
    logger.error(`[ExecutiveCache] Errore avvio: ${err}`);
  }
}
