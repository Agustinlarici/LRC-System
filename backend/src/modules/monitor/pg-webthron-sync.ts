/**
 * WebThron → PostgreSQL unified sync.
 *
 * Single source of truth: webthron_events_history.
 * webthron_prod_cache is a VIEW on history (WHERE data_cache = CURRENT_DATE).
 *
 * Sync scope covers both Andon (monitor_linea_combo) AND Buffer (buffer_linea_combo).
 *
 * WebThron è MariaDB con tabelle MyISAM: ogni SELECT blocca la tabella. Per questo tutte le
 * letture sono corte, sull'indice di `datain`, una alla volta e con un limite di tempo lato
 * server (vedi mysql-client.ts e webthron-guard.ts).
 *
 *   Incrementale (ogni minuto,~5 min di notte): pochi ms, solo gli eventi nuovi
 *   Rilettura notturna (01:00):                 rebanadine di 4 ore sul giorno prima
 *   Aggiornamento fasi/combos (02:00):          rebanadine di 7 giorni sugli ultimi 90
 */

import { db } from '../../db/client.js';
import { queryWebthronEvents, getWebthronPool, WebthronEvent, LineaCombo } from './mysql-client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';
import { startRun, endRun, failRun } from '../../lib/sync-stats.js';
import { isQuietHour } from './webthron-time.js';

export type ProdRow = WebthronEvent;

let lastSyncAt: Date | null = null;
let cacheDay: string = '';
let lastAttemptAt = 0;

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Si rilegge un minuto prima dell'ultimo evento visto: con `datain > ultimo` un evento con lo stesso
// timestamp, arrivato dopo, andrebbe perso. L'upsert è idempotente, quindi riletture e riavvii non duplicano.
const OVERLAP_MS = envInt('WEBTHRON_SYNC_OVERLAP_SECONDS', 60) * 1000;

// Di notte (default 23:00–05:00, ora di Roma) non c'è produzione: un controllo ogni pochi minuti basta.
const QUIET_FROM_HOUR   = envInt('WEBTHRON_QUIET_FROM_HOUR', 23);
const QUIET_TO_HOUR     = envInt('WEBTHRON_QUIET_TO_HOUR', 5);
const QUIET_INTERVAL_MS = envInt('WEBTHRON_QUIET_INTERVAL_SECONDS', 300) * 1000;

