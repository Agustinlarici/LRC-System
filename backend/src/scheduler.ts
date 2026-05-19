import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';
import { snapshotDayFromHistory } from './modules/dashboards/heatmap.js';
import { syncFullDayToHistory, refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { checkSpmaDelays } from './modules/spma/delay-checker.js';
import { sendDelayReport, spmaTokenConfigured } from './modules/spma/spma-notifier.js';
import { db } from './db/client.js';
import { startRun, endRun, failRun, setNextRun } from './lib/sync-stats.js';
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
  cron.schedule('0 1 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(yesterday);

    logger.info(`[scheduler] Rilettura completa WebThron per ${dateStr}...`);
    startRun('sync_full_day');
    try {
      await syncFullDayToHistory(dateStr);
    } catch (e) {
      failRun('sync_full_day', e);
      logger.error(`[scheduler] syncFullDayToHistory fallito: ${e instanceof Error ? e.message : e}`);
    }

    logger.info(`[scheduler] Snapshot OEE per ${dateStr}...`);
    startRun('heatmap_snapshot');
    try {
      await snapshotDayFromHistory(dateStr);
      endRun('heatmap_snapshot', 1);
      logger.info(`[scheduler] Snapshot OEE ${dateStr} completato`);
    } catch (e) {
      failRun('heatmap_snapshot', e);
      logger.error(`[scheduler] Snapshot OEE fallito: ${e instanceof Error ? e.message : e}`);
    }

    setNextRun('heatmap_snapshot', nextOccurrence(1));
  }, { timezone: 'Europe/Rome' });

  // 02:00 — aggiorna fasi e combos da WebThron → PG lookup tables
  // (startRun/endRun/failRun già gestiti internamente da refreshLookupTables)
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
    startRun('bc_sync');
    try {
      const r = await syncPackArticles();
      endRun('bc_sync', r.bc_total ?? 0);
      logger.info(`[scheduler] Sync done: inseriti=${r.inserted}, totale_bc=${r.bc_total}`);
    } catch (e) {
      failRun('bc_sync', e);
      logger.error(`[scheduler] Sync BC fallita: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('bc_sync', nextOccurrence(3));
  }, { timezone: 'Europe/Rome' });

  // Every 4h during working hours (06:00–18:00) — SPMA delay check
  cron.schedule('0 6,10,14,18 * * *', async () => {
    logger.info('[scheduler] SPMA delay check...');
    try {
      const results = await checkSpmaDelays();
      const delayed = results.filter(r => r.severity !== 'ok').length;
      logger.info(`[scheduler] SPMA delay check: ${results.length} piani, ${delayed} ritardi`);
      if (delayed > 0 && spmaTokenConfigured()) {
        const [cfg] = await db`SELECT telegram_chat_id FROM spma_alert_config WHERE id = 1`;
        const chatId = cfg?.telegram_chat_id ? String(cfg.telegram_chat_id) : '';
        await sendDelayReport(results, chatId);
      }
    } catch (e) {
      logger.error(`[scheduler] SPMA delay check fallito: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Registra prossime esecuzioni all'avvio
  setNextRun('heatmap_snapshot', nextOccurrence(1));
  setNextRun('lookup_refresh',   nextOccurrence(2));
  setNextRun('bc_sync',          nextOccurrence(3));

  logger.info('Scheduler avviato — snapshot OEE 01:00, lookup 02:00, sync BC 03:00, SPMA delay check ogni 4h 06-18 (Europe/Rome)');
}
