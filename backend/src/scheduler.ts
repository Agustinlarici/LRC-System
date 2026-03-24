import cron from 'node-cron';
import { syncPackArticles } from './modules/packing/bc-client.js';

export function startScheduler() {
  // Ogni giorno alle 03:00 ora di Roma (Europe/Rome)
  cron.schedule('0 3 * * *', async () => {
    console.log('⏰ [scheduler] Sync BC → pack_article...');
    try {
      const r = await syncPackArticles();
      console.log(`✅ [scheduler] Sync done: inseriti=${r.inserted}, totale_bc=${r.bc_total}`);
    } catch (e) {
      console.error('❌ [scheduler] Sync BC fallita:', e instanceof Error ? e.message : e);
    }
  }, { timezone: 'Europe/Rome' });

  console.log('⏱️  Scheduler avviato — sync BC ogni giorno alle 03:00 (Europe/Rome)');
}
