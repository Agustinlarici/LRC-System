/**
 * SPMA Plan Rebuild
 *
 * Core algorithm:
 *   Each commessa has a position i0 in the global ordered sequence of its line.
 *   For component category C assembled at station S (1-based):
 *     planned_ts = entry time of the commessa at index (i0 + S - 1)
 *   This means: when this vehicle reaches station 1, the vehicle that will
 *   reach station S at the same moment is already at index i0+S-1 in the queue.
 */

import { db } from '../../db/client.js';

export interface RebuildResult {
  upserted: number;
  deleted:  number;
  batchId:  string;
  warnings: string[];
}

export async function rebuildSpma(): Promise<RebuildResult> {
  const batchId = Date.now().toString();
  const warnings: string[] = [];

  // 1. Lines that have commesse
  const lineRows = await db`
    SELECT DISTINCT line_id FROM spma_commessa WHERE line_id IS NOT NULL
  `;
  if (lineRows.length === 0) return { upserted: 0, deleted: 0, batchId, warnings };

  const lineIds = lineRows.map(r => r.line_id as number);

  // 2. All commesse for those lines, globally ordered
  const commesse = await db`
    SELECT id, commessa_code, model_code, line_id, line_entry_ts, pos_index
    FROM spma_commessa
    WHERE line_id = ANY(${lineIds})
    ORDER BY
      line_id        ASC,
      line_entry_ts  ASC NULLS LAST,
      (CASE WHEN pos_index IS NOT NULL THEN 0 ELSE 1 END) ASC,
      pos_index      ASC NULLS LAST,
      id             ASC
  `;
  if (commesse.length === 0) return { upserted: 0, deleted: 0, batchId, warnings };

  // 3. Model → required categories
  const modelCodes = [...new Set(commesse.map(c => c.model_code as string).filter(Boolean))];
  const reqMap = new Map<string, Set<number>>();
  if (modelCodes.length > 0) {
    const reqRows = await db`
      SELECT model_code, component_category_id
      FROM spma_model_component_req
      WHERE model_code = ANY(${modelCodes})
    `;
    for (const r of reqRows) {
      if (!reqMap.has(r.model_code)) reqMap.set(r.model_code, new Set());
      reqMap.get(r.model_code)!.add(Number(r.component_category_id));
    }
  }

  // 4. (line, category) → station index
  const stationRows = await db`
    SELECT line_id, component_category_id, station_index
    FROM spma_line_component_station
  `;
  const stationMap = new Map<string, number>();
  for (const r of stationRows) {
    stationMap.set(`${r.line_id}:${r.component_category_id}`, Number(r.station_index));
  }

  // 5. Per-line ordered sequences + position index
  type CommRow = (typeof commesse)[number];
  const seqByLine = new Map<number, CommRow[]>();
  for (const c of commesse) {
    const lid = Number(c.line_id);
    if (!seqByLine.has(lid)) seqByLine.set(lid, [] as CommRow[]);
    seqByLine.get(lid)!.push(c);
  }
  const indexInLine = new Map<number, number>();
  for (const lst of seqByLine.values()) {
    lst.forEach((c, i) => indexInLine.set(Number(c.id), i));
  }

  // 6. Upsert plan rows
  let upserted = 0;
  const warnedStations = new Set<string>();

  for (const cm of commesse) {
    const cmId    = Number(cm.id);
    const lid     = Number(cm.line_id);
    const model   = cm.model_code as string;
    const cats    = reqMap.get(model) ?? new Set<number>();
    const i0      = indexInLine.get(cmId) ?? 0;
    const lineSeq = seqByLine.get(lid)!;

    for (const catId of cats) {
      const S = stationMap.get(`${lid}:${catId}`);
      let plannedTs: Date | null = null;

      if (!S) {
        const wKey = `${lid}:${catId}`;
        if (!warnedStations.has(wKey)) {
          warnings.push(`No station configured for line ${lid}, category ${catId}`);
          warnedStations.add(wKey);
        }
        plannedTs = null;
      } else {
        const targetIdx = i0 + (S - 1);
        const targetTs  = targetIdx < lineSeq.length
          ? lineSeq[targetIdx].line_entry_ts
          : cm.line_entry_ts;            // fallback: own entry ts
        plannedTs = targetTs ? new Date(targetTs as string) : null;
      }

      await db`
        INSERT INTO spma_plan
          (commessa_id, commessa_code, model_code, line_id,
           component_category_id, planned_ts, batch_id, generated_at)
        VALUES
          (${cmId}, ${cm.commessa_code as string}, ${model}, ${lid},
           ${catId}, ${plannedTs}, ${batchId}, NOW())
        ON CONFLICT (commessa_id, component_category_id) DO UPDATE SET
          planned_ts   = EXCLUDED.planned_ts,
          batch_id     = EXCLUDED.batch_id,
          generated_at = NOW()
      `;
      upserted++;
    }
  }

  // 7. Remove stale PENDING rows not touched this batch
  //    (commessa removed from import, or model requirement deleted)
  let deletedCount = 0;
  try {
    const del = await db`
      DELETE FROM spma_plan
      WHERE batch_id != ${batchId}
        AND status = 'PENDING'
      RETURNING id
    `;
    deletedCount = del.length;
  } catch { /* non-critical */ }

  return { upserted, deleted: deletedCount, batchId, warnings };
}
