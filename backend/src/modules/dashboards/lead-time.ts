/**
 * Lead Time computation
 *
 * Calculates net working hours between two production events (fasi) for each commessa.
 *
 * Working calendar:
 *   - Monday–Friday : 05:00–20:00 Europe/Rome (15 h/day)
 *   - Saturday      : 05:00–13:00 Europe/Rome  (8 h/day)
 *   - Sunday        : not working
 *   - A day counts only if it appears in webthron_events_history (production actually ran)
 *
 * Special fase value "SPMA_PIANO:<categoryId>" uses spma_plan.planned_ts instead of
 * a WebThron event. Example: "SPMA_PIANO:3"
 */

import { db } from '../../db/client.js';
import { romeOffsetForDate } from './heatmap.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadTimePoint {
  commessa_code:  string;
  line_entry_ts:  string | null;
  model_code:     string | null;
  ts_a:           string;           // ISO
  ts_b:           string;           // ISO
  hours_net:      number;           // net working hours A→B
  componente:     string | null;    // componente iknow (from webthron)
}

export interface LeadTimeParams {
  fase_a:              string;     // webthron fase name OR "SPMA_PIANO" (uses spma_plan.planned_ts)
  fase_b:              string;
  date_from:           string;     // YYYY-MM-DD  (filters commesse by line_entry_ts date)
  date_to:             string;
  category_id:         number;     // SPMA component_category_id (always required)
  componenteNames?:    string[];   // iKnow componente names resolved from spma_componente_map
  line_id?:            number;     // optional: filter commesse by line
}

export const SPMA_PIANO_FASE = 'SPMA_PIANO';

// ─── Net working hours ────────────────────────────────────────────────────────

/**
 * Returns net working hours between tsA and tsB using the production calendar.
 * productionDays: Set of 'YYYY-MM-DD' strings for days with actual production.
 */
export function netWorkingHours(
  tsA: Date,
  tsB: Date,
  productionDays: Set<string>,
): number {
  if (tsA.getTime() === tsB.getTime()) return 0;
  // Support negative lead-time (B happened before A)
  if (tsA > tsB) return -netWorkingHours(tsB, tsA, productionDays);

  let totalMs = 0;
  // Walk day by day from tsA's date to tsB's date
  const startDate = new Date(tsA);
  startDate.setUTCHours(0, 0, 0, 0);

  for (let d = new Date(startDate); d <= tsB; d.setUTCDate(d.getUTCDate() + 1)) {
    // Get Rome date string for this UTC day
    const romeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })
      .format(d);

    const dow = new Date(`${romeDate}T12:00:00Z`).getUTCDay(); // 0=Sun, 6=Sat

    // Sunday: not working
    if (dow === 0) continue;

    // Not a production day: skip
    if (!productionDays.has(romeDate)) continue;

    const offset = romeOffsetForDate(romeDate);
    const sign = offset.startsWith('-') ? '-' : '+';
    const offsetStr = `${sign}${offset.replace('-', '')}`;

    const workStart = new Date(`${romeDate}T05:00:00${offsetStr}`);
    const workEnd   = dow === 6
      ? new Date(`${romeDate}T13:00:00${offsetStr}`)   // Saturday
      : new Date(`${romeDate}T20:00:00${offsetStr}`);   // Mon–Fri

    const segStart = new Date(Math.max(tsA.getTime(), workStart.getTime()));
    const segEnd   = new Date(Math.min(tsB.getTime(), workEnd.getTime()));

    if (segEnd > segStart) {
      totalMs += segEnd.getTime() - segStart.getTime();
    }
  }

  return Math.round((totalMs / 3_600_000) * 100) / 100;
}

// ─── Available fasi / componenti — with 5-min in-process cache ───────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
let _fasiCache:       { data: string[]; at: number } | null = null;
let _componentiCache: { data: string[]; at: number } | null = null;

export async function getAvailableFasi(): Promise<string[]> {
  if (_fasiCache && Date.now() - _fasiCache.at < CACHE_TTL_MS) return _fasiCache.data;
  const rows = await db`
    SELECT DISTINCT fase FROM webthron_events_history ORDER BY fase
  `;
  const data = rows.map(r => r.fase as string);
  _fasiCache = { data, at: Date.now() };
  return data;
}

export async function getAvailableComponenti(): Promise<string[]> {
  if (_componentiCache && Date.now() - _componentiCache.at < CACHE_TTL_MS) return _componentiCache.data;
  const rows = await db`
    SELECT DISTINCT componente FROM webthron_events_history ORDER BY componente
  `;
  const data = rows.map(r => r.componente as string);
  _componentiCache = { data, at: Date.now() };
  return data;
}

// ─── Main computation ─────────────────────────────────────────────────────────

/** Returns the event table to use (always history now). */
async function eventTable(): Promise<string> {
  return 'webthron_events_history';
}

