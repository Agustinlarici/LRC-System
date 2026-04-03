import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { getDeliberaFasi, getExecutiveCache } from '../monitor/executive-cache.js';
import {
  computeHourlyCells,
  computeCellOee,
  romeOffsetForDate,
  OeeHourCell,
  HeatmapWebthronRow,
  snapshotDay,
} from './heatmap.js';
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

  return c.json({
    year, month,
    linee: linee.map(l => ({ id: l.id as number, nome: l.nome as string })),
    days:  Array.from({ length: lastDay }, (_, i) => i + 1),
    cells,
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
    const PAUSE_MS = 2 * 60 * 1000; // 2 min tra ogni giorno
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
        await snapshotDay(day);
        backfillStatus!.done++;
        logger.info(`[Backfill] ${day} completato (${backfillStatus!.done}/${backfillStatus!.total})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[Backfill] Errore ${day}: ${msg}`);
        backfillStatus!.errors.push(`${day}: ${msg}`);
        backfillStatus!.done++;
      }

      // Pausa solo se non è l'ultimo giorno
      if (backfillStatus!.done < days.length) {
        logger.info(`[Backfill] Pausa 2 min prima del prossimo giorno...`);
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }
    backfillRunning        = false;
    backfillStatus!.current = '';
    logger.info(`[Backfill] Completato — ${backfillStatus!.done} giorni, ${backfillStatus!.errors.length} errori`);
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
