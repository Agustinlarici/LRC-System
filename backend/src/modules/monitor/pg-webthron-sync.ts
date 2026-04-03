/**
 * WebThron → PostgreSQL incremental sync.
 *
 * Strategy:
 * - First run of the day (or at startup): full query for today → saves to PG.
 * - Subsequent runs: only fetches rows newer than the last saved timestamp.
 *   Typically returns 10-100 rows in ~2-3 seconds instead of 20,000 rows in ~60 s.
 * - Executive cache reads from PG (instant, zero WebThron lock).
 *
 * WebThron lock impact:
 *   Full load (once/day):  ~60 sec   → runs at startup (delayed 2 min)
 *   Incremental (every 5 min): ~2-3 sec
 */

import { db } from '../../db/client.js';
import { getWebthronPool } from './mysql-client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';

export type ProdRow = {
  fase:             string;
  modello:          string;
  componente:       string;
  cod_seriale:      string;
  esito_delibera:   string | null;
  data_inserimento: Date;
};

type LineaCombo = { fase: string; modello: string; componente: string };

const QUERY_TIMEOUT_MS = 3 * 60 * 1000;

// In-memory state — reset on process restart (triggers full reload)
let lastSyncAt: Date | null = null;
let cacheDay: string = '';  // 'YYYY-MM-DD' in Italian time

