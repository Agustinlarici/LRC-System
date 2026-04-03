import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { getExecutiveCache, type ProductionRow } from '../monitor/executive-cache.js';
import { getBufferCache } from '../buffer/cache.js';
import { logger } from '../../lib/logger.js';

export const mappaRoutes = new Hono();

// ─── Shape list (hardcoded from SVG) ─────────────────────────────────────────

const SHAPES = [
  { tag: 'F171VS',   cellId: 'H0EV9G83akpB2cg57h1L-1' },
  { tag: 'F173M',    cellId: 'H0EV9G83akpB2cg57h1L-2' },
  { tag: 'F171',     cellId: 'H0EV9G83akpB2cg57h1L-3' },
  { tag: 'F175',     cellId: 'H0EV9G83akpB2cg57h1L-4' },
  { tag: 'F169',     cellId: 'H0EV9G83akpB2cg57h1L-5' },
  { tag: 'F167',     cellId: 'H0EV9G83akpB2cg57h1L-6' },
  { tag: 'DELIBERA', cellId: 'H0EV9G83akpB2cg57h1L-7' },
  { tag: 'ATC3',     cellId: 'H0EV9G83akpB2cg57h1L-23' },
  { tag: '8CIL',     cellId: 'H0EV9G83akpB2cg57h1L-24' },
];

mappaRoutes.get('/shapes', (c) => c.json(SHAPES));

// ─── Shape→Monitor mappings ───────────────────────────────────────────────────

mappaRoutes.get('/shape-monitors', async (c) => {
  try {
    const rows = await db`
      SELECT sm.shape_tag, sm.monitor_id, ml.nome AS monitor_nome
      FROM mappa_shape_monitor sm
      JOIN monitor_linea ml ON ml.id = sm.monitor_id
      ORDER BY sm.shape_tag
    `;
    return c.json(rows);
  } catch (err) {
    // Table may not exist yet — return empty array
    logger.error(`[Mappa] shape-monitors query failed: ${err}`);
    return c.json([]);
  }
});

mappaRoutes.post('/shape-monitor', async (c) => {
  const body = await parseBody(c, z.object({
    shape_tag:  z.string().min(1),
    monitor_id: z.number().int().positive(),
  }));
  async function upsert() {
    // When assigning a monitor, remove any buffer assignment for this shape
    await db`DELETE FROM mappa_shape_buffer WHERE shape_tag = ${body.shape_tag}`.catch(() => {});
    await db`
      INSERT INTO mappa_shape_monitor (shape_tag, monitor_id)
      VALUES (${body.shape_tag}, ${body.monitor_id})
      ON CONFLICT (shape_tag) DO UPDATE SET monitor_id = EXCLUDED.monitor_id
    `;
  }
  try {
    await upsert();
  } catch {
    // Table missing — auto-create and retry
    await db`
      CREATE TABLE IF NOT EXISTS mappa_shape_monitor (
        shape_tag  VARCHAR(50) PRIMARY KEY,
        monitor_id INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE
      )
    `;
    await upsert();
  }
  return c.json({ status: 'ok' });
});

mappaRoutes.delete('/shape-monitor/:tag', async (c) => {
  const tag = c.req.param('tag');
  try {
    await db`DELETE FROM mappa_shape_monitor WHERE shape_tag = ${tag}`;
  } catch (err) {
    logger.error(`[Mappa] delete shape-monitor failed: ${err}`);
  }
  return c.json({ status: 'deleted' });
});

// ─── Shape→Buffer mappings ────────────────────────────────────────────────────

mappaRoutes.get('/shape-buffers', async (c) => {
  try {
    const rows = await db`
      SELECT sb.shape_tag, sb.buffer_id, bl.nome AS buffer_nome
      FROM mappa_shape_buffer sb
      JOIN buffer_linea bl ON bl.id = sb.buffer_id
      ORDER BY sb.shape_tag
    `;
    return c.json(rows);
  } catch (err) {
    logger.error(`[Mappa] shape-buffers query failed: ${err}`);
    return c.json([]);
  }
});

