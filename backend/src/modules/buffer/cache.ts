import { db } from '../../db/client.js';
import { queryBufferAll, type BufferItem, type BufferCombo } from './mysql-client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BufferCache {
  items:     BufferItem[];
  updatedAt: Date;
}

const cache = new Map<number, BufferCache>();

export function getBufferCache(lineaId: number): BufferCache | null {
  return cache.get(lineaId) ?? null;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function getActiveLinee() {
  return db`
    SELECT
      bl.id,
      COALESCE(
        json_agg(DISTINCT blf.fase) FILTER (WHERE blf.id IS NOT NULL),
        '[]'
      ) AS fasi,
      COALESCE(
        json_agg(json_build_object('modello', blc.modello, 'componente', blc.componente))
          FILTER (WHERE blc.id IS NOT NULL),
        '[]'
      ) AS combos
    FROM buffer_linea bl
    LEFT JOIN buffer_linea_fase  blf ON blf.linea_id = bl.id
    LEFT JOIN buffer_linea_combo blc ON blc.linea_id = bl.id
    WHERE bl.attivo = true
    GROUP BY bl.id
  `;
}

async function runFullRefresh() {
  if (!(await isIKnowEnabled('iknow_buffer_enabled'))) {
    logger.debug('[BufferCache] iKnow Buffer disabilitato — skip');
    return;
  }
  try {
    const linee = await getActiveLinee();
    if (linee.length === 0) {
      logger.info('[BufferCache] Nessun buffer attivo');
      return;
    }
    const results = await queryBufferAll(linee.map(l => ({
      id:     l.id     as number,
      fasi:   l.fasi   as string[],
      combos: l.combos as BufferCombo[],
    })));
    for (const [lineaId, items] of results) {
      cache.set(lineaId, { items, updatedAt: new Date() });
    }
    logger.info(`[BufferCache] Refresh completato — ${linee.length} buffer`);
  } catch (err) {
    logger.error(`[BufferCache] Errore refresh globale: ${err}`);
  }
}

// ─── Single-linea refresh (used after create/update) ──────────────────────────

export async function refreshSingleBuffer(lineaId: number): Promise<void> {
  try {
    const [row] = await db`
      SELECT
        bl.id,
        COALESCE(json_agg(DISTINCT blf.fase) FILTER (WHERE blf.id IS NOT NULL), '[]') AS fasi,
        COALESCE(
          json_agg(json_build_object('modello', blc.modello, 'componente', blc.componente))
            FILTER (WHERE blc.id IS NOT NULL),
          '[]'
        ) AS combos
      FROM buffer_linea bl
      LEFT JOIN buffer_linea_fase  blf ON blf.linea_id = bl.id
      LEFT JOIN buffer_linea_combo blc ON blc.linea_id = bl.id
      WHERE bl.id = ${lineaId} AND bl.attivo = true
      GROUP BY bl.id
    `;
    if (!row) return;
    const results = await queryBufferAll([{
      id:     row.id     as number,
      fasi:   row.fasi   as string[],
      combos: row.combos as BufferCombo[],
    }]);
    for (const [id, items] of results) {
      cache.set(id, { items, updatedAt: new Date() });
    }
  } catch (err) {
    logger.error(`[BufferCache] Errore refresh linea ${lineaId}: ${err}`);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export { runFullRefresh as bufferFullRefresh };

export async function startBufferCache(): Promise<void> {
  await runFullRefresh();
  logger.info('Buffer cache avviata');
}