// Aggiornamento fasi/combos: finestra totale e ampiezza di ogni rebanadina
const LOOKUP_DAYS       = Math.max(1, envInt('WEBTHRON_LOOKUP_DAYS', 90));
const LOOKUP_SLICE_DAYS = 7;

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

  // Fascia notturna: un solo controllo ogni pochi minuti invece che a ogni ciclo
  if (isQuietHour(new Date(), QUIET_FROM_HOUR, QUIET_TO_HOUR) && Date.now() - lastAttemptAt < QUIET_INTERVAL_MS) return;
  lastAttemptAt = Date.now();

  const combos       = await getActiveLineeWithCombos();
  const deliberaFasi = getDeliberaFasi();
  if (combos.length === 0) return;

  // Sempre un intervallo su `datain` (indice) — mai una scansione di tabella.
  // L'avanzamento è in memoria; dopo un riavvio riparte dall'ultimo evento già salvato oggi
  // (non da mezzanotte), così un riavvio del backend non rilegge tutta la giornata.
  const midnight = midnightRome(today);
  let since: Date;
  if (lastSyncAt) {
    since = new Date(lastSyncAt.getTime() - OVERLAP_MS);
  } else {
    const [last] = await db`
      SELECT MAX(data_inserimento) AS ultimo FROM webthron_events_history WHERE data_cache = ${today}::date
    `;
    const ultimo = (last?.ultimo as Date | null) ?? null;
    since = ultimo && ultimo > midnight ? new Date(ultimo.getTime() - OVERLAP_MS) : midnight;
  }
  const dateFilter = { mode: 'since' as const, since };
  const jobName = since > midnight ? 'sync_incremental' : 'sync_full';
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
      versione:         r.versione ?? null,
      operatore:        r.operatore ?? null,
      colore:           r.colore ?? null,
      protocollo_cesta: r.protocollo_cesta ?? null,
    }));

    // Gli eventi riletti nella sovrapposizione esistono già: si completano solo i campi ancora vuoti
    // (nessuna riscrittura se non cambia nulla, per non gonfiare la tabella).
    const result = await db`
      INSERT INTO webthron_events_history ${db(records)}
      ON CONFLICT (fase, cod_seriale, data_inserimento)
      DO UPDATE SET
        commessa         = COALESCE(webthron_events_history.commessa,         EXCLUDED.commessa),
        versione         = COALESCE(webthron_events_history.versione,         EXCLUDED.versione),
        operatore        = COALESCE(webthron_events_history.operatore,        EXCLUDED.operatore),
        colore           = COALESCE(webthron_events_history.colore,           EXCLUDED.colore),
        protocollo_cesta = COALESCE(webthron_events_history.protocollo_cesta, EXCLUDED.protocollo_cesta)
      WHERE (webthron_events_history.commessa         IS NULL AND EXCLUDED.commessa         IS NOT NULL)
         OR (webthron_events_history.versione         IS NULL AND EXCLUDED.versione         IS NOT NULL)
         OR (webthron_events_history.operatore        IS NULL AND EXCLUDED.operatore        IS NOT NULL)
         OR (webthron_events_history.colore           IS NULL AND EXCLUDED.colore           IS NOT NULL)
         OR (webthron_events_history.protocollo_cesta IS NULL AND EXCLUDED.protocollo_cesta IS NOT NULL)
    `;

    const ultimoVisto = rows[rows.length - 1].data_inserimento;
    if (!lastSyncAt || ultimoVisto > lastSyncAt) lastSyncAt = ultimoVisto;
    endRun(jobName, result.count);
    if (result.count > 0) {
      logger.info(`[WebthronSync] +${result.count} eventi (${rows.length} letti) — ultimo: ${ultimoVisto.toISOString()}`);
    } else {
      logger.debug(`[WebthronSync] Nessun evento nuovo (${rows.length} riletti)`);
    }
  } catch (err) {
    failRun(jobName, err);
    throw err;
  }
}

// ─── Full-day sync to history ─────────────────────────────────────────────────
//
// Reads ALL events for a given date from WebThron and upserts them into
// webthron_events_history. Run once at end-of-day to catch late entries,
// corrections, or anything missed by the incremental sync during the day.
// La lettura è a rebanadine di 4 ore sull'indice di `datain` (vedi mysql-client.ts).

/** Righe per INSERT: 12 colonne × 2000 restano sotto il limite di 65.535 parametri di PostgreSQL. */
const INSERT_CHUNK = 2000;

/**
 * Legge un giorno intero da WebThron e lo scrive nello storico (upsert idempotente).
 * Non controlla gli interruttori: li controllano i chiamanti (rilettura notturna, carica iniziale).
 * Ritorna le righe lette; lancia l'errore se WebThron non risponde.
 */
