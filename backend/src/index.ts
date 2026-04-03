import { serve } from '@hono/node-server';
import app from './app.js';
import { startScheduler } from './scheduler.js';
import { startBufferCache, bufferFullRefresh } from './modules/buffer/cache.js';
import { startExecutiveCache, executiveRefresh } from './modules/monitor/executive-cache.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';

const port = parseInt(process.env.PORT || '3001', 10);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Closes MySQL pool cleanly on container stop so connections aren't left orphaned

async function shutdown() {
  logger.info('Shutting down — closing MySQL pool...');
  try {
    const { getWebthronPool, resetWebthronPool } = await import('./modules/monitor/mysql-client.js');
    await getWebthronPool().end();
    resetWebthronPool();
    logger.info('MySQL pool closed.');
  } catch { /* pool may not have been initialized */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// ─── Server ───────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port }, async (info) => {
  logger.info(`LRC-System backend running on http://localhost:${info.port}`);
  startScheduler();

  // ─── Scheduler WebThron unificato ───────────────────────────────────────────
  // Un solo timer ogni 5 min — executive sempre, buffer ogni 6° ciclo (30 min).
  // Le due query sono sequenziali: mai in parallelo, mai si sovrappongono.
  // Startup ritardato di 2 min per non bloccare WebThron all'avvio.
  setTimeout(async () => {
    // Ensure the webthron cache table exists (idempotent)
    await db`
      CREATE TABLE IF NOT EXISTS webthron_prod_cache (
        id               SERIAL       PRIMARY KEY,
        fase             VARCHAR(200) NOT NULL,
        modello          VARCHAR(200) NOT NULL,
        componente       VARCHAR(200) NOT NULL,
        cod_seriale      VARCHAR(200) NOT NULL,
        esito_delibera   VARCHAR(200),
        data_inserimento TIMESTAMPTZ  NOT NULL,
        data_cache       DATE         NOT NULL
      )
    `.catch(() => {});
    await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_wpc_dedup ON webthron_prod_cache (fase, cod_seriale, data_inserimento)`.catch(() => {});
    await db`CREATE INDEX IF NOT EXISTS idx_wpc_data_cache ON webthron_prod_cache (data_cache)`.catch(() => {});
    await db`CREATE INDEX IF NOT EXISTS idx_wpc_fase_combo ON webthron_prod_cache (fase, modello, componente)`.catch(() => {});

    // Full load: fetches all of today from WebThron → saves to PostgreSQL
    // This is the only long WebThron query (~60 sec), runs once per day at startup
    logger.info('[Startup] Caricamento completo WebThron → PostgreSQL...');
    await startExecutiveCache();

    // Buffer cache: parte 10 min dopo l'executive per non bloccare WebThron back-to-back
    setTimeout(async () => {
      logger.info('[Startup] Caricamento buffer cache...');
      await startBufferCache();
    }, 10 * 60_000);

    let cycle = 0;
    setInterval(async () => {
      cycle++;
      // Incremental sync: only new rows since last fetch → ~2-3 sec WebThron lock
      await executiveRefresh();
      // Buffer: every 30 min (6 × 5 min), sequential after executive
      if (cycle % 6 === 0) await bufferFullRefresh();
    }, 5 * 60_000);

    logger.info('[Startup] Scheduler avviato — executive 5 min (incrementale), buffer 30 min');
  }, 2 * 60_000);

  logger.info('Server pronto — WebThron caricherà tra 2 minuti (una volta al giorno)');
});
