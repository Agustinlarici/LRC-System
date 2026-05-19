import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface WorkPeriod { from: Date; to: Date }
interface PhaseSeq   { fase_name: string; order_index: number; duration_minutes: number }

// ─── Working time helpers ─────────────────────────────────────────────────────

function workingMinutesBetween(from: Date, to: Date, periods: WorkPeriod[]): number {
  if (from >= to) return 0;
  let total = 0;
  for (const p of periods) {
    const start = from > p.from ? from : p.from;
    const end   = to   < p.to   ? to   : p.to;
    if (start < end) total += (end.getTime() - start.getTime()) / 60_000;
  }
  return total;
}

function subtractWorkingMinutes(from: Date, minutes: number, periods: WorkPeriod[]): Date {
  if (minutes <= 0) return from;
  const sorted = [...periods].sort((a, b) => b.from.getTime() - a.from.getTime());
  let remaining = minutes;
  let cursor = from;
  for (const p of sorted) {
    if (p.from >= cursor) continue;
    const slotEnd   = cursor < p.to ? cursor : p.to;
    const slotStart = p.from;
    if (slotEnd <= slotStart) continue;
    const available = (slotEnd.getTime() - slotStart.getTime()) / 60_000;
    if (available >= remaining) {
      return new Date(slotEnd.getTime() - remaining * 60_000);
    }
    remaining -= available;
    cursor = slotStart;
  }
  const earliest = sorted[sorted.length - 1];
  return earliest ? earliest.from : new Date(from.getTime() - remaining * 60_000);
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface DelayItem {
  commessa_code:     string;
  model_code:        string | null;
  category_id:       number;
  category_name:     string;
  planned_ts:        string;
  current_fase:      string | null;
  expected_fase:     string | null;
  delay_pct:         number;
  delay_minutes:     number;
  remaining_minutes: number;
  severity:          'ok' | 'warning' | 'critical';
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function checkSpmaDelays(): Promise<DelayItem[]> {
  const [cfg] = await db`SELECT warning_pct, critical_pct FROM spma_alert_config WHERE id = 1`;
  const warningPct  = cfg ? Number(cfg.warning_pct)  : 15;
  const criticalPct = cfg ? Number(cfg.critical_pct) : 30;

  const now         = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60_000);
  const windowEnd   = new Date(now.getTime() + 4  * 60 * 60_000);

  const planRows = await db`
    SELECT p.commessa_id, p.commessa_code, p.model_code, p.planned_ts, p.line_id,
           p.component_category_id, cat.name AS category_name
    FROM spma_plan p
    JOIN spma_component_category cat ON cat.id = p.component_category_id
    WHERE p.planned_ts >= ${windowStart.toISOString()}
      AND p.planned_ts <= ${windowEnd.toISOString()}
    ORDER BY p.planned_ts
  `;
  if (planRows.length === 0) return [];

  const lineIds   = [...new Set(planRows.map(r => Number(r.line_id)).filter(Boolean))];
  const catIds    = [...new Set(planRows.map(r => Number(r.component_category_id)))];
  const commCodes = [...new Set(planRows.map(r => String(r.commessa_code)))];

  // Calendar as UTC Date objects via AT TIME ZONE
  const calFrom = new Date(now.getTime() - 45 * 24 * 60 * 60_000);
  const calTo   = new Date(now.getTime() + 45 * 24 * 60 * 60_000);
  const calRows = lineIds.length > 0 ? await db`
    SELECT
      line_id,
      (work_date + start_time) AT TIME ZONE 'Europe/Rome' AS period_from,
      (work_date + end_time)   AT TIME ZONE 'Europe/Rome' AS period_to
    FROM spma_line_calendar
    WHERE line_id = ANY(${lineIds})
      AND work_date BETWEEN ${calFrom.toISOString().slice(0, 10)}
                        AND ${calTo.toISOString().slice(0, 10)}
    ORDER BY work_date, start_time
  ` : [];

  const periodsByLine = new Map<number, WorkPeriod[]>();
  for (const r of calRows) {
    const lid = Number(r.line_id);
    if (!periodsByLine.has(lid)) periodsByLine.set(lid, []);
    periodsByLine.get(lid)!.push({
      from: new Date(r.period_from as string),
      to:   new Date(r.period_to   as string),
    });
  }

  // Phase sequences
  const phaseRows = catIds.length > 0 ? await db`
    SELECT component_category_id, fase_name, order_index, duration_minutes
    FROM spma_fase_sequence
    WHERE component_category_id = ANY(${catIds})
    ORDER BY component_category_id, order_index
  ` : [];

  const phasesByCategory = new Map<number, PhaseSeq[]>();
  for (const r of phaseRows) {
    const cid = Number(r.component_category_id);
    if (!phasesByCategory.has(cid)) phasesByCategory.set(cid, []);
    phasesByCategory.get(cid)!.push({
      fase_name:        String(r.fase_name),
      order_index:      Number(r.order_index),
      duration_minutes: Number(r.duration_minutes),
    });
  }

  // Most advanced phase reached per (commessa, category) — only phases in configured sequence
  const reachedRows = commCodes.length > 0 && catIds.length > 0 ? await db`
    SELECT weh.commessa, m.component_category_id, MAX(fs.order_index) AS max_order
    FROM webthron_events_history weh
    JOIN spma_componente_map m
      ON m.componente_iknow = weh.componente AND m.active = TRUE
    JOIN spma_fase_sequence fs
      ON fs.component_category_id = m.component_category_id
     AND fs.fase_name = weh.fase
    WHERE weh.commessa = ANY(${commCodes})
      AND m.component_category_id = ANY(${catIds})
    GROUP BY weh.commessa, m.component_category_id
  ` : [];

  // Build (commessa:catId) → { order_index, fase_name } using in-memory phase data
  const currentPhaseByKey = new Map<string, { order_index: number; fase_name: string }>();
  for (const r of reachedRows) {
    const cid    = Number(r.component_category_id);
    const maxOrd = Number(r.max_order);
    const phases = phasesByCategory.get(cid) ?? [];
    const phase  = phases.find(p => p.order_index === maxOrd);
    currentPhaseByKey.set(`${r.commessa}:${cid}`, {
      order_index: maxOrd,
      fase_name:   phase?.fase_name ?? '',
    });
  }

  // ── Calculate delay for each plan item ────────────────────────────────────
  const results: DelayItem[] = [];

  for (const item of planRows) {
    const plannedTs   = new Date(item.planned_ts as string);
    const lineId      = Number(item.line_id);
    const catId       = Number(item.component_category_id);
    const commCode    = String(item.commessa_code);
    const modelCode   = item.model_code ? String(item.model_code) : null;
    const catName     = String(item.category_name);
    const phases  = phasesByCategory.get(catId);
    if (!phases || phases.length === 0) continue;

    const periods             = periodsByLine.get(lineId) ?? [];
    const totalProcessMinutes = phases.reduce((s, p) => s + p.duration_minutes, 0);
    if (totalProcessMinutes === 0) continue;

    const processStart        = subtractWorkingMinutes(plannedTs, totalProcessMinutes, periods);
    const elapsedMinutes      = workingMinutesBetween(processStart, now, periods);
    const expectedDone        = Math.min(elapsedMinutes, totalProcessMinutes);
    const remainingToAssembly = workingMinutesBetween(now, plannedTs, periods);

    const currentPhase = currentPhaseByKey.get(`${commCode}:${catId}`);
    let actualDone = 0;
    if (currentPhase) {
      for (const p of phases) {
        if (p.order_index <= currentPhase.order_index) actualDone += p.duration_minutes;
      }
    }

    const delayMinutes = Math.max(0, expectedDone - actualDone);
    const delayPct     = remainingToAssembly > 0
      ? (delayMinutes / remainingToAssembly) * 100
      : (delayMinutes > 0 ? 100 : 0);

    const severity: DelayItem['severity'] =
      delayPct >= criticalPct ? 'critical' :
      delayPct >= warningPct  ? 'warning'  : 'ok';

    // Expected fase: walk phases until elapsedMinutes is consumed
    let expectedFase: string | null = null;
    {
      let cum = 0;
      for (const p of phases) {
        cum += p.duration_minutes;
        if (elapsedMinutes <= cum) { expectedFase = p.fase_name; break; }
      }
      if (!expectedFase && phases.length > 0) expectedFase = phases[phases.length - 1].fase_name;
    }

    results.push({
      commessa_code:     commCode,
      model_code:        modelCode,
      category_id:       catId,
      category_name:     catName,
      planned_ts:        plannedTs.toISOString(),
      current_fase:      currentPhase?.fase_name ?? null,
      expected_fase:     expectedFase,
      delay_pct:         Math.round(delayPct),
      delay_minutes:     Math.round(delayMinutes),
      remaining_minutes: Math.round(remainingToAssembly),
      severity,
    });
  }

  logger.info(`[SPMA delay] checked ${results.length} items, ${results.filter(r => r.severity !== 'ok').length} delayed`);
  return results;
}
