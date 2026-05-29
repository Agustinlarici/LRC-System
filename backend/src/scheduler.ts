import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';
import { snapshotDayFromHistory } from './modules/dashboards/heatmap.js';
import { syncFullDayToHistory, refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { checkSpmaDelays } from './modules/spma/delay-checker.js';
import { sendDelayReportEmail, emailConfigured, type SmtpConfig } from './modules/spma/spma-email-notifier.js';
import { db } from './db/client.js';
import { startRun, endRun, failRun, setNextRun } from './lib/sync-stats.js';
import { logger } from './lib/logger.js';
import { recepcionesEmitter } from './gateway/recepciones-emitter.js';
import { pollOneDriveFolder } from './modules/spma/onedrive-watcher.js';

function nextEvery10Min(): Date {
  const now = new Date();
  const secsLeft = (10 - (now.getMinutes() % 10)) * 60 - now.getSeconds();
  return new Date(now.getTime() + secsLeft * 1000);
}

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
      if (delayed > 0) {
        const [row] = await db`SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, smtp_to FROM spma_alert_config WHERE id = 1`;
        if (row && emailConfigured(row as Partial<SmtpConfig>)) {
          const cfg: SmtpConfig = {
            smtp_host:   String(row.smtp_host),
            smtp_port:   Number(row.smtp_port ?? 587),
            smtp_secure: Boolean(row.smtp_secure),
            smtp_user:   String(row.smtp_user),
            smtp_pass:   String(row.smtp_pass),
            smtp_from:   row.smtp_from ? String(row.smtp_from) : String(row.smtp_user),
            smtp_to:     String(row.smtp_to),
          };
          await sendDelayReportEmail(results, cfg);
        }
      }
    } catch (e) {
      logger.error(`[scheduler] SPMA delay check fallito: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Every 10 min — poll OneDrive folder for new SPMA Excel files
  cron.schedule('*/10 * * * *', async () => {
    startRun('spma_onedrive_poll');
    try {
      const count = await pollOneDriveFolder();
      endRun('spma_onedrive_poll', count);
    } catch (e) {
      failRun('spma_onedrive_poll', e);
      logger.error(`[scheduler] SPMA OneDrive poll fallito: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('spma_onedrive_poll', nextEvery10Min());
  }, { timezone: 'Europe/Rome' });

  // Every 5 min — promemoria ricezioni DDT in revisione da più di 30 min
  cron.schedule('*/5 * * * *', async () => {
    try {
      const rows = await db`
        SELECT COUNT(*) AS cnt
        FROM recepciones
        WHERE estado = 'revision_manual'
          AND creado_at < NOW() - INTERVAL '30 minutes'
      `;
      const count = Number(rows[0]?.cnt ?? 0);
      if (count > 0) {
        recepcionesEmitter.emit('evento', { tipo: 'recordatorio', count });
        logger.info(`[recepciones] Promemoria: ${count} DDT in attesa da >30 min`);
      }
    } catch (e) {
      logger.error(`[recepciones] Promemoria fallito: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Registra prossime esecuzioni all'avvio
  setNextRun('heatmap_snapshot',   nextOccurrence(1));
  setNextRun('lookup_refresh',     nextOccurrence(2));
  setNextRun('bc_sync',            nextOccurrence(3));
  setNextRun('spma_onedrive_poll', nextEvery10Min());

  logger.info('Scheduler avviato — snapshot OEE 01:00, lookup 02:00, sync BC 03:00, SPMA delay check ogni 4h 06-18, OneDrive poll ogni 10 min, promemoria DDT ogni 5 min (Europe/Rome)');
}
