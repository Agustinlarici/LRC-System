import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { getDeliberaFasi, getExecutiveCache } from '../monitor/executive-cache.js';
import {
  computeHourlyCells,
  computeCellOee,
  romeOffsetForDate,
  OeeHourCell,
  snapshotDayFromHistory,
  queryWebthronRange,
} from './heatmap.js';
import type { WebthronEvent as HeatmapWebthronRow } from '../monitor/mysql-client.js';
import { getAvailableFasi, getAvailableComponenti, computeLeadTime, SPMA_PIANO_FASE } from './lead-time.js';
import { logger } from '../../lib/logger.js';

export const dashboardsRoutes = new Hono();

// Mutex: una sola query heatmap alla volta su WebThron (MyISAM → read lock)
let heatmapRunning = false;

// ─── Backfill state ───────────────────────────────────────────────────────────
let backfillRunning = false;
let backfillStatus: { done: number; total: number; current: string; errors: string[] } | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

function parseDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HTTPException(400, { message: 'Data non valida' });
  return raw;
}

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

// ─── GET /heatmap?year=2026&month=3 ──────────────────────────────────────────
// Returns hourly OEE matrix: cells per (linea_id × data × ora).
// - Days > 7 days ago → served from monitor_oee_hourly snapshot table.
//   Missing snapshots (first load) fall back to on-demand Webthron + async save.
// - Last 7 days → always computed on-demand from Webthron.

