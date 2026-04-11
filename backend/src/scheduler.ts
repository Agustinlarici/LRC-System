import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';
import { snapshotDayFromHistory } from './modules/dashboards/heatmap.js';
import { syncFullDayToHistory, refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { setNextRun } from './lib/sync-stats.js';
import { logger } from './lib/logger.js';

function nextOccurrence(hour: number, minute = 0): Date {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function startScheduler() {
  // 01:00 — rilettura completa WebThron di ieri + snapshot OEE
  //
  // Flusso:
  //   1. Legge TUTTI gli eventi di ieri da WebThron → upsert in webthron_events_history
  //      (cattura correzioni, ritardi o dati arrivati dopo il sync incrementale)
  //   2. Calcola OEE da history (già aggiornata) → monitor_oee_daily / monitor_oee_hourly
  //
  // Così se WebThron corregge un dato durante la notte, il giorno dopo è già corretto
  // anche nei dashboard storici.
  cron.schedule('0 1 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(yesterday);

    logger.info(`[scheduler] Rilettura completa WebThron per ${dateStr}...`);
    try {
      await syncFullDayToHistory(dateStr);
    } catch (e) {
      logger.error(`[scheduler] syncFullDayToHistory fallito: ${e instanceof Error ? e.message : e}`);
      // Continua comunque con il snapshot — meglio dati parziali che nessun dato
    }

    logger.info(`[scheduler] Snapshot OEE per ${dateStr}...`);
    try {
      await snapshotDayFromHistory(dateStr);
      logger.info(`[scheduler] Snapshot OEE ${dateStr} completato`);
    } catch (e) {
      logger.error(`[scheduler] Snapshot OEE fallito: ${e instanceof Error ? e.message : e}`);
    }

    setNextRun('heatmap_snapshot', nextOccurrence(1));
  }, { timezone: 'Europe/Rome' });

  // 02:00 — aggiorna fasi e combos da WebThron → PG lookup tables
  cron.schedule('0 2 * * *', async () => {
    logger.info('[scheduler] Refresh lookup tables WebThron...');
    try {
      await refreshLookupTables();
      logger.info('[scheduler] Lookup tables aggiornate');
    } catch (e) {
      logger.error(`[scheduler] Lookup refresh fallito: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('lookup_refresh', nextOccurrence(2));
  }, { timezone: 'Europe/Rome' });

  // 03:00 — sync articoli Business Central → packing
  cron.schedule('0 3 * * *', async () => {
    logger.info('[scheduler] Sync BC → pack_article...');
    try {
      const r = await syncPackArticles();
      logger.info(`[scheduler] Sync done: inseriti=${r.inserted}, totale_bc=${r.bc_total}`);
    } catch (e) {
      logger.error(`[scheduler] Sync BC fallita: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('bc_sync', nextOccurrence(3));
  }, { timezone: 'Europe/Rome' });

  // Registra prossime esecuzioni all'avvio
  setNextRun('heatmap_snapshot', nextOccurrence(1));
  setNextRun('lookup_refresh',   nextOccurrence(2));
  setNextRun('bc_sync',          nextOccurrence(3));

  logger.info('Scheduler avviato — snapshot OEE 01:00, lookup 02:00, sync BC 03:00 (Europe/Rome)');
}
