import { db } from '../../db/client.js';
import { getWebthronPool } from './mysql-client.js';
import { logger } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineaCache {
  timestamps: Date[]; // tutti gli eventi di oggi, ordinati ASC
  updatedAt:  Date;
}

const cache = new Map<number, LineaCache>();

export function getWebthronCache(lineaId: number): LineaCache | null {
  return cache.get(lineaId) ?? null;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

type Combo = { modello: string; componente: string };

function buildQuery(combos: Combo[], incremental: boolean) {
  const comboConditions = combos
    .map(() => `(ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');

  const where = incremental ? `AND ubi.datain > ?` : '';

  return `
    SELECT LOW_PRIORITY /*+ MAX_EXECUTION_TIME(300000) */ ubi.datain
    FROM ubidocum AS ubi
    LEFT JOIN ikExtra     AS Extra62     ON ubi.iddocu = Extra62.iddocu  AND Extra62.idcampo = 62  AND Extra62.idcomm = 0 AND Extra62.seq = 0
    LEFT JOIN ikExtra     AS Extra43     ON ubi.iddocu = Extra43.iddocu  AND Extra43.idcampo = 43  AND Extra43.idcomm = 0 AND Extra43.seq = 0
    LEFT JOIN ikExtra     AS Extra45     ON ubi.iddocu = Extra45.iddocu  AND Extra45.idcampo = 45  AND Extra45.idcomm = 0 AND Extra45.seq = 0
    LEFT JOIN ikExtraTab  AS ikExtra62Tab ON ikExtra62Tab.id = Extra62.stringa
    LEFT JOIN ikExtraTab  AS ikExtra43Tab ON ikExtra43Tab.id = Extra43.stringa
    LEFT JOIN ikExtraTab  AS ikExtra45Tab ON ikExtra45Tab.id = Extra45.stringa
    WHERE ubi.tipdoc IN ('0080','1520','5004','5005','5006','5007','5010','5016','PX01','0160','0090','5019','1040','5009','5018','0480')
      AND DATE(ubi.datain) = CURDATE()
      AND ikExtra62Tab.stringa = ?
      AND (${comboConditions || '1=0'})
      ${where}
    ORDER BY ubi.datain ASC
    LIMIT 15000
  `;
}

const QUERY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function queryFull(fase: string, combos: Combo[]): Promise<Date[]> {
  if (combos.length === 0) return [];
  const sql    = buildQuery(combos, false);
  const params = [fase, ...combos.flatMap(c => [c.modello, c.componente])];
  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT }, params);
  return (rows as Array<{ datain: Date }>).map(r => r.datain);
}

async function queryIncremental(fase: string, combos: Combo[], since: Date): Promise<Date[]> {
  if (combos.length === 0) return [];
  const sql    = buildQuery(combos, true);
  const params = [fase, ...combos.flatMap(c => [c.modello, c.componente]), since];
  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT }, params);
  return (rows as Array<{ datain: Date }>).map(r => r.datain);
}

// ─── Refresh logic ────────────────────────────────────────────────────────────

async function getActiveLinee() {
  return db`
    SELECT
      ml.id,
      ml.fase,
      COALESCE(
        json_agg(json_build_object('modello', mlc.modello, 'componente', mlc.componente))
          FILTER (WHERE mlc.id IS NOT NULL),
        '[]'
      ) AS combos
    FROM monitor_linea ml
    LEFT JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
    GROUP BY ml.id, ml.fase
  `;
}

async function fullRefreshLine(lineaId: number, fase: string, combos: Combo[]) {
  try {
    const timestamps = await queryFull(fase, combos);
    cache.set(lineaId, { timestamps, updatedAt: new Date() });
  } catch (err) {
    logger.error(`[WebthronCache] Full refresh errore linea ${lineaId}: ${err}`);
  }
}

async function incrementalRefreshLine(lineaId: number, fase: string, combos: Combo[]) {
  const existing = cache.get(lineaId);

  if (!existing) {
    return fullRefreshLine(lineaId, fase, combos);
  }

  const ultimo = existing.timestamps[existing.timestamps.length - 1];
  if (!ultimo) {
    return fullRefreshLine(lineaId, fase, combos);
  }

  try {
    const newTs = await queryIncremental(fase, combos, ultimo);
    if (newTs.length > 0) {
      cache.set(lineaId, {
        timestamps: [...existing.timestamps, ...newTs],
        updatedAt:  new Date(),
      });
    }
  } catch (err) {
    logger.error(`[WebthronCache] Incremental errore linea ${lineaId}: ${err}`);
  }
}

async function runFullRefresh() {
  try {
    const linee = await getActiveLinee();
    // Sequenziale — non in parallelo — per non saturare il pool MySQL (limit 2)
    for (const l of linee) {
      await fullRefreshLine(l.id as number, l.fase as string, l.combos as Combo[]);
    }
    logger.info(`[WebthronCache] Full refresh completato — ${linee.length} linee`);
  } catch (err) {
    logger.error(`[WebthronCache] Full refresh globale errore: ${err}`);
  }
}

async function runIncrementalRefresh() {
  try {
    const linee = await getActiveLinee();
    // Sequenziale — non in parallelo
    for (const l of linee) {
      await incrementalRefreshLine(l.id as number, l.fase as string, l.combos as Combo[]);
    }
  } catch (err) {
    logger.error(`[WebthronCache] Incremental refresh globale errore: ${err}`);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export { runIncrementalRefresh as webthronIncrementalRefresh, runFullRefresh as webthronFullRefresh };

export async function startWebthronCache() {
  await runFullRefresh();
  logger.info('WebThron cache avviata');
}
