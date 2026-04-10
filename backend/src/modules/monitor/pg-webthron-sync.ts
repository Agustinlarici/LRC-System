/**
 * WebThron → PostgreSQL unified sync.
 *
 * Single source of truth: webthron_events_history.
 * webthron_prod_cache is a VIEW on history (WHERE data_cache = CURRENT_DATE).
 *
 * Sync scope covers both Andon (monitor_linea_combo) AND Buffer (buffer_linea_combo).
 *
 * WebThron lock impact:
 *   Full load  (once/day at startup): ~60 sec
 *   Incremental (every 10 min):       ~2-3 sec
 *   Lookup refresh (once/day at 02:00): ~5-10 sec
 */

import { db } from '../../db/client.js';
import { queryWebthronEvents, getWebthronPool, WebthronEvent, LineaCombo } from './mysql-client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';
import { startRun, endRun, failRun } from '../../lib/sync-stats.js';

export type ProdRow = WebthronEvent;

let lastSyncAt: Date | null = null;
let cacheDay: string = '';

function todayItaly(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

/** Returns midnight Rome time as a UTC Date (uses index on datain). */
function midnightRome(dateStr: string): Date {
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${dateStr}T12:00:00Z`))
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  // offset looks like "GMT+2" or "GMT+1"
  const sign  = offset.includes('-') ? '-' : '+';
  const hours = offset.replace('GMT', '').replace('+', '').replace('-', '');
  return new Date(`${dateStr}T00:00:00${sign}${hours.padStart(2,'0')}:00`);
}

function getDeliberaFasi(): string[] {
  return (process.env.DELIBERA_FASI ?? 'DELIBERA FINALE,DELIBERA FINALE PROX')
    .split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * All (fase, modello, componente) combos needed by Andon + Buffer.
 */
export async function getActiveLineeWithCombos(): Promise<LineaCombo[]> {
  const rows = await db`
    SELECT DISTINCT fase, modello, componente FROM (
      SELECT ml.fase, mlc.modello, mlc.componente
      FROM monitor_linea ml
      JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
      WHERE ml.attivo = true

      UNION

      SELECT blf.fase, blc.modello, blc.componente
      FROM buffer_linea bl
      JOIN buffer_linea_fase  blf ON blf.linea_id = bl.id
      JOIN buffer_linea_combo blc ON blc.linea_id = bl.id
      WHERE bl.attivo = true

      UNION

      SELECT f.fase, m.modello, c.componente
      FROM iknow_tracked_fasi f
      CROSS JOIN iknow_tracked_modelli m
      CROSS JOIN iknow_tracked_componenti c
      WHERE f.active = true AND m.active = true AND c.active = true
    ) combined
    WHERE fase IS NOT NULL AND modello IS NOT NULL AND componente IS NOT NULL
  `;
  return rows as unknown as LineaCombo[];
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncWebthronToPostgres(): Promise<void> {
  if (!process.env.WEBTHRON_HOST) {
    logger.debug('[WebthronSync] WEBTHRON_HOST non configurato — skip');
    return;
  }
  if (!(await isIKnowEnabled('iknow_andon_enabled'))) {
    logger.debug('[WebthronSync] iKnow Andon disabilitato — skip');
    return;
  }
  const today = todayItaly();

  if (today !== cacheDay) {
    cacheDay   = today;
    lastSyncAt = null;
  }

  const combos       = await getActiveLineeWithCombos();
  const deliberaFasi = getDeliberaFasi();
  if (combos.length === 0) return;

  // Always use 'since' with an index-friendly range — never a full table scan.
  // On first run of the day, since = midnight Rome time.
  // On subsequent runs, since = last synced row timestamp.
  const since = lastSyncAt ?? midnightRome(today);
  const dateFilter = { mode: 'since' as const, since };
  const jobName = lastSyncAt ? 'sync_incremental' : 'sync_full';
  startRun(jobName);
  try {
    const rows = await queryWebthronEvents(combos, deliberaFasi, dateFilter);

    if (rows.length === 0) {
      endRun(jobName, 0);
      logger.debug('[WebthronSync] Nessun nuovo evento');
      return;
    }

    const records = rows.map(r => ({
      fase:             r.fase,
      modello:          r.modello,
      componente:       r.componente,
      cod_seriale:      r.cod_seriale,
      commessa:         r.commessa ?? null,
      esito_delibera:   r.esito_delibera ?? null,
      data_inserimento: r.data_inserimento,
      data_cache:       today,
    }));

    await db`
      INSERT INTO webthron_events_history ${db(records)}
      ON CONFLICT (fase, cod_seriale, data_inserimento)
      DO UPDATE SET commessa = EXCLUDED.commessa
      WHERE webthron_events_history.commessa IS NULL
    `;

    lastSyncAt = rows[rows.length - 1].data_inserimento;
    endRun(jobName, rows.length);
    logger.info(`[WebthronSync] +${rows.length} eventi — ultimo: ${lastSyncAt.toISOString()}`);
  } catch (err) {
    failRun(jobName, err);
    throw err;
  }
}

// ─── Executive read ───────────────────────────────────────────────────────────

export async function getProdRowsFromPG(): Promise<ProdRow[]> {
  const rows = await db`
    SELECT fase, modello, componente, cod_seriale, commessa, esito_delibera, data_inserimento
    FROM webthron_events_history
    WHERE data_cache = CURRENT_DATE
    ORDER BY data_inserimento ASC
  `;
  return rows as unknown as ProdRow[];
}

// ─── Lookup table refresh (runs once per day at 02:00) ────────────────────────

export async function refreshLookupTables(): Promise<void> {
  if (!process.env.WEBTHRON_HOST) {
    logger.debug('[LookupRefresh] WEBTHRON_HOST non configurato — skip');
    return;
  }

  const TIMEOUT = 2 * 60 * 1000;
  const pool = getWebthronPool();

  startRun('lookup_refresh');
  try {
    logger.info('[LookupRefresh] Aggiornamento fasi e combos da WebThron...');

    // Una sola query che usa l'indice su datain (ultimi 90gg) invece di scansionare
    
    const [rows] = await (pool as any).execute({
      sql: `
        SELECT /*+ MAX_EXECUTION_TIME(120000) */ DISTINCT
          ikExtra62Tab.stringa AS fase,
          ikExtra43Tab.stringa AS modello,
          ikExtra45Tab.stringa AS componente
        FROM ubidocum ubi
        LEFT JOIN ikExtra    Extra62 ON ubi.iddocu = Extra62.iddocu AND Extra62.idcampo = 62 AND Extra62.idcomm = 0 AND Extra62.seq = 0
        LEFT JOIN ikExtra    Extra43 ON ubi.iddocu = Extra43.iddocu AND Extra43.idcampo = 43 AND Extra43.idcomm = 0 AND Extra43.seq = 0
        LEFT JOIN ikExtra    Extra45 ON ubi.iddocu = Extra45.iddocu AND Extra45.idcampo = 45 AND Extra45.idcomm = 0 AND Extra45.seq = 0
        LEFT JOIN ikExtraTab ikExtra62Tab ON ikExtra62Tab.id = Extra62.stringa
        LEFT JOIN ikExtraTab ikExtra43Tab ON ikExtra43Tab.id = Extra43.stringa
        LEFT JOIN ikExtraTab ikExtra45Tab ON ikExtra45Tab.id = Extra45.stringa
        WHERE ubi.tipdoc IN ('0480','0080','0160','1520','5004','5005','5006','5007','5010','5016','PX01','0090')
          AND ubi.datain > NOW() - INTERVAL 90 DAY
          AND ikExtra62Tab.stringa IS NOT NULL
          AND ikExtra43Tab.stringa IS NOT NULL
          AND ikExtra45Tab.stringa IS NOT NULL
        LIMIT 10000
      `,
      timeout: TIMEOUT,
    }) as [Array<{ fase: string; modello: string; componente: string }>];

    // JS split into fasi (distinct) and combos (distinct modello+componente)
    const fasiSet   = new Set<string>();
    const combosMap = new Map<string, { modello: string; componente: string }>();
    for (const r of rows) {
      fasiSet.add(r.fase);
      combosMap.set(`${r.modello}|${r.componente}`, { modello: r.modello, componente: r.componente });
    }

    const now = new Date();

    if (fasiSet.size > 0) {
      const fasiRecords = [...fasiSet].map(fase => ({ fase, updated_at: now }));
      await db`
        INSERT INTO webthron_lookup_fasi ${db(fasiRecords)}
        ON CONFLICT (fase) DO UPDATE SET updated_at = EXCLUDED.updated_at
      `;
      const fasiValues = [...fasiSet];
      await db`DELETE FROM webthron_lookup_fasi WHERE fase != ALL(${fasiValues})`;
    }

    if (combosMap.size > 0) {
      const comboRecords = [...combosMap.values()].map(r => ({ ...r, updated_at: now }));
      await db`
        INSERT INTO webthron_lookup_combos ${db(comboRecords)}
        ON CONFLICT (modello, componente) DO UPDATE SET updated_at = EXCLUDED.updated_at
      `;
    }

    endRun('lookup_refresh', rows.length);
    logger.info(`[LookupRefresh] ${fasiSet.size} fasi, ${combosMap.size} combos salvati in PG`);
  } catch (err) {
    failRun('lookup_refresh', err);
    throw err;
  }
}