mappaRoutes.post('/shape-buffer', async (c) => {
  const body = await parseBody(c, z.object({
    shape_tag: z.string().min(1),
    buffer_id: z.number().int().positive(),
  }));
  async function upsert() {
    // When assigning a buffer, remove any monitor assignment for this shape
    await db`DELETE FROM mappa_shape_monitor WHERE shape_tag = ${body.shape_tag}`.catch(() => {});
    await db`
      INSERT INTO mappa_shape_buffer (shape_tag, buffer_id)
      VALUES (${body.shape_tag}, ${body.buffer_id})
      ON CONFLICT (shape_tag) DO UPDATE SET buffer_id = EXCLUDED.buffer_id
    `;
  }
  try {
    await upsert();
  } catch {
    await db`
      CREATE TABLE IF NOT EXISTS mappa_shape_buffer (
        shape_tag VARCHAR(50) PRIMARY KEY,
        buffer_id INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE
      )
    `;
    await upsert();
  }
  return c.json({ status: 'ok' });
});

mappaRoutes.delete('/shape-buffer/:tag', async (c) => {
  const tag = c.req.param('tag');
  try {
    await db`DELETE FROM mappa_shape_buffer WHERE shape_tag = ${tag}`;
  } catch (err) {
    logger.error(`[Mappa] delete shape-buffer failed: ${err}`);
  }
  return c.json({ status: 'deleted' });
});

// ─── Aggregated stati (all mapped shapes in one call) ────────────────────────

type ColorState = 'verde' | 'giallo' | 'rosso' | 'grigio';

type ShapeState =
  | { type: 'monitor'; color: ColorState }
  | { type: 'buffer';  color: ColorState; count: number };

function timeToMin(t: string) {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// Trova l'ultimo evento di produzione per una linea dalla executive cache.
// Zero query WebThron — usa solo i dati già caricati ogni 5 min.
function latestEventFromCache(
  fase: string,
  combos: Array<{ modello: string; componente: string }>,
  cacheRows: ProductionRow[],
): Date | null {
  let latest: Date | null = null;
  for (const r of cacheRows) {
    if (r.fase !== fase) continue;
    if (!combos.some(c => c.modello === r.modello && c.componente === r.componente)) continue;
    if (!latest || r.data_inserimento > latest) latest = r.data_inserimento;
  }
  return latest;
}

async function computeColor(lineaId: number, cacheRows: ProductionRow[]): Promise<ColorState> {
  const [linea] = await db`
    SELECT id, fase, attivo FROM monitor_linea WHERE id = ${lineaId}
  `;
  if (!linea || !linea.attivo) return 'grigio';

  const combos = await db`
    SELECT modello, componente FROM monitor_linea_combo WHERE linea_id = ${lineaId}
  `;

  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5);

  const turniOggi = await db`
    SELECT numero, ora_inizio, ora_fine
    FROM monitor_turno
    WHERE linea_id = ${lineaId} AND data = CURRENT_DATE
    ORDER BY numero
  `;

  const turnoAttivo = turniOggi.find(t => {
    const ini = (t.ora_inizio as string).slice(0, 5);
    const fin = (t.ora_fine   as string).slice(0, 5);
    return timeStr >= ini && timeStr <= fin;
  });

  const [qtaRow] = await db`
    SELECT quantita_giornaliera FROM monitor_quantita_giorno
    WHERE linea_id = ${lineaId} AND data = CURRENT_DATE
  `;

  if (!turnoAttivo || !qtaRow) return 'grigio';

  const [soglie] = await db`
    SELECT soglia_giallo, soglia_rosso FROM monitor_soglie WHERE linea_id = ${lineaId}
  `;
  const soglieColore = soglie ?? { soglia_giallo: 50, soglia_rosso: 20 };

  const pause = await db`
    SELECT ora_inizio, ora_fine FROM monitor_pausa
    WHERE linea_id = ${lineaId} AND data = CURRENT_DATE
    ORDER BY ora_inizio
  `;

  const inPausa = pause.some(p => {
    const start = (p.ora_inizio as string).slice(0, 5);
    const end   = (p.ora_fine   as string).slice(0, 5);
    return timeStr >= start && timeStr < end;
  });
  if (inPausa) return 'grigio';

  const totalTurnoMin = turniOggi.reduce((acc, t) => {
    return acc + Math.max(0, timeToMin(t.ora_fine as string) - timeToMin(t.ora_inizio as string));
  }, 0);

  const pauseMin = pause.reduce((acc, p) => {
    const pS = timeToMin(p.ora_inizio as string);
    const pE = timeToMin(p.ora_fine   as string);
    const overlap = turniOggi.reduce((tAcc, t) => {
      const tS = timeToMin(t.ora_inizio as string);
      const tE = timeToMin(t.ora_fine   as string);
      return tAcc + Math.max(0, Math.min(pE, tE) - Math.max(pS, tS));
    }, 0);
    return acc + overlap;
  }, 0);

  const nettoMin     = Math.max(1, totalTurnoMin - pauseMin);
  const cycleTimeSec = Math.round((nettoMin * 60) / (qtaRow.quantita_giornaliera as number));

  // Ultimo evento dalla executive cache — nessuna query a WebThron
  const ultimoEvento = latestEventFromCache(
    linea.fase as string,
    combos as unknown as Array<{ modello: string; componente: string }>,
    cacheRows,
  );

  let elapsedSec: number;
  if (ultimoEvento) {
    elapsedSec = Math.floor((now.getTime() - ultimoEvento.getTime()) / 1000);
  } else {
    const ini = (turnoAttivo.ora_inizio as string).slice(0, 5).split(':').map(Number);
    const turnoStart = new Date(now);
    turnoStart.setHours(ini[0], ini[1], 0, 0);
    elapsedSec = Math.floor((now.getTime() - turnoStart.getTime()) / 1000);
  }

  const remainingSec = cycleTimeSec - elapsedSec;
  if (remainingSec <= 0) return 'rosso';
  const pct = (remainingSec / cycleTimeSec) * 100;
  if (pct > (soglieColore.soglia_giallo as number)) return 'verde';
  if (pct > (soglieColore.soglia_rosso  as number)) return 'giallo';
  return 'rosso';
}

