/**
 * Modalità della sincronizzazione WebThron (scelta in Sistema → Avanzata).
 *
 *  - incremental: solo i nuovi eventi, a ogni ciclo; i 180 giorni (6 mesi) li rilegge la sera (11:30 e 01:00, scheduler.ts).
 *  - full:        carica gli ultimi 90 giorni ogni ~10 minuti (se la precedente gira ancora, salta); niente incrementale.
 *  - mixed:       incrementale a ogni ciclo + ogni ora la carica dei 90 giorni;
 *                 l'incrementale resta fermo finché la carica non è finita.
 *
 * La carica dei 90 giorni è la stessa del pulsante «Carica storico» (first-sync.ts), quindi
 * richiede il toggle «Backfill manuali» e non parte mai due volte insieme.
 * Il modo è salvato in system_config (nessuna migrazione: la tabella esiste già).
 */

import { db } from '../../db/client.js';
import { getAllStats } from '../../lib/sync-stats.js';

export const SYNC_MODES = ['incremental', 'full', 'mixed'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export const SYNC_MODE_KEY = 'webthron_sync_mode';
export const FULL_SYNC_DAYS = 90;
/** Giorni della rilettura notturna (11:30 e 01:00, solo modo incrementale) e del pulsante «Carica storico»: 6 mesi. */
export const BACKFILL_DAYS = 180;
export const FULL_SYNC_PAUSE_SEC = 2;

export function isSyncMode(v: unknown): v is SyncMode {
  return typeof v === 'string' && (SYNC_MODES as readonly string[]).includes(v);
}

export interface TickPlan {
  incremental: boolean;
  full:        boolean;
}

/** Ogni quanti secondi si rilancia la carica dei 90 giorni, per modo. */
export const FULL_EVERY_SEC  = 10 * 60;
export const MIXED_EVERY_SEC = 60 * 60;

/** Cicli del timer (uno ogni `syncSeconds`) tra una carica e la successiva. Almeno 1. */
export function cyclesFor(everySec: number, syncSeconds: number): number {
  return Math.max(1, Math.round(everySec / Math.max(1, syncSeconds)));
}

/**
 * Cosa fare a un ciclo del timer. `cycle` conta i cicli dall'avvio (parte da 1);
 * `syncSeconds` = durata di un ciclo. La carica dei 90 giorni parte ogni 10 min (full)
 * o ogni ora (mixed), e mai se la precedente è ancora in corso.
 */
export function planTick(mode: SyncMode, cycle: number, syncSeconds: number, fullRunning: boolean): TickPlan {
  switch (mode) {
    case 'full':
      return { incremental: false, full: !fullRunning && cycle % cyclesFor(FULL_EVERY_SEC, syncSeconds) === 0 };
    case 'mixed': {
      const full = !fullRunning && cycle % cyclesFor(MIXED_EVERY_SEC, syncSeconds) === 0;
      // Finché la carica gira (o parte proprio ora) l'incrementale aspetta
      return { incremental: !fullRunning && !full, full };
    }
    default:
      return { incremental: true, full: false };
  }
}

/**
 * True se l'incrementale è spento di proposito in questo momento: modo «full», oppure modo
 * «mixed» con la carica in corso. Watchdog e allarmi non devono considerarlo bloccato né rilanciarlo.
 */
export async function incrementalIsPaused(): Promise<boolean> {
  const mode = await getSyncMode();
  if (mode === 'full') return true;
  return mode === 'mixed' && getAllStats()['first_sync']?.status === 'running';
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