dashboardsRoutes.get('/heatmap', async (c) => {
  if (heatmapRunning) {
    return c.json({ error: 'Heatmap già in elaborazione, riprovare tra qualche secondo' }, 429);
  }
  heatmapRunning = true;
  try {
  const year  = parseInt(c.req.query('year')  ?? '', 10);
  const month = parseInt(c.req.query('month') ?? '', 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    throw new HTTPException(400, { message: 'Parametri year/month non validi' });
  }

  const pad      = (n: number) => String(n).padStart(2, '0');
  const lastDay  = new Date(year, month, 0).getDate();
  const todayStr = todayRome();

  const allDays: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${year}-${pad(month)}-${pad(d)}`;
    if (ds <= todayStr) allDays.push(ds);
  }

  const pastDays  = allDays.filter(d => d < todayStr);
  const showToday = allDays.includes(todayStr);

  const linee = await db`
    SELECT
      ml.id, ml.nome, ml.fase,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('modello', mlc.modello, 'componente', mlc.componente))
          FILTER (WHERE mlc.id IS NOT NULL), '[]'::json
      ) AS combos
    FROM monitor_linea ml
    LEFT JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
    GROUP BY ml.id, ml.nome, ml.fase
    ORDER BY ml.nome
  `;

  const cells: OeeHourCell[] = [];

  // ── Giorni passati → monitor_oee_hourly (PostgreSQL, nessuna query WebThron) ──
  if (pastDays.length > 0) {
    // Find which days are missing from the snapshot table
    const existingDays = new Set(
      (await db`
        SELECT DISTINCT data::text AS data FROM monitor_oee_hourly
        WHERE data BETWEEN ${pastDays[0]}::date AND ${pastDays[pastDays.length - 1]}::date
      `).map(r => (r.data as string).slice(0, 10))
    );

    // For missing days with history data, compute from history (no WebThron)
    const missingDays = pastDays.filter(d => !existingDays.has(d));
    if (missingDays.length > 0) {
      const historyDates = new Set(
        (await db`
          SELECT DISTINCT data_cache::text AS d FROM webthron_events_history
          WHERE data_cache BETWEEN ${pastDays[0]}::date AND ${pastDays[pastDays.length - 1]}::date
        `).map(r => (r.d as string).slice(0, 10))
      );
      for (const day of missingDays) {
        if (historyDates.has(day)) {
          try {
            await snapshotDayFromHistory(day);
          } catch (e) {
            logger.warn(`[Heatmap] snapshotDayFromHistory ${day} failed: ${e}`);
          }
        }
      }
    }

    const snapRows = await db`
      SELECT
        linea_id, data::text AS data, ora,
        pezzi_reali, pezzi_attesi, minuti_fermo, fermi_count,
        disponibilita::float AS disponibilita,
        performance::float   AS performance,
        oee::float           AS oee,
        has_data
      FROM monitor_oee_hourly
      WHERE data BETWEEN ${pastDays[0]}::date AND ${pastDays[pastDays.length - 1]}::date
      ORDER BY data, linea_id, ora
    `;
    for (const r of snapRows) {
      cells.push({
        linea_id:      r.linea_id     as number,
        data:          (r.data as string).slice(0, 10),
        ora:           r.ora          as number,
        pezzi_reali:   r.pezzi_reali  as number,
        pezzi_attesi:  r.pezzi_attesi as number,
        minuti_fermo:  r.minuti_fermo as number,
        fermi_count:   r.fermi_count  as number,
        disponibilita: Number(r.disponibilita),
        performance:   Number(r.performance),
        oee:           Number(r.oee),
        has_data:      r.has_data     as boolean,
      });
    }
  }

  // ── Oggi → executive cache in memoria (zero query WebThron, zero query PostgreSQL) ──
  if (showToday) {
    const cacheRows: HeatmapWebthronRow[] = getExecutiveCache()?.rows ?? [];

    const [turni, quantita, pause] = await Promise.all([
      db`SELECT linea_id,
                SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_turno,
                MIN(ora_inizio::text) AS turno_inizio,
                MAX(ora_fine::text)   AS turno_fine
         FROM monitor_turno WHERE data = CURRENT_DATE GROUP BY linea_id`,
      db`SELECT linea_id, quantita_giornaliera FROM monitor_quantita_giorno WHERE data = CURRENT_DATE`,
      db`SELECT linea_id,
                SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_pausa
         FROM monitor_pausa WHERE data = CURRENT_DATE GROUP BY linea_id`,
    ]);

    for (const l of linee) {
      const tRow = turni.find(t => t.linea_id === l.id);
      const qRow = quantita.find(q => q.linea_id === l.id);
      const pRow = pause.find(p => p.linea_id === l.id);
      const pgDay = {
        minuti_turno:      tRow ? Number(tRow.minuti_turno) : 0,
        minuti_pausa:      pRow ? Number(pRow.minuti_pausa) : 0,
        pezzi_pianificati: qRow ? Number(qRow.quantita_giornaliera) : 0,
        turno_inizio:      tRow ? (tRow.turno_inizio as string) : null,
        turno_fine:        tRow ? (tRow.turno_fine   as string) : null,
      };
      const combos = l.combos as Array<{ modello: string; componente: string }>;
      const hCells = computeHourlyCells(l.id as number, l.fase as string, combos, pgDay, cacheRows, todayStr);
      cells.push(...hCells.filter(c => c.has_data));
    }
  }

  // ── Daily OEE (for "Giorno" view — same source as tendenze settimanali) ──────
  const dailyRows = pastDays.length > 0 ? await db`
    SELECT linea_id, data::text AS data, oee::float AS oee,
           pezzi_reali, pezzi_pianificati, disponibilita::float, performance::float, qualita::float
    FROM monitor_oee_daily
    WHERE data BETWEEN ${pastDays[0]}::date AND ${pastDays[pastDays.length - 1]}::date
    ORDER BY data, linea_id
  ` : [];

  const dailyCells = dailyRows.map(r => ({
    linea_id:       r.linea_id      as number,
    data:           (r.data as string).slice(0, 10),
    oee:            Number(r.oee),
    pezzi_reali:    r.pezzi_reali   as number,
    pezzi_pianificati: r.pezzi_pianificati as number,
    disponibilita:  Number(r.disponibilita),
    performance:    Number(r.performance),
    qualita:        Number(r.qualita),
  }));

  return c.json({
    year, month,
    linee: linee.map(l => ({ id: l.id as number, nome: l.nome as string })),
    days:  Array.from({ length: lastDay }, (_, i) => i + 1),
    cells,
    dailyCells,
  });
  } finally {
    heatmapRunning = false;
  }
});

// ─── GET /heatmap/detail/:lineaId/:data ───────────────────────────────────────

dashboardsRoutes.get('/heatmap/detail/:lineaId/:data', async (c) => {
  const lineaId      = parseId(c.req.param('lineaId'));
  const dateStr      = parseDate(c.req.param('data'));
  const deliberaFasi = getDeliberaFasi();

  const [linea] = await db`SELECT id, nome, fase FROM monitor_linea WHERE id = ${lineaId} AND attivo = true`;
  if (!linea) throw new HTTPException(404, { message: 'Linea non trovata' });

  const combos = await db`SELECT modello, componente FROM monitor_linea_combo WHERE linea_id = ${lineaId}`;

  const todayStr = todayRome();

  // ── Giorni passati → monitor_oee_daily (PostgreSQL, nessuna query WebThron) ──
  if (dateStr < todayStr) {
    const [daily] = await db`
      SELECT pezzi_reali, pezzi_pianificati, pezzi_conformi, pezzi_deliberati,
             minuti_turno, minuti_fermo, fermi_count,
             disponibilita::float, performance::float, qualita::float, oee::float, has_data
      FROM monitor_oee_daily
      WHERE linea_id = ${lineaId} AND data = ${dateStr}::date
    `;
    return c.json({
      linea_id:          lineaId,
      data:              dateStr,
      nome:              linea.nome as string,
      pezzi_reali:       daily ? Number(daily.pezzi_reali)       : 0,
      pezzi_pianificati: daily ? Number(daily.pezzi_pianificati) : 0,
      pezzi_conformi:    daily ? Number(daily.pezzi_conformi)    : 0,
      pezzi_deliberati:  daily ? Number(daily.pezzi_deliberati)  : 0,
      minuti_turno:      daily ? Number(daily.minuti_turno)      : 0,
      minuti_fermo:      daily ? Number(daily.minuti_fermo)      : 0,
      fermi_count:       daily ? Number(daily.fermi_count)       : 0,
      disponibilita:     daily ? Number(daily.disponibilita)     : 0,
      performance:       daily ? Number(daily.performance)       : 0,
      qualita:           daily ? Number(daily.qualita)           : 0,
      oee:               daily ? Number(daily.oee)              : 0,
      has_data:          daily ? Boolean(daily.has_data)         : false,
      fermate:           [],  // non disponibili per giorni già chiusi
    });
  }

  // ── Oggi → executive cache in memoria (zero query WebThron) ──
  const [[tRow], [qRow], [pRow]] = await Promise.all([
    db`SELECT SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_turno,
              MIN(ora_inizio::text) AS turno_inizio
       FROM monitor_turno WHERE linea_id = ${lineaId} AND data = CURRENT_DATE`,
    db`SELECT quantita_giornaliera FROM monitor_quantita_giorno WHERE linea_id = ${lineaId} AND data = CURRENT_DATE`,
    db`SELECT SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_pausa
       FROM monitor_pausa WHERE linea_id = ${lineaId} AND data = CURRENT_DATE`,
  ]);

  const pgDay = {
    minuti_turno:      tRow?.minuti_turno ? Number(tRow.minuti_turno) : 0,
    minuti_pausa:      pRow?.minuti_pausa ? Number(pRow.minuti_pausa) : 0,
    pezzi_pianificati: qRow ? Number(qRow.quantita_giornaliera) : 0,
    turno_inizio:      (tRow?.turno_inizio ?? null) as string | null,
  };

  const webthronRows: HeatmapWebthronRow[] = getExecutiveCache()?.rows ?? [];

  const cell = computeCellOee(
    lineaId, linea.fase as string,
    combos as unknown as Array<{ modello: string; componente: string }>,
    pgDay, webthronRows, dateStr, deliberaFasi,
  );

  // Fermate — disponibili solo per oggi (abbiamo i timestamp individuali)
  type Fermata = { inizio: string; fine: string; durata_min: number };
  const fermate: Fermata[] = [];
  const net_planned  = Math.max(1, pgDay.minuti_turno - pgDay.minuti_pausa);
  const cycleTimeSec = pgDay.minuti_turno > 0 && pgDay.pezzi_pianificati > 0
    ? Math.round(net_planned * 60 / pgDay.pezzi_pianificati)
    : null;

  if (cycleTimeSec && pgDay.turno_inizio) {
    const combosSet = new Set(combos.map(c => `${c.modello}|${c.componente}`));
    const prodTs = webthronRows
      .filter(r => r.fase === (linea.fase as string) && combosSet.has(`${r.modello}|${r.componente}`))
      .map(r => r.data_inserimento)
      .sort((a, b) => a.getTime() - b.getTime());

    const offset       = romeOffsetForDate(dateStr);
    const turnoStartTs = new Date(`${dateStr}T${pgDay.turno_inizio.slice(0, 5)}:00+${offset}`);

    if (prodTs.length > 0) {
      const gapStart = (prodTs[0].getTime() - turnoStartTs.getTime()) / 1000;
      if (gapStart > cycleTimeSec) {
        fermate.push({ inizio: new Date(turnoStartTs.getTime() + cycleTimeSec * 1000).toISOString(), fine: prodTs[0].toISOString(), durata_min: Math.round((gapStart - cycleTimeSec) / 60) });
      }
      for (let i = 1; i < prodTs.length; i++) {
        const gap = (prodTs[i].getTime() - prodTs[i - 1].getTime()) / 1000;
        if (gap > cycleTimeSec) {
          fermate.push({ inizio: new Date(prodTs[i - 1].getTime() + cycleTimeSec * 1000).toISOString(), fine: prodTs[i].toISOString(), durata_min: Math.round((gap - cycleTimeSec) / 60) });
        }
      }
    }
  }

  return c.json({ ...cell, nome: linea.nome as string, fermate });
});

// ─── POST /heatmap/backfill?from=YYYY-MM-DD&to=YYYY-MM-DD ────────────────────
// Popola monitor_oee_hourly e monitor_oee_daily per i giorni mancanti.
// Un giorno alla volta, con 2 min di pausa tra ogni giorno → nessun blocco prolungato.
// Risponde subito (202) e gira in background.

dashboardsRoutes.post('/heatmap/backfill', async (c) => {
  if (backfillRunning) {
    return c.json({ error: 'Backfill già in corso', status: backfillStatus }, 409);
  }

  const fromStr = c.req.query('from');
  const toStr   = c.req.query('to');
  if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    throw new HTTPException(400, { message: 'Parametri from/to richiesti (YYYY-MM-DD)' });
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  if (fromStr >= todayStr || toStr >= todayStr) {
    throw new HTTPException(400, { message: 'Il backfill è solo per giorni passati (< oggi)' });
  }

  // Calcola i giorni nel range
  const days: string[] = [];
  const cur = new Date(`${fromStr}T12:00:00Z`);
  const end = new Date(`${toStr}T12:00:00Z`);
  while (cur <= end) {
    const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(cur);
    if (ds < todayStr) days.push(ds);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (days.length === 0) {
    throw new HTTPException(400, { message: 'Nessun giorno valido nel range' });
  }

  // Avvia in background
  backfillRunning = true;
  backfillStatus  = { done: 0, total: days.length, current: '', errors: [] };

  (async () => {
    for (const day of days) {
      backfillStatus!.current = day;
      try {
        // Salta se già presente in monitor_oee_hourly
        const [existing] = await db`
          SELECT 1 FROM monitor_oee_hourly WHERE data = ${day}::date LIMIT 1
        `;
        if (existing) {
          logger.info(`[Backfill] ${day} già presente — skip`);
          backfillStatus!.done++;
          continue;
        }

        logger.info(`[Backfill] Snapshot ${day}...`);
        await snapshotDayFromHistory(day);
        backfillStatus!.done++;
        logger.info(`[Backfill] ${day} completato (${backfillStatus!.done}/${backfillStatus!.total})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[Backfill] Errore ${day}: ${msg}`);
        backfillStatus!.errors.push(`${day}: ${msg}`);
        backfillStatus!.done++;
      }
    }
    backfillRunning         = false;
    backfillStatus!.current = '';
    logger.info(`[Backfill] Completato — ${backfillStatus!.done} giorni processati, ${backfillStatus!.errors.length} errori`);
  })();

  return c.json({ message: 'Backfill avviato', days: days.length, from: fromStr, to: toStr }, 202);
});

// ─── GET /heatmap/backfill ────────────────────────────────────────────────────
// Stato del backfill in corso.

dashboardsRoutes.get('/heatmap/backfill', async (c) => {
  return c.json({
    running: backfillRunning,
    status:  backfillStatus,
  });
});

// ─── Lead Time ────────────────────────────────────────────────────────────────

// ─── POST /lead-time/backfill?from=YYYY-MM-DD&to=YYYY-MM-DD ──────────────────
// Popola webthron_events_history per i giorni nel range.
// Un giorno alla volta con pausa configurabile → nessun blocco prolungato su WebThron.
// Risponde 202 subito; stato leggibile via GET /lead-time/backfill.

let historyBackfillRunning = false;
let historyBackfillStatus: { done: number; total: number; current: string; errors: string[] } | null = null;

dashboardsRoutes.post('/lead-time/backfill', async (c) => {
  if (historyBackfillRunning) {
    return c.json({ error: 'Backfill già in corso', status: historyBackfillStatus }, 409);
  }

  const fromStr  = c.req.query('from');
  const toStr    = c.req.query('to');
  const pauseSec = Math.max(30, parseInt(c.req.query('pause_sec') ?? '120', 10)); // default 2 min
  const force    = c.req.query('force') === 'true'; // bypass completeness check

  if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    throw new HTTPException(400, { message: 'Parametri from/to richiesti (YYYY-MM-DD)' });
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

  // Build day list (today is allowed — served from local cache, not MySQL)
  const days: string[] = [];
  const cur = new Date(`${fromStr}T12:00:00Z`);
  const end = new Date(`${toStr}T12:00:00Z`);
  while (cur <= end) {
    const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(cur);
    if (ds <= todayStr) days.push(ds);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  if (days.length === 0) throw new HTTPException(400, { message: 'Nessun giorno valido nel range' });

  // Ensure history table exists (run migration if needed)
  await db`
    CREATE TABLE IF NOT EXISTS webthron_events_history (
      id               SERIAL       PRIMARY KEY,
      fase             VARCHAR(200) NOT NULL,
      modello          VARCHAR(200) NOT NULL,
      componente       VARCHAR(200) NOT NULL,
      cod_seriale      VARCHAR(200) NOT NULL,
      esito_delibera   VARCHAR(200),
      data_inserimento TIMESTAMPTZ  NOT NULL,
      data_cache       DATE         NOT NULL
    )
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weh_dedup
      ON webthron_events_history (fase, cod_seriale, data_inserimento)
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_weh_data_cache ON webthron_events_history (data_cache)`;
  await db`CREATE INDEX IF NOT EXISTS idx_weh_seriale_fase ON webthron_events_history (cod_seriale, fase)`;
  await db`CREATE INDEX IF NOT EXISTS idx_weh_fase_componente ON webthron_events_history (fase, componente)`;

  historyBackfillRunning = true;
  historyBackfillStatus  = { done: 0, total: days.length, current: '', errors: [] };

  type LineaCombo = { fase: string; modello: string; componente: string };
  const combos = (await db`
    SELECT DISTINCT ml.fase, mlc.modello, mlc.componente
    FROM monitor_linea ml
    JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
  `) as unknown as LineaCombo[];
  const deliberaFasi = (process.env.DELIBERA_FASI ?? 'DELIBERA FINALE,DELIBERA FINALE PROX')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (combos.length === 0) {
    historyBackfillRunning = false;
    return c.json({ message: 'Nessuna linea attiva configurata', days: 0 }, 200);
  }

  (async () => {
    for (const day of days) {
      historyBackfillStatus!.current = day;
      try {
        // Skip only if all records for this day already have commessa populated
        const [existing] = await db`
          SELECT
            COUNT(*)::int         AS n,
            COUNT(commessa)::int  AS with_commessa
          FROM webthron_events_history
          WHERE data_cache = ${day}::date
        `;
        if (!force && existing && (existing.n as number) > 0 && (existing.n as number) === (existing.with_commessa as number)) {
          logger.info(`[HistoryBackfill] ${day} già completo (${existing.n} eventi con commessa) — skip`);
          historyBackfillStatus!.done++;
          continue;
        }

        let insertedCount = 0;
        if (day === todayStr) {
          // Today: copy from local cache — no MySQL query needed
          const result = await db`
            INSERT INTO webthron_events_history (fase, modello, componente, cod_seriale, commessa, esito_delibera, data_inserimento, data_cache)
            SELECT fase, modello, componente, cod_seriale, commessa, esito_delibera, data_inserimento, ${day}::date
            FROM webthron_prod_cache
            WHERE data_cache = ${day}::date
            ON CONFLICT (fase, cod_seriale, data_inserimento) DO NOTHING
          `;
          insertedCount = result.count;
          logger.info(`[HistoryBackfill] ${day} (da cache locale) — +${insertedCount} eventi`);
        } else {
          // Past day: query MySQL (lightweight — one day, timeout, zombie protections in place)
          const rows = await queryWebthronRange(
            day, day,
            combos as Array<{ fase: string; modello: string; componente: string }>,
            deliberaFasi,
          );
          if (rows.length > 0) {
            const records = rows.map((r: HeatmapWebthronRow) => ({
              fase:             r.fase,
              modello:          r.modello,
              componente:       r.componente,
              cod_seriale:      r.cod_seriale,
              commessa:         r.commessa ?? null,
              esito_delibera:   r.esito_delibera ?? null,
              data_inserimento: r.data_inserimento,
              data_cache:       day,
            }));
            const result = await db`
              INSERT INTO webthron_events_history ${db(records)}
              ON CONFLICT (fase, cod_seriale, data_inserimento)
              DO UPDATE SET commessa = EXCLUDED.commessa
              WHERE webthron_events_history.commessa IS NULL
            `;
            insertedCount = result.count;
          }
          logger.info(`[HistoryBackfill] ${day} — +${insertedCount} eventi`);
        }

        historyBackfillStatus!.done++;
      } catch (err) {
        const msg = `${day}: ${(err as Error).message}`;
        historyBackfillStatus!.errors.push(msg);
        logger.error(`[HistoryBackfill] ${msg}`);
        historyBackfillStatus!.done++;
      }

      if (historyBackfillStatus!.done < days.length) {
        await new Promise(r => setTimeout(r, pauseSec * 1000));
      }
    }
    historyBackfillRunning = false;
    historyBackfillStatus!.current = '';
    logger.info(`[HistoryBackfill] Completato — ${historyBackfillStatus!.done} giorni, ${historyBackfillStatus!.errors.length} errori`);
  })();

  return c.json({ message: 'Backfill avviato', days: days.length, from: fromStr, to: toStr, pause_sec: pauseSec }, 202);
});

dashboardsRoutes.get('/lead-time/backfill', async (c) => {
  return c.json({ running: historyBackfillRunning, status: historyBackfillStatus });
});

// ─── POST /lead-time/patch-commessa?date=YYYY-MM-DD ───────────────────────────
// Queries MySQL for (cod_seriale, commessa, data_inserimento) for a single day,
// then UPDATE webthron_events_history SET commessa WHERE commessa IS NULL.
// Lightweight — only 3 fields, no combo conditions.
// Does NOT trigger or depend on the iKnow Andon sync scheduler.

dashboardsRoutes.post('/lead-time/patch-commessa', async (c) => {
  const dateStr = c.req.query('date');
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new HTTPException(400, { message: 'Parametro date richiesto (YYYY-MM-DD)' });
  }

  // Check how many rows need patching
  const [need] = await db`
    SELECT COUNT(*)::int AS n
    FROM webthron_events_history
    WHERE data_cache = ${dateStr}::date AND commessa IS NULL
  `;
  const toFix = (need?.n as number) ?? 0;
  if (toFix === 0) {
    return c.json({ message: `Nessuna riga da aggiornare per ${dateStr}`, updated: 0 });
  }

  // Minimal MySQL query — only the fields needed to patch commessa.
  // No combo filter (no model/component conditions) — just date + NOT NULL guards.
  // MAX_EXECUTION_TIME(60000) = 1 min server-side kill.
  // Driver timeout: 90 sec. Connection pool: limit 2, wait_timeout=300.
  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(60000) */
      Extra186.stringa AS cod_seriale,
      Extra30.stringa  AS commessa,
      ubi.datain       AS data_inserimento
    FROM ubidocum ubi
    LEFT JOIN ikExtra Extra186 ON ubi.iddocu = Extra186.iddocu AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
    LEFT JOIN ikExtra Extra30  ON ubi.iddocu = Extra30.iddocu  AND Extra30.idcampo  = 30  AND Extra30.idcomm  = 0 AND Extra30.seq  = 0
    WHERE ubi.tipdoc IN ('0080','1520','5004','5005','5006','5007','5010','5016','PX01','0160','0090','5019','1040','5009','5018','0480')
      AND DATE(CONVERT_TZ(ubi.datain, '+00:00', '+01:00')) = ?
      AND Extra186.stringa IS NOT NULL
      AND Extra30.stringa  IS NOT NULL
    LIMIT 50000
  `;

  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  const [rows] = await getWebthronPool().execute(
    { sql, timeout: 90_000 },
    [dateStr],
  ) as [Array<{ cod_seriale: string; commessa: string; data_inserimento: Date }>, unknown];

  if (rows.length === 0) {
    return c.json({ message: `Nessun evento trovato su WebThron per ${dateStr}`, updated: 0 });
  }

  // Bulk UPDATE using unnest arrays — single query, no nested template issues
  const codSeriali    = rows.map(r => r.cod_seriale);
  const commesse      = rows.map(r => r.commessa);
  const dataInserimenti = rows.map(r => r.data_inserimento);

  const result = await db`
    UPDATE webthron_events_history AS h
    SET commessa = v.commessa
    FROM unnest(
      ${db.array(codSeriali)}::text[],
      ${db.array(commesse)}::text[],
      ${db.array(dataInserimenti)}::timestamptz[]
    ) AS v(cod_seriale, commessa, data_inserimento)
    WHERE h.cod_seriale      = v.cod_seriale
      AND h.data_inserimento = v.data_inserimento
      AND h.commessa IS NULL
  `;
  const updated = result.count;

  logger.info(`[PatchCommessa] ${dateStr} — aggiornate ${updated}/${toFix} righe`);
  return c.json({ message: `Patch completato per ${dateStr}`, updated, total_mysql: rows.length });
});