mappaRoutes.get('/stati', async (c) => {
  let monitorMappings: Array<{ shape_tag: unknown; monitor_id: unknown }> = [];
  let bufferMappings:  Array<{ shape_tag: unknown; buffer_id: unknown }>  = [];
  try {
    monitorMappings = await db`SELECT shape_tag, monitor_id FROM mappa_shape_monitor`;
  } catch { /* table may not exist */ }
  try {
    bufferMappings = await db`SELECT shape_tag, buffer_id FROM mappa_shape_buffer`;
  } catch { /* table may not exist */ }

  const result: Record<string, ShapeState> = {};

  // Monitor shapes — usa la executive cache, zero query a WebThron
  const cacheRows = getExecutiveCache()?.rows ?? [];
  const uniqueMonitorIds = [...new Set(monitorMappings.map(m => m.monitor_id as number))];
  const colorMap = new Map<number, ColorState>();
  for (const id of uniqueMonitorIds) {
    colorMap.set(id, await computeColor(id, cacheRows));
  }
  for (const m of monitorMappings) {
    result[m.shape_tag as string] = {
      type:  'monitor',
      color: colorMap.get(m.monitor_id as number) ?? 'grigio',
    };
  }

  // Buffer shapes
  await Promise.all(bufferMappings.map(async (m) => {
    const bufferId = m.buffer_id as number;
    const cached = getBufferCache(bufferId);
    const count = cached?.items.length ?? 0;
    const [soglie] = await db`SELECT soglia_verde, soglia_giallo FROM buffer_soglie WHERE linea_id = ${bufferId}`.catch(() => [null]);
    const s = soglie ?? { soglia_verde: 10, soglia_giallo: 5 };
    const color: ColorState =
      count >= (s.soglia_verde  as number) ? 'verde'  :
      count >= (s.soglia_giallo as number) ? 'giallo' : 'rosso';
    result[m.shape_tag as string] = { type: 'buffer', color, count };
  }));

  return c.json(result);
});
