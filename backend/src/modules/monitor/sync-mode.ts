/**
 * Modalità della sincronizzazione WebThron (scelta in Sistema → Avanzata).
 *
 *  - incremental: solo i nuovi eventi, a ogni ciclo (come prima).
 *  - full:        carica gli ultimi 90 giorni ogni ~10 minuti (se la precedente gira ancora, salta); niente incrementale.
 *  - mixed:       incrementale a ogni ciclo + ogni ~30 minuti la carica dei 90 giorni.
 *
 * La carica dei 90 giorni è la stessa del pulsante «Carica storico» (first-sync.ts), quindi
 * richiede il toggle «Backfill manuali» e non parte mai due volte insieme.
 * Il modo è salvato in system_config (nessuna migrazione: la tabella esiste già).
 */

import { db } from '../../db/client.js';

export const SYNC_MODES = ['incremental', 'full', 'mixed'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export const SYNC_MODE_KEY = 'webthron_sync_mode';
export const FULL_SYNC_DAYS = 90;
export const FULL_SYNC_PAUSE_SEC = 3;

export function isSyncMode(v: unknown): v is SyncMode {
  return typeof v === 'string' && (SYNC_MODES as readonly string[]).includes(v);
}

export interface TickPlan {
  incremental: boolean;
  full:        boolean;
}

/** Ogni quanti secondi si rilancia la carica dei 90 giorni, per modo. */
export const FULL_EVERY_SEC  = 10 * 60;
export const MIXED_EVERY_SEC = 30 * 60;

/** Cicli del timer (uno ogni `syncSeconds`) tra una carica e la successiva. Almeno 1. */
export function cyclesFor(everySec: number, syncSeconds: number): number {
  return Math.max(1, Math.round(everySec / Math.max(1, syncSeconds)));
}

/**
 * Cosa fare a un ciclo del timer. `cycle` conta i cicli dall'avvio (parte da 1);
 * `syncSeconds` = durata di un ciclo. La carica dei 90 giorni parte ogni 10 min (full)
 * o ogni 30 min (mixed), e mai se la precedente è ancora in corso.
 */
export function planTick(mode: SyncMode, cycle: number, syncSeconds: number, fullRunning: boolean): TickPlan {
  switch (mode) {
    case 'full':
      return { incremental: false, full: !fullRunning && cycle % cyclesFor(FULL_EVERY_SEC, syncSeconds) === 0 };
    case 'mixed':
      return { incremental: true, full: !fullRunning && cycle % cyclesFor(MIXED_EVERY_SEC, syncSeconds) === 0 };
    default:
      return { incremental: true, full: false };
  }
}

export async function getSyncMode(): Promise<SyncMode> {
  try {
    const [row] = await db`SELECT value FROM system_config WHERE key = ${SYNC_MODE_KEY}`;
    return isSyncMode(row?.value) ? row.value : 'incremental';
  } catch {
    return 'incremental';
  }
}

export async function setSyncMode(mode: SyncMode): Promise<SyncMode> {
  await db`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (${SYNC_MODE_KEY}, ${mode}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return mode;
}