export async function loadDayIntoHistory(dateStr: string): Promise<number> {
  const combos       = await getActiveLineeWithCombos();
  const deliberaFasi = getDeliberaFasi();
  if (combos.length === 0) return 0;

  const rows = await queryWebthronEvents(combos, deliberaFasi, { mode: 'range', from: dateStr, to: dateStr });
  if (rows.length === 0) return 0;

  const records = rows.map(r => ({
    fase:             r.fase,
    modello:          r.modello,
    componente:       r.componente,
    cod_seriale:      r.cod_seriale,
    commessa:         r.commessa ?? null,
    esito_delibera:   r.esito_delibera ?? null,
    data_inserimento: r.data_inserimento,
    data_cache:       dateStr,
    versione:         r.versione ?? null,
    operatore:        r.operatore ?? null,
    colore:           r.colore ?? null,
    protocollo_cesta: r.protocollo_cesta ?? null,
  }));

  let changed = 0;
  for (let i = 0; i < records.length; i += INSERT_CHUNK) {
    const result = await db`
      INSERT INTO webthron_events_history ${db(records.slice(i, i + INSERT_CHUNK))}
      ON CONFLICT (fase, cod_seriale, data_inserimento) DO UPDATE SET
        esito_delibera   = EXCLUDED.esito_delibera,
        commessa         = COALESCE(EXCLUDED.commessa,         webthron_events_history.commessa),
        versione         = COALESCE(EXCLUDED.versione,         webthron_events_history.versione),
        operatore        = COALESCE(EXCLUDED.operatore,        webthron_events_history.operatore),
        colore           = COALESCE(EXCLUDED.colore,           webthron_events_history.colore),
        protocollo_cesta = COALESCE(EXCLUDED.protocollo_cesta, webthron_events_history.protocollo_cesta)
    `;
    changed += result.count;
  }
  logger.info(`[FullDaySync] ${dateStr} — ${rows.length} eventi da WebThron, ${changed} modificati in history`);
  return rows.length;
}

export async function syncFullDayToHistory(dateStr: string): Promise<number> {
  if (!process.env.WEBTHRON_HOST) return 0;
  if (!(await isIKnowEnabled('iknow_nightly_enabled'))) {
    logger.debug('[WebthronSync] Rilettura notturna disabilitata — skip');
    return 0;
  }

  startRun('sync_full_day');
  try {
    const n = await loadDayIntoHistory(dateStr);
    endRun('sync_full_day', n);
    return n;
  } catch (err) {
    failRun('sync_full_day', err);
    logger.error(`[FullDaySync] Errore per ${dateStr}: ${err}`);
    return 0;
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
  if (!(await isIKnowEnabled('iknow_lookup_enabled'))) {
    logger.debug('[LookupRefresh] Aggiornamento fasi/combos disabilitato — skip');
    return;
  }

  const TIMEOUT = 30 * 1000;   // rete di sicurezza lato client; il limite vero è max_statement_time
  const pool = getWebthronPool();

  startRun('lookup_refresh');
  try {
    logger.info('[LookupRefresh] Aggiornamento fasi e combos da WebThron...');

    // Rebanadine di 7 giorni sull'indice di datain (invece di una query unica sui 90 giorni, che
    // faceva scorrere milioni di righe dell'indice tipdoc). La guardia mette una pausa tra l'una e l'altra.
    // Gli estremi sono interi calcolati qui: si scrivono nella query senza placeholder.
    const rows: Array<{ fase: string; modello: string; componente: string }> = [];
    for (let offset = 0; offset < LOOKUP_DAYS; offset += LOOKUP_SLICE_DAYS) {
      const oldest = Math.min(offset + LOOKUP_SLICE_DAYS, LOOKUP_DAYS);
      const [part] = await (pool as any).execute({
        sql: `
          SELECT DISTINCT
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
          WHERE ubi.tipdoc IN ('0080','1520','5004','5005','5006','5007','5010','5016','PX01','0160','0090','5019','1040','5009','5018','0480','5020')
            AND ubi.datain >  NOW() - INTERVAL ${oldest} DAY
            AND ubi.datain <= NOW() - INTERVAL ${offset} DAY
            AND ikExtra62Tab.stringa IS NOT NULL
            AND ikExtra43Tab.stringa IS NOT NULL
            AND ikExtra45Tab.stringa IS NOT NULL
          LIMIT 10000
        `,
        timeout: TIMEOUT,
      }) as [Array<{ fase: string; modello: string; componente: string }>];
      rows.push(...part);
    }

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
