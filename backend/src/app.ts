import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { ingressoMerciRoutes } from './modules/ingresso-merci/routes.js';
import { packingRoutes } from './modules/packing/routes.js';
import { monitorRoutes } from './modules/monitor/routes.js';
import { stopRoutes }    from './modules/monitor/stop-routes.js';
import { mappaRoutes } from './modules/mappa/routes.js';
import { bufferRoutes } from './modules/buffer/routes.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { dashboardsRoutes } from './modules/dashboards/routes.js';
import { systemRoutes } from './modules/system/routes.js';
import { spmaRoutes } from './modules/spma/routes.js';
import { recepcionesRoutes } from './modules/recepciones/routes.js';
import { ediRoutes } from './modules/edi/routes.js';
import { webddtRoutes } from './modules/webddt/routes.js';
import { spedizioneBucciRoutes } from './modules/spedizione-bucci/routes.js';
import { qualitaRoutes } from './modules/qualita/routes.js';
import { programmaProduzioneRoutes } from './modules/programma-produzione/routes.js';
import { hrRoutes } from './modules/hr/routes.js';
import { ferrariRoutes } from './modules/ferrari/routes.js';
import { activityRoutes } from './modules/activity/routes.js';
import { progettiRoutes } from './modules/progetti/routes.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';
import { getWebthronPool, IKnowDisabledError } from './modules/monitor/mysql-client.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start }, 'request');
});
// crossOriginResourcePolicy: 'cross-origin' — il frontend (porta 3000) carica immagini/file
// direttamente dal backend (porta 3001), quindi sono origini diverse per design. Il default
// 'same-origin' di Hono blocca silenziosamente questi <img src> lato browser (la richiesta
// risponde 200 ma il browser rifiuta di renderizzarla) anche se CORS/cookie sono corretti.
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }));
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
    // Con un tetto di 4 s: se WebThron non risponde, /health deve comunque rispondere (il deploy lo aspetta).
    let conn: Awaited<ReturnType<ReturnType<typeof getWebthronPool>['getConnection']>> | undefined;
    let timedOut = false;
    try {
      const attempt = (async () => {
        const c = await getWebthronPool().getConnection();
        if (timedOut) { c.release(); return; }   // arrivata in ritardo: la si restituisce subito
        conn = c;
        await c.ping();
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new Error('webthron health timeout')); }, 4000);
      });
      try { await Promise.race([attempt, limit]); } finally { clearTimeout(timer); }
      deps.webthron = 'ok';
    } catch (e) {
      deps.webthron = e instanceof IKnowDisabledError ? 'disabled' : 'unavailable';
    } finally {
      conn?.release();
    }

    const pgDown = deps.postgres !== 'ok';
    const degraded = deps.webthron === 'unavailable';

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
app.route('/api/monitor', stopRoutes);
app.route('/api/mappa', mappaRoutes);
app.route('/api/buffer', bufferRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/tickets', ticketRoutes);
app.route('/api/dashboards', dashboardsRoutes);
app.route('/api/system', systemRoutes);

app.route('/api/spma', spmaRoutes);
app.route('/api/recepciones', recepcionesRoutes);
app.route('/api/edi', ediRoutes);
app.route('/api/webddt', webddtRoutes);
app.route('/api/bucci', spedizioneBucciRoutes);
app.route('/api/qualita', qualitaRoutes);
app.route('/api/prod', programmaProduzioneRoutes);
app.route('/api/hr', hrRoutes);
app.route('/api/ferrari', ferrariRoutes);
app.route('/api/activity', activityRoutes);
app.route('/api/progetti', progettiRoutes);

// Stub para módulos aún no migrados
const stub = (module: string) =>
  new Hono().all('*', (c) =>
    c.json({ error: `Module '${module}' not yet migrated` }, 501)
  );
app.route('/api/ask-ai', stub('assistant'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