export async function computeLeadTime(params: LeadTimeParams): Promise<LeadTimePoint[]> {
  const { fase_a, fase_b, date_from, date_to, category_id, componenteNames, line_id } = params;

  const catA = fase_a === SPMA_PIANO_FASE ? category_id : null;
  const catB = fase_b === SPMA_PIANO_FASE ? category_id : null;
  const tbl  = await eventTable();

  // 1. Commesse in range, ordered by entry time
  const commesse = await db`
    SELECT id, commessa_code, line_entry_ts, model_code
    FROM spma_commessa
    WHERE DATE(line_entry_ts AT TIME ZONE 'Europe/Rome') BETWEEN ${date_from} AND ${date_to}
      ${line_id != null ? db`AND line_id = ${line_id}` : db``}
    ORDER BY line_entry_ts ASC NULLS LAST, id ASC
  `;
  if (commesse.length === 0) return [];

  const codes = commesse.map(c => c.commessa_code as string);

  // 2. Fetch timestamps for fase_a
  const tsMapA = new Map<string, Date>(); // commessa_code → earliest event ts
  const compMapA = new Map<string, string>(); // commessa_code → componente

  if (catA !== null) {
    // SPMA planned_ts
    const rows = await db`
      SELECT c.commessa_code, p.planned_ts
      FROM spma_plan p
      JOIN spma_commessa c ON c.id = p.commessa_id
      WHERE p.component_category_id = ${catA}
        AND c.commessa_code = ANY(${codes})
        AND p.planned_ts IS NOT NULL
    `;
    for (const r of rows) {
      tsMapA.set(r.commessa_code as string, new Date(r.planned_ts as string));
    }
  } else {
    const rows = await db`
      SELECT DISTINCT ON (commessa) commessa, data_inserimento, componente
      FROM ${db(tbl)}
      WHERE fase = ${fase_a}
        AND commessa = ANY(${codes})
        ${componenteNames?.length ? db`AND componente = ANY(${componenteNames})` : db``}
      ORDER BY commessa, data_inserimento ASC
    `;
    for (const r of rows) {
      tsMapA.set(r.commessa as string, new Date(r.data_inserimento as string));
      compMapA.set(r.commessa as string, r.componente as string);
    }
  }

  // 3. Fetch timestamps for fase_b
  const tsMapB = new Map<string, Date>();
  const compMapB = new Map<string, string>();

  if (catB !== null) {
    const rows = await db`
      SELECT c.commessa_code, p.planned_ts
      FROM spma_plan p
      JOIN spma_commessa c ON c.id = p.commessa_id
      WHERE p.component_category_id = ${catB}
        AND c.commessa_code = ANY(${codes})
        AND p.planned_ts IS NOT NULL
    `;
    for (const r of rows) {
      tsMapB.set(r.commessa_code as string, new Date(r.planned_ts as string));
    }
  } else {
    const rows = await db`
      SELECT DISTINCT ON (commessa) commessa, data_inserimento, componente
      FROM ${db(tbl)}
      WHERE fase = ${fase_b}
        AND commessa = ANY(${codes})
        ${componenteNames?.length ? db`AND componente = ANY(${componenteNames})` : db``}
      ORDER BY commessa, data_inserimento ASC
    `;
    for (const r of rows) {
      tsMapB.set(r.commessa as string, new Date(r.data_inserimento as string));
      compMapB.set(r.commessa as string, r.componente as string);
    }
  }

  // 4. Load production days in the full range covered by the data
  const allTs = [...tsMapA.values(), ...tsMapB.values()];
  if (allTs.length === 0) return [];
  const minTs = new Date(Math.min(...allTs.map(t => t.getTime())));
  const maxTs = new Date(Math.max(...allTs.map(t => t.getTime())));

  const minDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(minTs);
  const maxDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(maxTs);

  const prodDayRows = await db`
    SELECT DISTINCT data_cache::text AS d
    FROM ${db(tbl)}
    WHERE data_cache BETWEEN ${minDate}::date AND ${maxDate}::date
  `;
  const productionDays = new Set(prodDayRows.map(r => r.d as string));

  // 5. Build result
  const results: LeadTimePoint[] = [];
  for (const cm of commesse) {
    const code = cm.commessa_code as string;
    const tsA  = tsMapA.get(code);
    const tsB  = tsMapB.get(code);
    if (!tsA || !tsB) continue;

    const hours = netWorkingHours(tsA, tsB, productionDays);
    results.push({
      commessa_code:  code,
      line_entry_ts:  cm.line_entry_ts ? new Date(cm.line_entry_ts as string).toISOString() : null,
      model_code:     cm.model_code as string | null,
      ts_a:           tsA.toISOString(),
      ts_b:           tsB.toISOString(),
      hours_net:      hours,
      componente:     compMapA.get(code) ?? compMapB.get(code) ?? null,
    });
  }

  return results;
}