function todayItaly(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

export async function getActiveLineeWithCombos(): Promise<LineaCombo[]> {
  const rows = await db`
    SELECT DISTINCT ml.fase, mlc.modello, mlc.componente
    FROM monitor_linea ml
    JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
  `;
  return rows as unknown as LineaCombo[];
}

function getDeliberaFasi(): string[] {
  return (process.env.DELIBERA_FASI ?? 'DELIBERA FINALE,DELIBERA FINALE PROX')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// ─── WebThron query ───────────────────────────────────────────────────────────
// since=null  → full day (DATE(datain) = CURDATE()) — used once per day
// since=Date  → incremental (datain > since) — used every 5 min, very fast

async function queryWebthronSince(
  prodCombos: LineaCombo[],
  deliberaFasi: string[],
  since: Date | null,
): Promise<ProdRow[]> {
  if (prodCombos.length === 0) return [];

  const prodConditions = prodCombos
    .map(() => `(ikExtra62Tab.stringa = ? AND ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');
  const prodParams = prodCombos.flatMap(c => [c.fase, c.modello, c.componente]);

  const allModelli        = [...new Set(prodCombos.map(c => c.modello))];
  const allComponenti     = [...new Set(prodCombos.map(c => c.componente))];
  const delibFasiPH       = deliberaFasi.map(() => '?').join(', ');
  const delibModelliPH    = allModelli.map(() => '?').join(', ');
  const delibComponentiPH = allComponenti.map(() => '?').join(', ');

  // Full load: filtra per data italiana (CONVERT_TZ UTC→+01:00).
  // Incremental: solo righe più recenti di lastSyncAt — nessun filtro data.
  const dateFilter = since
    ? `AND ubi.datain > ?`
    : `AND DATE(CONVERT_TZ(ubi.datain, '+00:00', '+01:00')) = CURDATE()`;
  const rowLimit = since ? 2000 : 20000;

  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(180000) */
      ikExtra62Tab.stringa  AS fase,
      ikExtra43Tab.stringa  AS modello,
      ikExtra45Tab.stringa  AS componente,
      Extra186.stringa      AS cod_seriale,
      ikExtra136Tab.stringa AS esito_delibera,
      ubi.datain            AS data_inserimento
    FROM ubidocum ubi
    LEFT JOIN ikExtra    Extra62    ON ubi.iddocu = Extra62.iddocu    AND Extra62.idcampo  = 62  AND Extra62.idcomm = 0 AND Extra62.seq = 0
    LEFT JOIN ikExtra    Extra43    ON ubi.iddocu = Extra43.iddocu    AND Extra43.idcampo  = 43  AND Extra43.idcomm = 0 AND Extra43.seq = 0
    LEFT JOIN ikExtra    Extra45    ON ubi.iddocu = Extra45.iddocu    AND Extra45.idcampo  = 45  AND Extra45.idcomm = 0 AND Extra45.seq = 0
    LEFT JOIN ikExtra    Extra186   ON ubi.iddocu = Extra186.iddocu   AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
    LEFT JOIN ikExtra    Extra136   ON ubi.iddocu = Extra136.iddocu   AND Extra136.idcampo = 136 AND Extra136.idcomm = 0 AND Extra136.seq = 0
    LEFT JOIN ikExtraTab ikExtra62Tab  ON ikExtra62Tab.id  = Extra62.stringa
    LEFT JOIN ikExtraTab ikExtra43Tab  ON ikExtra43Tab.id  = Extra43.stringa
    LEFT JOIN ikExtraTab ikExtra45Tab  ON ikExtra45Tab.id  = Extra45.stringa
    LEFT JOIN ikExtraTab ikExtra136Tab ON ikExtra136Tab.id = Extra136.stringa
    WHERE
      ubi.tipdoc IN ('0480','0080','0160','1520','5004','5005','5006','5007','5010','5016','PX01','0090')
      ${dateFilter}
      AND Extra186.stringa      IS NOT NULL
      AND ikExtra43Tab.stringa  IS NOT NULL
      AND ikExtra45Tab.stringa  IS NOT NULL
      AND ikExtra62Tab.stringa  IS NOT NULL
      AND (
        (${prodConditions})
        OR (
          ikExtra62Tab.stringa IN (${delibFasiPH})
          AND ikExtra43Tab.stringa IN (${delibModelliPH})
          AND ikExtra45Tab.stringa IN (${delibComponentiPH})
        )
      )
    ORDER BY ubi.datain ASC
    LIMIT ${rowLimit}
  `;

  const params = [
    ...(since ? [since] : []),
    ...prodParams,
    ...deliberaFasi,
    ...allModelli,
    ...allComponenti,
  ];

  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT_MS }, params);
  return (rows as Array<{
    fase: string; modello: string; componente: string;
    cod_seriale: string; esito_delibera: string | null; data_inserimento: Date;
  }>).map(r => ({
    fase:             r.fase,
    modello:          r.modello,
    componente:       r.componente,
    cod_seriale:      r.cod_seriale,
    esito_delibera:   r.esito_delibera,
    data_inserimento: r.data_inserimento,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sync WebThron → PostgreSQL.
 * - fullLoad=true: fetches all of today's data (run once at startup/day change).
 * - fullLoad=false: fetches only rows newer than lastSyncAt (fast, ~2-3 sec).
 */
export async function syncWebthronToPostgres(fullLoad = false): Promise<void> {
  if (!process.env.WEBTHRON_HOST) {
    logger.debug('[WebthronSync] WEBTHRON_HOST non configurato — skip');
    return;
  }
  if (!(await isIKnowEnabled('iknow_andon_enabled'))) {
    logger.debug('[WebthronSync] iKnow Andon disabilitato — skip');
    return;
  }
  const today = todayItaly();

  // Day has changed → clear previous day's cache and force full reload
  if (today !== cacheDay) {
    if (cacheDay) {
      await db`DELETE FROM webthron_prod_cache WHERE data_cache < CURRENT_DATE`;
      logger.info('[WebthronSync] Nuovo giorno — cache precedente eliminata');
    }
    cacheDay  = today;
    lastSyncAt = null;  // triggers full load
  }

  const combos       = await getActiveLineeWithCombos();
  const deliberaFasi = getDeliberaFasi();
  if (combos.length === 0) return;

  // Use full load if forced or if no sync has happened yet today
  const since = (fullLoad || !lastSyncAt) ? null : lastSyncAt;
  const label = since ? `incrementale da ${since.toISOString()}` : 'completo giornaliero';

  logger.debug(`[WebthronSync] Query ${label}...`);
  const rows = await queryWebthronSince(combos, deliberaFasi, since);

  if (rows.length === 0) {
    logger.debug('[WebthronSync] Nessun nuovo evento');
    return;
  }

  // Bulk insert into PostgreSQL — ON CONFLICT DO NOTHING handles duplicates
  const records = rows.map(r => ({
    fase:             r.fase,
    modello:          r.modello,
    componente:       r.componente,
    cod_seriale:      r.cod_seriale,
    esito_delibera:   r.esito_delibera ?? null,
    data_inserimento: r.data_inserimento,
    data_cache:       today,
  }));

  await db`
    INSERT INTO webthron_prod_cache ${db(records)}
    ON CONFLICT (fase, cod_seriale, data_inserimento) DO NOTHING
  `;

  // Update watermark to the latest timestamp received
  lastSyncAt = rows[rows.length - 1].data_inserimento;
  logger.info(`[WebthronSync] +${rows.length} eventi — ultimo: ${lastSyncAt.toISOString()}`);
}

/**
 * Read today's full production data from PostgreSQL (instant, no WebThron call).
 */
export async function getProdRowsFromPG(): Promise<ProdRow[]> {
  const rows = await db`
    SELECT fase, modello, componente, cod_seriale, esito_delibera, data_inserimento
    FROM webthron_prod_cache
    WHERE data_cache = CURRENT_DATE
    ORDER BY data_inserimento ASC
  `;
  return rows as unknown as ProdRow[];
}
