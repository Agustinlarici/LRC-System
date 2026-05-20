import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { ingressoMerciRoutes } from './modules/ingresso-merci/routes.js';
import { packingRoutes } from './modules/packing/routes.js';
import { monitorRoutes } from './modules/monitor/routes.js';
import { mappaRoutes } from './modules/mappa/routes.js';
import { bufferRoutes } from './modules/buffer/routes.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { dashboardsRoutes } from './modules/dashboards/routes.js';
import { systemRoutes } from './modules/system/routes.js';
import { spmaRoutes } from './modules/spma/routes.js';
import { recepcionesRoutes } from './modules/recepciones/routes.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';
import { getWebthronPool } from './modules/monitor/mysql-client.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start }, 'request');
});
app.use('*', secureHeaders());
app.use('*', corsMiddleware);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  try {
    const deps: { postgres: string; webthron: string } = {
      postgres: 'error',
      webthron: 'unavailable',
    };

    // Check PostgreSQL
    try {
      await db`SELECT 1`;
      deps.postgres = 'ok';
    } catch {
      deps.postgres = 'error';
    }

    // Check WebThron MySQL (non-critical) — ping() no query, no data
    // try-finally garantisce che la connessione venga sempre rilasciata al pool
    let conn;
    try {
      conn = await getWebthronPool().getConnection();
      await conn.ping();
      deps.webthron = 'ok';
    } catch {
      deps.webthron = 'unavailable';
    } finally {
      conn?.release();
    }

    const pgDown = deps.postgres !== 'ok';
    const degraded = deps.webthron !== 'ok';

    const status = pgDown ? 'error' : degraded ? 'degraded' : 'ok';
    const httpStatus = pgDown ? 503 : 200;

    return c.json({ status, ts: new Date().toISOString(), deps }, httpStatus);
  } catch {
    return c.json(
      { status: 'error', ts: new Date().toISOString(), deps: { postgres: 'error', webthron: 'unavailable' } },
      503
    );
  }
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.route('/api/ingresso-merci', ingressoMerciRoutes);
app.route('/api/pack', packingRoutes);
app.route('/api/monitor', monitorRoutes);
app.route('/api/mappa', mappaRoutes);
app.route('/api/buffer', bufferRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/tickets', ticketRoutes);
app.route('/api/dashboards', dashboardsRoutes);
app.route('/api/system', systemRoutes);

app.route('/api/spma', spmaRoutes);
app.route('/api/recepciones', recepcionesRoutes);

// Stub para módulos aún no migrados
const stub = (module: string) =>
  new Hono().all('*', (c) =>
    c.json({ error: `Module '${module}' not yet migrated` }, 501)
  );
app.route('/api/prod', stub('production'));
app.route('/api/ask-ai', stub('assistant'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
