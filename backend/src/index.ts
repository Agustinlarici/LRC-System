import { serve } from '@hono/node-server';
import app from './app.js';
import { startScheduler } from './scheduler.js';
import { startWatcher } from './watcher/watcher.service.js';
import { startBufferCache, bufferFullRefresh } from './modules/buffer/cache.js';
import { startExecutiveCache, executiveRefresh } from './modules/monitor/executive-cache.js';
import { refreshLookupTables } from './modules/monitor/pg-webthron-sync.js';
import { setNextRun } from './lib/sync-stats.js';
import { startWatchdog } from './lib/watchdog.js';
import { startTelegramBot } from './lib/telegram-bot.js';
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

  // ─── Migraciones automáticas (idempotentes) ────────────────────────────────
  await db`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username    TEXT,
      action      TEXT        NOT NULL,
      entity      TEXT,
      entity_id   TEXT,
      ip          TEXT,
      details     JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.catch((e: unknown) => logger.warn(`[Startup] audit_log: ${e}`));
  await db`CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC)`.catch(() => {});
  await db`CREATE INDEX IF NOT EXISTS audit_log_user_id_idx    ON audit_log (user_id)`.catch(() => {});
  await db`CREATE INDEX IF NOT EXISTS audit_log_action_idx     ON audit_log (action)`.catch(() => {});
  logger.info('[Startup] audit_log OK');

  // Rimuove il CHECK constraint Ferrari-specifico su csg_establishment_code
  await db`ALTER TABLE edi_clients DROP CONSTRAINT IF EXISTS edi_clients_csg_establishment_code_check`.catch(() => {});
  await db`ALTER TABLE edi_clients ALTER COLUMN csg_establishment_code TYPE VARCHAR(20), ALTER COLUMN csg_establishment_code SET DEFAULT ''`.catch(() => {});
  logger.info('[Startup] edi_clients establishment_code OK');

  await db`ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'monitor_resumen'`.catch(() => {});
  logger.info('[Startup] module_key_enum monitor_resumen OK');

  await db`
    CREATE TABLE IF NOT EXISTS monitor_turno_default (
      id                   SERIAL PRIMARY KEY,
      linea_id             INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
      day_of_week          INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      t1_inizio            TIME,
      t1_fine              TIME,
      t2_inizio            TIME,
      t2_fine              TIME,
      quantita_giornaliera INTEGER,
      pause                JSONB NOT NULL DEFAULT '[]',
      UNIQUE(linea_id, day_of_week)
    )
  `.catch((e: unknown) => logger.warn(`[Startup] monitor_turno_default: ${e}`));
  logger.info('[Startup] monitor_turno_default OK');

  startScheduler();
  startWatcher();

  // Telegram bot: parte subito, non dipende dal sync
  startTelegramBot();

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
    const [{ count }] = await db`SELECT COUNT(*) AS count FROM webthron_lookup_fasi`;
    if (Number(count) === 0) {
      logger.info('[Startup] Lookup tables vuote — refresh iniziale (bassa priorità)...');
      refreshLookupTables().catch(e => logger.warn(`[Startup] Lookup refresh: ${e}`));
    }

    // 5. Primo sync WebThron: parte dopo 10 minuti dall'avvio.
    setNextRun('sync_incremental', new Date(Date.now() + 10 * 60_000));

    // 6. Watchdog: parte solo dopo che il sync è operativo (10 min + margine)
    setTimeout(() => startWatchdog(executiveRefresh), 12 * 60_000);

    let cycle = 0;
    setInterval(async () => {
      cycle++;
      await executiveRefresh();
      setNextRun('sync_incremental', new Date(Date.now() + 30_000));

      // bufferFullRefresh ogni ~30 min (60 cicli × 30s)
      if (cycle % 60 === 0) {
        await bufferFullRefresh();
        setNextRun('buffer_refresh', new Date(Date.now() + 30 * 60_000));
      }
    }, 30_000);

    logger.info('[Startup] Scheduler avviato — sync WebThron tra 10 min, poi ogni 30s');
  }, 2 * 60_000);

  logger.info('Server pronto — WebThron caricherà tra 2 minuti');
});
