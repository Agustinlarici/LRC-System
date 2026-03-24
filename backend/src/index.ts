import { serve } from '@hono/node-server';
import app from './app.js';
import { startScheduler } from './scheduler.js';
import { startWebthronCache, webthronIncrementalRefresh, webthronFullRefresh } from './modules/monitor/webthron-cache.js';
import { startBufferCache, bufferFullRefresh } from './modules/buffer/cache.js';

const port = parseInt(process.env.PORT || '3001', 10);

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`🚀 LRC-System backend running on http://localhost:${info.port}`);
  startScheduler();

  // Avvia entrambe le cache (solo il primo refresh sincrono)
  await Promise.all([startWebthronCache(), startBufferCache()]);

  // WebThron (Andon): incrementale ogni 60s, full ogni ora
  let webthronTick = 0;
  setInterval(async () => {
    webthronTick++;
    await webthronIncrementalRefresh();
    if (webthronTick % 60 === 0) await webthronFullRefresh();
  }, 60_000);

  // Buffer: full refresh ogni 30 minuti (query pesante ~6s)
  setInterval(bufferFullRefresh, 30 * 60_000);

  console.log('⏱️  Cache timer avviato — Andon ogni 60s, Buffer ogni 30min');
});
