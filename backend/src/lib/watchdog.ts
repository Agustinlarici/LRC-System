/**
 * Watchdog — runs every 2 minutes.
 * 1. Calls checkSyncHealth() to raise/resolve alerts.
 * 2. If sync_incremental has missed 2+ cycles (>25 min), triggers auto-recovery.
 */

import { logger } from './logger.js';
import { getAllStats } from './sync-stats.js';
import { checkSyncHealth } from './alert-manager.js';
import { sendInfo } from './notifier.js';

let _executiveRefresh: (() => Promise<void>) | null = null;
let autoRecoveryCount = 0;

export function injectExecutiveRefresh(fn: () => Promise<void>): void {
  _executiveRefresh = fn;
}

export async function runWatchdog(): Promise<void> {
  try {
    await checkSyncHealth();

    // Auto-recovery: se sync è bloccato da >25 min, lo rilancia
    const inc = getAllStats()['sync_incremental'];
    if (inc && _executiveRefresh) {
      const lastMs       = inc.lastFinishedAt ? new Date(inc.lastFinishedAt).getTime() : 0;
      const minSinceLast = (Date.now() - lastMs) / 60_000;

      if (lastMs > 0 && minSinceLast > 25 && inc.status !== 'running') {
        autoRecoveryCount++;
        const msg = `Auto-recovery #${autoRecoveryCount}: sync WebThron bloccato da ${Math.round(minSinceLast)} min — riavvio in corso`;
        logger.warn(`[Watchdog] ${msg}`);
        await sendInfo(msg);
        _executiveRefresh().catch(e => logger.error(`[Watchdog] Auto-recovery fallito: ${e}`));
      }
    }
  } catch (e) {
    logger.error(`[Watchdog] Errore ciclo: ${e}`);
  }
}

export function startWatchdog(executiveRefresh: () => Promise<void>): void {
  injectExecutiveRefresh(executiveRefresh);
  setInterval(runWatchdog, 2 * 60_000);
  logger.info('[Watchdog] Avviato — controllo ogni 2 minuti');
}
