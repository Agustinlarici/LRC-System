/**
 * Modalità della sincronizzazione WebThron (scelta in Sistema → Avanzata).
 *
 *  - incremental: solo i nuovi eventi, a ogni ciclo (come prima).
 *  - full:        carica gli ultimi 90 giorni, e quando finisce riparte; niente incrementale.
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

/**
 * Cosa fare a un ciclo del timer. `cycle` conta i cicli dall'avvio (parte da 1);
 * `cyclesPerFull` = ogni quanti cicli la modalità mista rilancia i 90 giorni (≈ 30 min).
 */
export function planTick(mode: SyncMode, cycle: number, cyclesPerFull: number, fullRunning: boolean): TickPlan {
  switch (mode) {
    case 'full':
      return { incremental: false, full: !fullRunning };
    case 'mixed':
      return { incremental: true, full: !fullRunning && cycle % Math.max(1, cyclesPerFull) === 0 };
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
