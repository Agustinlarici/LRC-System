import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';
import { snapshotDayFromHistory } from './modules/dashboards/heatmap.js';
import { refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { syncBom } from './modules/monitor/bom-sync.js';
import { daysToReread } from './modules/monitor/webthron-time.js';
import { getSyncMode, BACKFILL_DAYS, FULL_SYNC_PAUSE_SEC } from './modules/monitor/sync-mode.js';
import { startFirstSync, getFirstSyncStatus, waitForFirstSync } from './modules/monitor/first-sync.js';
import { isIKnowEnabled } from './lib/system-flags.js';
import { checkSpmaDelays } from './modules/spma/delay-checker.js';
import { sendDelayReportEmail, emailConfigured, type SmtpConfig } from './modules/spma/spma-email-notifier.js';
import { autoGenerateEdi } from './modules/edi/auto-generate.js';
import { syncFerrariDelins } from './modules/edi/ferrari-delins-sync.js';
import { detectStopsAllLines } from './modules/monitor/stop-detector.js';
import { applyDefaultsForDate } from './modules/monitor/auto-turni.js';
import { db } from './db/client.js';
import { startRun, endRun, failRun, setNextRun } from './lib/sync-stats.js';
import { logger } from './lib/logger.js';
import { recepcionesEmitter } from './gateway/recepciones-emitter.js';
import { letturaNotturna } from './modules/ferrari/cartella.js';
import { pollOneDriveFolder } from './modules/spma/onedrive-watcher.js';
import { sincronizza as sincronizzaFatturazione } from './modules/fatturazione/sync.js';
import { runOstiSync } from './modules/hr/osti-sync.js';
import { cessaScaduti } from './modules/hr/employee-update.js';
import { runPhotoFeed } from './modules/quality-control-station/feed.js';

function nextEvery10Min(): Date {
  const now = new Date();
  const secsLeft = (10 - (now.getMinutes() % 10)) * 60 - now.getSeconds();
  return new Date(now.getTime() + secsLeft * 1000);
}

function nextHourAt(minute: number): Date {
  const next = new Date();
  next.setMinutes(minute, 0, 0);
  if (next <= new Date()) next.setHours(next.getHours() + 1);
  return next;
}

function nextOccurrence(hour: number, minute = 0): Date {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function startScheduler() {
  const todayRome = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

  // 00:05 — applica turni standard per oggi alle linee senza dati salvati
  cron.schedule('5 0 * * *', async () => {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
    logger.info(`[scheduler] Auto-turni standard per ${dateStr}...`);
    try {
      const n = await applyDefaultsForDate(dateStr);
      logger.info(`[scheduler] Auto-turni: ${n} linee aggiornate`);
    } catch (e) {
      logger.error(`[scheduler] Auto-turni fallito: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // 01:00 — in modo «incrementale» si rileggono gli ultimi 180 giorni (una query per settimana,
  // stessa carica del pulsante). Nei modi «full» e «mista» la rilettura la fanno già loro ogni 10 min / ogni ora:
  // qui si aspetta solo che quella in corso finisca. Richiede il toggle «Rilettura notturna».
  async function rileggiStorico(): Promise<void> {
    const mode = await getSyncMode();
    if (mode === 'incremental' && !getFirstSyncStatus().running) {
      if (!(await isIKnowEnabled('iknow_nightly_enabled'))) {
        logger.debug('[scheduler] Rilettura 180 giorni disabilitata — skip');
        return;
      }
      logger.info('[scheduler] Rilettura WebThron degli ultimi 180 giorni...');
      startRun('sync_full_day');
      try {
        startFirstSync({ days: BACKFILL_DAYS, pauseSec: FULL_SYNC_PAUSE_SEC, flag: 'iknow_nightly_enabled' });
        await waitForFirstSync();
        const st = getFirstSyncStatus();
        if (st.errors.length > 0 && st.errors.length >= st.done) failRun('sync_full_day', new Error(st.errors[st.errors.length - 1]));
        else endRun('sync_full_day', st.rows);
      } catch (e) {
        failRun('sync_full_day', e);
        logger.error(`[scheduler] Rilettura 180 giorni fallita: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    await waitForFirstSync();
  }

  // 01:00 — rilettura dei 180 giorni + snapshot OEE di ieri (aspetta che la lettura sia finita)
  cron.schedule('0 1 * * *', async () => {
    const dateStr = daysToReread(todayRome(), 1, false)[0];   // ieri
    await rileggiStorico();

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
      const result = await pollOneDriveFolder();
      endRun('spma_onedrive_poll', result.count);
    } catch (e) {
      failRun('spma_onedrive_poll', e);
      logger.error(`[scheduler] SPMA OneDrive poll fallito: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('spma_onedrive_poll', nextEvery10Min());
  }, { timezone: 'Europe/Rome' });

  // Every minute — Quality Control Station: ordini di foto dalla copia del DB di iKnow (spento finché non lo si accende)
  cron.schedule('* * * * *', async () => {
    try { await runPhotoFeed(); } catch { /* runPhotoFeed registra già i suoi errori */ }
  }, { timezone: 'Europe/Rome' });

  // Every minute — rilevamento automatico fermate di linea
  cron.schedule('* * * * *', async () => {
    try { await detectStopsAllLines(); } catch { /* silenzioso */ }
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

  // Ogni ora (al minuto 20) — schede produzione: legge la cartella degli Excel se e' attivo e se e' l'ora scelta nelle Impostazioni
  cron.schedule('20 * * * *', async () => {
    const ora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    try {
      await letturaNotturna(ora);
    } catch (e) {
      logger.error(`[scheduler] Lettura cartella schede fallita: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Ogni ora (minuto 40) — Fatturazione: copia da BC delle righe di spedizione dei conti configurati
  cron.schedule('40 * * * *', async () => {
    startRun('fatturazione_sync');
    try {
      const n = await sincronizzaFatturazione();
      if (n >= 0) endRun('fatturazione_sync', n); else endRun('fatturazione_sync', 0);
    } catch (e) {
      failRun('fatturazione_sync', e);
      logger.error(`[scheduler] Fatturazione sync fallita: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // Ogni ora (minuto 50) — HR: sincronizza le schede dipendenti con Osti (sola lettura su Osti; vedi hr/osti-sync.ts)
  cron.schedule('50 * * * *', async () => {
    if (!process.env.OSTI_HOST || !process.env.OSTI_USER) return;   // Osti non configurato: niente da fare
    startRun('osti_sync');
    try {
      const r = await runOstiSync();
      if (r.errors > 0 && r.updated === 0) failRun('osti_sync', new Error(r.detail)); else endRun('osti_sync', r.updated, r.detail);
      logger.info(`[scheduler] Sync Osti: ${r.detail}`);
    } catch (e) {
      failRun('osti_sync', e);
      logger.error(`[scheduler] Sync Osti fallita: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('osti_sync', nextHourAt(50));
  }, { timezone: 'Europe/Rome' });

  // Ogni ora (minuto 55, subito dopo il sync Osti che toglie le date vecchie ai contratti rinnovati) — HR: chi ha la
  // data di cessazione già trascorsa passa a «cessato»
  cron.schedule('55 * * * *', async () => {
    startRun('hr_cessazioni');
    try {
      const n = await cessaScaduti();
      endRun('hr_cessazioni', n);
      if (n) logger.info(`[scheduler] HR: ${n} dipendenti passati a cessato (data di cessazione trascorsa)`);
    } catch (e) {
      failRun('hr_cessazioni', e);
      logger.error(`[scheduler] HR cessazioni automatiche fallite: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('hr_cessazioni', nextHourAt(55));
  }, { timezone: 'Europe/Rome' });

  // 06:00 — scansione Ferrari DELINS inbox → aggiorna edi_ferrari_delins
  cron.schedule('0 6 * * *', async () => {
    logger.info('[scheduler] EDI Ferrari DELINS sync...');
    startRun('edi_ferrari_scan');
    try {
      const stats = await syncFerrariDelins();
      endRun('edi_ferrari_scan', stats.rows);
      logger.info(`[scheduler] EDI Ferrari DELINS: ${stats.rows} righe, ${stats.files_processed} file, ${stats.files_skipped} saltati`);
      if (stats.errors.length > 0) {
        logger.warn(`[scheduler] EDI Ferrari DELINS: ${stats.errors.length} errori file`);
      }
    } catch (e) {
      failRun('edi_ferrari_scan', e);
      logger.error(`[scheduler] EDI Ferrari DELINS fallito: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('edi_ferrari_scan', nextOccurrence(6));
  }, { timezone: 'Europe/Rome' });

  // 04:15 — copia dei BOM di iKnow → webthron_bom (una volta a notte, a piccoli passi; vedi bom-sync.ts)
  cron.schedule('15 4 * * *', async () => {
    logger.info('[scheduler] Sync BOM iKnow...');
    try {
      await syncBom();
    } catch (e) {
      logger.error(`[scheduler] Sync BOM fallita: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('bom_sync', nextOccurrence(4, 15));
  }, { timezone: 'Europe/Rome' });

  // 03:30 — pulizia analytics di utilizzo: le visite pagina si tengono 180 giorni
  cron.schedule('30 3 * * *', async () => {
    try {
      const r = await db`DELETE FROM page_views WHERE created_at < now() - interval '180 days'`;
      logger.info(`[scheduler] page_views: ${r.count} righe vecchie rimosse`);
    } catch (e) {
      logger.error(`[scheduler] Pulizia page_views fallita: ${e instanceof Error ? e.message : e}`);
    }
  }, { timezone: 'Europe/Rome' });

  // 23:45 — generazione automatica EDI per i clienti con auto_generate = true
  cron.schedule('45 23 * * *', async () => {
    logger.info('[scheduler] EDI auto-generate...');
    startRun('edi_auto_generate');
    try {
      const { generated } = await autoGenerateEdi();
      endRun('edi_auto_generate', generated);
    } catch (e) {
      failRun('edi_auto_generate', e);
      logger.error(`[scheduler] EDI auto-generate fallito: ${e instanceof Error ? e.message : e}`);
    }
    setNextRun('edi_auto_generate', nextOccurrence(23, 45));
  }, { timezone: 'Europe/Rome' });

  // Registra prossime esecuzioni all'avvio
  setNextRun('edi_ferrari_scan',   nextOccurrence(6));
  setNextRun('heatmap_snapshot',   nextOccurrence(1));
  setNextRun('lookup_refresh',     nextOccurrence(2));
  setNextRun('bc_sync',            nextOccurrence(3));
  setNextRun('bom_sync',           nextOccurrence(4, 15));
  setNextRun('spma_onedrive_poll', nextEvery10Min());
  setNextRun('edi_auto_generate',  nextOccurrence(23, 45));

  logger.info('Scheduler avviato — Ferrari DELINS 06:00, EDI auto 23:45, rilettura WebThron 01:00 (180 giorni), snapshot OEE 01:00, lookup 02:00, sync BC 03:00, SPMA delay check ogni 4h 06-18, OneDrive poll ogni 10 min, promemoria DDT ogni 5 min (Europe/Rome)');
}
