import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { ingressoMerciRoutes } from './modules/ingresso-merci/routes.js';
import { packingRoutes } from './modules/packing/routes.js';
import { monitorRoutes } from './modules/monitor/routes.js';
import { mappaRoutes } from './modules/mappa/routes.js';
import { bufferRoutes } from './modules/buffer/routes.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', corsMiddleware);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── API routes ───────────────────────────────────────────────────────────────
app.route('/api/ingresso-merci', ingressoMerciRoutes);
app.route('/api/pack', packingRoutes);
app.route('/api/monitor', monitorRoutes);
app.route('/api/mappa', mappaRoutes);
app.route('/api/buffer', bufferRoutes);

// Stub para módulos aún no migrados
const stub = (module: string) =>
  new Hono().all('*', (c) =>
    c.json({ error: `Module '${module}' not yet migrated` }, 501)
  );

app.route('/api/spma', stub('spma'));
app.route('/api/prod', stub('production'));
app.route('/api/ask-ai', stub('assistant'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