// GET /lead-time/models — distinct model_code values in spma_commessa
dashboardsRoutes.get('/lead-time/models', async (c) => {
  const rows = await db`
    SELECT DISTINCT model_code FROM spma_commessa WHERE model_code IS NOT NULL ORDER BY model_code
  `;
  return c.json(rows.map(r => r.model_code as string));
});

// GET /lead-time/fasi — distinct fasi available in history
dashboardsRoutes.get('/lead-time/fasi', async (c) => {
  const fasi = await getAvailableFasi();
  return c.json(fasi);
});

// GET /lead-time/componenti — distinct componenti in history
dashboardsRoutes.get('/lead-time/componenti', async (c) => {
  const comp = await getAvailableComponenti();
  return c.json(comp);
});

// GET /lead-time?fase_a=X&fase_b=Y&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&category_id=N[&line_id=N]
// category_id: SPMA component_category_id — resolved to iKnow componente names via spma_componente_map
dashboardsRoutes.get('/lead-time', async (c) => {
  const fase_a      = c.req.query('fase_a')      ?? '';
  const fase_b      = c.req.query('fase_b')      ?? '';
  const date_from   = c.req.query('date_from')   ?? '';
  const date_to     = c.req.query('date_to')     ?? '';
  const category_id = c.req.query('category_id') ? parseInt(c.req.query('category_id')!, 10) : undefined;
  const line_id     = c.req.query('line_id')     ? parseInt(c.req.query('line_id')!,     10) : undefined;

  if (!fase_a || !fase_b || !date_from || !date_to) {
    throw new HTTPException(400, { message: 'fase_a, fase_b, date_from, date_to richiesti' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
    throw new HTTPException(400, { message: 'date_from e date_to devono essere YYYY-MM-DD' });
  }
  if (!category_id) {
    throw new HTTPException(400, { message: 'category_id richiesto' });
  }

  // Resolve iKnow componente names for this SPMA category
  // (not needed when both fasi are SPMA_PIANO, but always load for filtering WebThron events)
  const mappings = await db`
    SELECT componente_iknow
    FROM spma_componente_map
    WHERE component_category_id = ${category_id} AND active = TRUE
  `;
  const componenteNames = mappings.map(r => r.componente_iknow as string);

  // Warn only when a WebThron fase is selected but no mapping exists
  const needsMapping = fase_a !== SPMA_PIANO_FASE || fase_b !== SPMA_PIANO_FASE;
  if (needsMapping && componenteNames.length === 0) {
    return c.json({ points: [], count: 0, warning: `Nessuna equivalenza iKnow configurata per la categoria ${category_id}. Aggiungila nella sezione "Equivalenze" sopra.` });
  }

  const points = await computeLeadTime({ fase_a, fase_b, date_from, date_to, category_id, componenteNames, line_id });
  return c.json({ points, count: points.length });
});

// GET /lead-time/zones?category_id=N&fase_a=X&fase_b=Y
dashboardsRoutes.get('/lead-time/zones', async (c) => {
  const category_id = c.req.query('category_id') ? parseInt(c.req.query('category_id')!, 10) : undefined;
  const fase_a      = c.req.query('fase_a') ?? '';
  const fase_b      = c.req.query('fase_b') ?? '';
  if (!category_id || !fase_a || !fase_b) {
    throw new HTTPException(400, { message: 'category_id, fase_a, fase_b richiesti' });
  }
  const rows = await db`
    SELECT verde_max, amarillo_max, direction
    FROM lead_time_zones
    WHERE category_id = ${category_id} AND fase_a = ${fase_a} AND fase_b = ${fase_b}
  `;
  if (!rows[0]) return c.json(null);
  return c.json({
    verde_max:    parseFloat(rows[0].verde_max as string),
    amarillo_max: parseFloat(rows[0].amarillo_max as string),
    direction:    rows[0].direction as string,
  });
});

// PUT /lead-time/zones
dashboardsRoutes.put('/lead-time/zones', async (c) => {
  const body = await c.req.json();
  const { category_id, fase_a, fase_b, verde_max, amarillo_max, direction } = body;
  if (!category_id || !fase_a || !fase_b || verde_max == null || amarillo_max == null) {
    throw new HTTPException(400, { message: 'category_id, fase_a, fase_b, verde_max, amarillo_max richiesti' });
  }
  if (Number(verde_max) >= Number(amarillo_max)) {
    throw new HTTPException(400, { message: 'La soglia verde deve essere minore della soglia gialla' });
  }
  const dir = direction === 'higher_better' ? 'higher_better' : 'higher_worse';
  const rows = await db`
    INSERT INTO lead_time_zones (category_id, fase_a, fase_b, verde_max, amarillo_max, direction, updated_at)
    VALUES (${category_id}, ${fase_a}, ${fase_b}, ${Number(verde_max)}, ${Number(amarillo_max)}, ${dir}, NOW())
    ON CONFLICT (category_id, fase_a, fase_b) DO UPDATE
      SET verde_max    = EXCLUDED.verde_max,
          amarillo_max = EXCLUDED.amarillo_max,
          direction    = EXCLUDED.direction,
          updated_at   = NOW()
    RETURNING verde_max, amarillo_max, direction
  `;
  return c.json({
    verde_max:    parseFloat(rows[0].verde_max as string),
    amarillo_max: parseFloat(rows[0].amarillo_max as string),
    direction:    rows[0].direction as string,
  });
});

// ─── GET /daily-oee?days=60 ───────────────────────────────────────────────────
// Storico giornaliero da monitor_oee_daily (PostgreSQL only, nessuna query
// WebThron). Ritorna una riga per (linea × giorno) con OEE, disponibilità,
// performance, qualità, produzione reale vs piano e fermate.

function parseIdList(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const ids = raw.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  return ids.length > 0 ? ids : null;
}

function parseStringList(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

dashboardsRoutes.get('/daily-oee', async (c) => {
  const days     = Math.min(180, Math.max(1, parseInt(c.req.query('days') ?? '60', 10)));
  const lineaIds = parseIdList(c.req.query('linea_ids'));

  const lineaFilter = lineaIds ? db`AND d.linea_id = ANY(${lineaIds})` : db``;

  const rows = await db`
    SELECT
      d.linea_id,
      ml.nome,
      TO_CHAR(d.data, 'YYYY-MM-DD') AS data,
      d.pezzi_reali,
      d.pezzi_pianificati,
      d.pezzi_deliberati,
      d.pezzi_conformi,
      d.minuti_turno,
      d.minuti_fermo,
      d.fermi_count,
      d.disponibilita,
      d.performance,
      d.qualita,
      d.oee
    FROM monitor_oee_daily d
    JOIN monitor_linea ml ON ml.id = d.linea_id AND ml.attivo = true
    WHERE d.data >= CURRENT_DATE - (${days})::integer
      AND d.pezzi_reali > 0
      ${lineaFilter}
    ORDER BY ml.nome, d.data
  `;

  return c.json({
    days,
    data: rows.map(r => ({
      linea_id:          r.linea_id          as number,
      nome:              r.nome              as string,
      data:              (r.data as string).slice(0, 10),
      pezzi_reali:       Number(r.pezzi_reali),
      pezzi_pianificati: Number(r.pezzi_pianificati),
      pezzi_deliberati:  Number(r.pezzi_deliberati),
      pezzi_conformi:    Number(r.pezzi_conformi),
      minuti_turno:      Number(r.minuti_turno),
      minuti_fermo:      Number(r.minuti_fermo),
      fermi_count:       Number(r.fermi_count),
      disponibilita:     r.disponibilita != null ? Number(r.disponibilita) : null,
      performance:       r.performance   != null ? Number(r.performance)   : null,
      qualita:           r.qualita       != null ? Number(r.qualita)       : null,
      oee:               r.oee           != null ? Number(r.oee)           : null,
    })),
  });
});

// ─── GET /stop-pareto?days=60 ─────────────────────────────────────────────────
// Analisi Pareto delle fermate: minuti persi totali per motivo e per linea nel
// periodo, ordinati decrescente — per capire dove intervenire prima.

dashboardsRoutes.get('/stop-pareto', async (c) => {
  const days     = Math.min(180, Math.max(1, parseInt(c.req.query('days') ?? '60', 10)));
  const lineaIds = parseIdList(c.req.query('linea_ids'));

  const lineaFilterE = lineaIds ? db`AND e.linea_id = ANY(${lineaIds})` : db``;

  const [byReason, byLinea] = await Promise.all([
    db`
      SELECT
        COALESCE(r.id, 0)                        AS reason_id,
        COALESCE(r.descrizione, 'Non classificato') AS descrizione,
        COALESCE(cat.nome, 'Non classificato')      AS categoria,
        COALESCE(cat.colore, '#9ca3af')             AS colore,
        SUM(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at)) / 60)::int AS minuti_totali,
        COUNT(*)::int AS eventi_count
      FROM monitor_stop_events e
      LEFT JOIN monitor_stop_reasons r    ON r.id = e.reason_id
      LEFT JOIN monitor_stop_categories cat ON cat.id = r.category_id
      WHERE e.started_at >= NOW() - (${days} * INTERVAL '1 day')
      ${lineaFilterE}
      GROUP BY r.id, r.descrizione, cat.nome, cat.colore
      ORDER BY minuti_totali DESC
    `,
    db`
      SELECT
        e.linea_id,
        l.nome,
        SUM(EXTRACT(EPOCH FROM (COALESCE(e.ended_at, NOW()) - e.started_at)) / 60)::int AS minuti_totali,
        COUNT(*)::int AS eventi_count
      FROM monitor_stop_events e
      JOIN monitor_linea l ON l.id = e.linea_id
      WHERE e.started_at >= NOW() - (${days} * INTERVAL '1 day')
      ${lineaFilterE}
      GROUP BY e.linea_id, l.nome
      ORDER BY minuti_totali DESC
    `,
  ]);

  return c.json({
    days,
    by_reason: byReason.map(r => ({
      reason_id:     Number(r.reason_id),
      descrizione:   r.descrizione as string,
      categoria:     r.categoria   as string,
      colore:        r.colore      as string,
      minuti_totali: Number(r.minuti_totali),
      eventi_count:  Number(r.eventi_count),
    })),
    by_linea: byLinea.map(r => ({
      linea_id:      r.linea_id as number,
      nome:          r.nome     as string,
      minuti_totali: Number(r.minuti_totali),
      eventi_count:  Number(r.eventi_count),
    })),
  });
});

// ─── GET /filter-options ──────────────────────────────────────────────────────
// Linee attive + combo (modello, componente) configurati — popola i filtri
// multi-selezione del dashboard tendenze.

dashboardsRoutes.get('/filter-options', async (c) => {
  const [linee, combos] = await Promise.all([
    db`SELECT id, nome FROM monitor_linea WHERE attivo = true ORDER BY nome`,
    db`SELECT DISTINCT linea_id, modello, componente FROM monitor_linea_combo ORDER BY modello, componente`,
  ]);

  const modelli    = [...new Set(combos.map(r => r.modello    as string))].sort();
  const componenti = [...new Set(combos.map(r => r.componente as string))].sort();

  return c.json({
    linee: linee.map(r => ({ id: r.id as number, nome: r.nome as string })),
    modelli,
    componenti,
    combos: combos.map(r => ({
      linea_id:   r.linea_id   as number,
      modello:    r.modello    as string,
      componente: r.componente as string,
    })),
  });
});

// ─── GET /daily-production-by-model?days=60 ───────────────────────────────────
// Pezzi reali per (linea × modello × componente × giorno), da
// webthron_events_history (copia locale PostgreSQL, nessuna query WebThron
// live). Conta solo gli eventi nella fase di produzione propria della linea
// (esclude gli eventi di delibera, che condividono la stessa storia).

dashboardsRoutes.get('/daily-production-by-model', async (c) => {
  const days        = Math.min(180, Math.max(1, parseInt(c.req.query('days') ?? '60', 10)));
  const lineaIds    = parseIdList(c.req.query('linea_ids'));
  const modelli     = parseStringList(c.req.query('modelli'));
  const componenti  = parseStringList(c.req.query('componenti'));

  const lineaFilter      = lineaIds    ? db`AND ml.id = ANY(${lineaIds})`             : db``;
  const modelliFilter    = modelli     ? db`AND weh.modello = ANY(${modelli})`        : db``;
  const componentiFilter = componenti  ? db`AND weh.componente = ANY(${componenti})`  : db``;

  const rows = await db`
    SELECT
      ml.id                AS linea_id,
      ml.nome               AS linea_nome,
      weh.modello,
      weh.componente,
      weh.data_cache::text  AS data,
      COUNT(*)::int         AS pezzi_reali
    FROM webthron_events_history weh
    JOIN monitor_linea ml       ON ml.fase = weh.fase AND ml.attivo = true
    JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id AND mlc.modello = weh.modello AND mlc.componente = weh.componente
    WHERE weh.data_cache >= CURRENT_DATE - (${days})::integer
      ${lineaFilter} ${modelliFilter} ${componentiFilter}
    GROUP BY ml.id, ml.nome, weh.modello, weh.componente, weh.data_cache
    ORDER BY weh.data_cache, ml.nome
  `;

  return c.json({
    days,
    data: rows.map(r => ({
      linea_id:    r.linea_id    as number,
      nome:        r.linea_nome  as string,
      modello:     r.modello     as string,
      componente:  r.componente  as string,
      data:        r.data        as string,
      pezzi_reali: Number(r.pezzi_reali),
    })),
  });
});

// DELETE /lead-time/zones?category_id=N&fase_a=X&fase_b=Y
dashboardsRoutes.delete('/lead-time/zones', async (c) => {
  const category_id = c.req.query('category_id') ? parseInt(c.req.query('category_id')!, 10) : undefined;
  const fase_a      = c.req.query('fase_a') ?? '';
  const fase_b      = c.req.query('fase_b') ?? '';
  if (!category_id || !fase_a || !fase_b) {
    throw new HTTPException(400, { message: 'category_id, fase_a, fase_b richiesti' });
  }
  await db`
    DELETE FROM lead_time_zones
    WHERE category_id = ${category_id} AND fase_a = ${fase_a} AND fase_b = ${fase_b}
  `;
  return c.json({ ok: true });
});
