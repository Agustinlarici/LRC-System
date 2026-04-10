import { serve } from '@hono/node-server';
import app from './app.js';
import { startScheduler } from './scheduler.js';
import { startBufferCache, bufferFullRefresh } from './modules/buffer/cache.js';
import { startExecutiveCache, executiveRefresh } from './modules/monitor/executive-cache.js';
import { refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { setNextRun } from './lib/sync-stats.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';

const port = parseInt(process.env.PORT || '3001', 10);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

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

  // ─── Startup ritardato di 2 min — non blocca WebThron all'avvio ──────────────
  setTimeout(async () => {

    // 1. Migrazione: converte webthron_prod_cache in VIEW, crea lookup tables
    logger.info('[Startup] Migrazione unified-sync...');
    await db`DROP TABLE IF EXISTS webthron_prod_cache CASCADE`.catch(() => {});
    await db`
      CREATE OR REPLACE VIEW webthron_prod_cache AS
        SELECT id, fase, modello, componente, cod_seriale, commessa,
               esito_delibera, data_inserimento, data_cache
        FROM webthron_events_history
        WHERE data_cache = CURRENT_DATE
    `.catch((e: unknown) => logger.warn(`[Startup] View creation: ${e}`));
    await db`
      CREATE TABLE IF NOT EXISTS webthron_lookup_fasi (
        fase       VARCHAR(200) PRIMARY KEY,
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `.catch(() => {});
    await db`
      CREATE TABLE IF NOT EXISTS webthron_lookup_combos (
        modello    VARCHAR(200) NOT NULL,
        componente VARCHAR(200) NOT NULL,
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (modello, componente)
      )
    `.catch(() => {});

    // 2. Popola cache executive da PostgreSQL (zero WebThron — usa history già salvata)
    logger.info('[Startup] Cache executive da PostgreSQL...');
    await startExecutiveCache();

    // 3. Buffer cache da PostgreSQL (zero WebThron)
    logger.info('[Startup] Buffer cache da PostgreSQL...');
    await startBufferCache();
    setNextRun('buffer_refresh', new Date(Date.now() + 15 * 60_000));

    // 4. Lookup tables: refresh se vuote.
    //    Gira DOPO executive + buffer (sequential) e solo se necessario.
    //    Non blocca il resto — se fallisce lo scheduler ci riprova alle 02:00.
    const [{ count }] = await db`SELECT COUNT(*) AS count FROM webthron_lookup_fasi`;
    if (Number(count) === 0) {
      logger.info('[Startup] Lookup tables vuote — refresh iniziale (bassa priorità)...');
      refreshLookupTables().catch(e => logger.warn(`[Startup] Lookup refresh: ${e}`));
      // Non awaited: gira in background, non blocca il timer principale
    }

    // 5. Primo sync WebThron: parte dopo 10 minuti dall'avvio.
    //    Se LRC parte a un orario di produzione intensa, il primo sync
    //    arriva 10 min dopo, non immediatamente.
    setNextRun('sync_incremental', new Date(Date.now() + 10 * 60_000));

    let cycle = 0;
    setInterval(async () => {
      cycle++;
      // Sync incrementale: usa indice su datain → ~2-5 sec WebThron
      await executiveRefresh();
      setNextRun('sync_incremental', new Date(Date.now() + 10 * 60_000));

      // Buffer ogni 30 min (ogni 3° ciclo) — legge solo da PG, < 100ms
      if (cycle % 3 === 0) {
        await bufferFullRefresh();
        setNextRun('buffer_refresh', new Date(Date.now() + 30 * 60_000));
      }
    }, 10 * 60_000);

    logger.info('[Startup] Scheduler avviato — sync WebThron tra 10 min, poi ogni 10 min');
  }, 2 * 60_000);

  logger.info('Server pronto — WebThron caricherà tra 2 minuti');
});
