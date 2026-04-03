import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';
import { snapshotDay } from './modules/dashboards/heatmap.js';
import { logger } from './lib/logger.js';

export function startScheduler() {
  // Ogni giorno alle 03:00 ora di Roma (Europe/Rome)
  cron.schedule('0 3 * * *', async () => {
    logger.info('[scheduler] Sync BC → pack_article...');
    try {
      const r = await syncPackArticles();
      logger.info(`[scheduler] Sync done: inseriti=${r.inserted}, totale_bc=${r.bc_total}`);
    } catch (e) {
      logger.error(`[scheduler] Sync BC fallita: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Ogni giorno alle 01:00 ora di Roma — snapshot OEE di ieri per la heatmap mensile
  cron.schedule('0 1 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(yesterday);
    logger.info(`[scheduler] Snapshot OEE heatmap per ${dateStr}...`);
    try {
      await snapshotDay(dateStr);
      logger.info(`[scheduler] Snapshot heatmap ${dateStr} completato`);
    } catch (e) {
      logger.error(`[scheduler] Snapshot heatmap fallito: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  logger.info('Scheduler avviato — sync BC alle 03:00, snapshot OEE alle 01:00 (Europe/Rome)');
}
