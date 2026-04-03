import { db } from '../../db/client.js';
import { getWebthronPool } from '../monitor/mysql-client.js';
import { getDeliberaFasi, isConforming } from '../monitor/executive-cache.js';
import { logger } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeatmapWebthronRow {
  fase:             string;
  modello:          string;
  componente:       string;
  cod_seriale:      string;
  esito_delibera:   string | null;
  data_inserimento: Date;
}

/** Daily OEE per line — used by the detail endpoint and the daily snapshot table. */
export interface OeeCellResult {
  linea_id:          number;
  data:              string;
  pezzi_reali:       number;
  pezzi_pianificati: number;
  pezzi_conformi:    number;
  pezzi_deliberati:  number;
  minuti_turno:      number;
  minuti_fermo:      number;
  disponibilita:     number;
  performance:       number;
  qualita:           number;
  oee:               number;
  fermi_count:       number;
  has_data:          boolean;
}

/** Hourly OEE per line — used by the heatmap grid. */
export interface OeeHourCell {
  linea_id:      number;
  data:          string;  // "YYYY-MM-DD"
  ora:           number;  // 0-23
  pezzi_reali:   number;
  pezzi_attesi:  number;  // expected pieces for this hour based on cycle time
  minuti_fermo:  number;
  fermi_count:   number;
  disponibilita: number;  // 0-100
  performance:   number;  // 0-100
  oee:           number;  // 0-100  (D × P — quality not tracked per hour)
  has_data:      boolean;
}

type LineaCombo = { fase: string; modello: string; componente: string };

const QUERY_TIMEOUT_MS = 3 * 60 * 1000; // 3 min — MAX_EXECUTION_TIME hint matches

// ─── Timezone helpers ──────────────────────────────────────────────────────────

export function romeOffsetForDate(dateStr: string): string {
  // Use T12:00:00Z as anchor — UTC noon — then read the Rome hour via formatToParts.
  // This avoids new Date(localeString) which interprets the string in LOCAL timezone.
  const d = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const romeH = parseInt(parts.find(p => p.type === 'hour')!.value,   10);
  const romeM = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const offsetH = romeH - 12; // anchor was noon UTC
  return offsetH >= 0
    ? `${String(offsetH).padStart(2, '0')}:${String(romeM).padStart(2, '0')}`
    : `-${String(-offsetH).padStart(2, '0')}:${String(romeM).padStart(2, '0')}`;
}

export function toRomeDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
}

// ─── Webthron range query ──────────────────────────────────────────────────────

export async function queryWebthronRange(
  dateFrom:     string,
  dateTo:       string,
  prodCombos:   LineaCombo[],
  deliberaFasi: string[],
): Promise<HeatmapWebthronRow[]> {
  if (prodCombos.length === 0 || deliberaFasi.length === 0) return [];

  const prodConditions = prodCombos
    .map(() => `(ikExtra62Tab.stringa = ? AND ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');
  const prodParams = prodCombos.flatMap(c => [c.fase, c.modello, c.componente]);

  const allModelli        = [...new Set(prodCombos.map(c => c.modello))];
  const allComponenti     = [...new Set(prodCombos.map(c => c.componente))];
  const delibFasiPH       = deliberaFasi.map(() => '?').join(', ');
  const delibModelliPH    = allModelli.map(() => '?').join(', ');
  const delibComponentiPH = allComponenti.map(() => '?').join(', ');

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
      AND DATE(CONVERT_TZ(ubi.datain, '+00:00', '+01:00')) BETWEEN ? AND ?
      AND Extra186.stringa IS NOT NULL
      AND ikExtra43Tab.stringa IS NOT NULL
      AND ikExtra45Tab.stringa IS NOT NULL
      AND ikExtra62Tab.stringa IS NOT NULL
      AND (
        (${prodConditions})
        OR (
          ikExtra62Tab.stringa IN (${delibFasiPH})
          AND ikExtra43Tab.stringa IN (${delibModelliPH})
          AND ikExtra45Tab.stringa IN (${delibComponentiPH})
        )
      )
    ORDER BY ubi.datain ASC
    LIMIT 200000
  `;

  const params = [
    dateFrom, dateTo,
    ...prodParams,
    ...deliberaFasi, ...allModelli, ...allComponenti,
  ];

  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT_MS }, params);
  return (rows as Array<Record<string, unknown>>).map(r => ({
    fase:             r.fase             as string,
    modello:          r.modello          as string,
    componente:       r.componente       as string,
    cod_seriale:      r.cod_seriale      as string,
    esito_delibera:   r.esito_delibera   as string | null,
    data_inserimento: r.data_inserimento as Date,
  }));
}

// ─── Hourly OEE computation for one line × one day ────────────────────────────
// Returns one OeeHourCell per working hour (skips hours completely outside shift
// and with no production).
//
// OEE formula:  D = (eff_min - fermo) / eff_min
//               P = min(pezzi_reali / pezzi_attesi, 1)
//               OEE = D × P × 100   (quality not tracked per-hour)

export function computeHourlyCells(
  lineaId:    number,
  linea_fase: string,
  combos:     Array<{ modello: string; componente: string }>,
  pgDay: {
    minuti_turno:      number;
    minuti_pausa:      number;
    pezzi_pianificati: number;
    turno_inizio:      string | null; // "HH:MM" or "HH:MM:SS"
    turno_fine:        string | null;
  },
  webthronRows: HeatmapWebthronRow[],
  dateStr:      string,
): OeeHourCell[] {
  const combosSet  = new Set(combos.map(c => `${c.modello}|${c.componente}`));
  const prodTimes  = webthronRows
    .filter(r => r.fase === linea_fase && combosSet.has(`${r.modello}|${r.componente}`))
    .map(r => r.data_inserimento);

  const turno_oggi = pgDay.minuti_turno > 0;
  // No shift configured → never show cells, even if there is production data
  if (!turno_oggi) return [];

  const net_planned  = Math.max(1, pgDay.minuti_turno - pgDay.minuti_pausa);
  const cycleTimeSec = pgDay.pezzi_pianificati > 0
    ? Math.round(net_planned * 60 / pgDay.pezzi_pianificati)
    : prodTimes.length > 0
      ? Math.round(net_planned * 60 / prodTimes.length)  // inferred from actual production
      : null;

  const offset = romeOffsetForDate(dateStr);
  const pad    = (n: number) => String(n).padStart(2, '0');

  const turnoStartTs = pgDay.turno_inizio
    ? new Date(`${dateStr}T${pgDay.turno_inizio.slice(0, 5)}:00+${offset}`)
    : null;
  const turnoEndTs = pgDay.turno_fine
    ? new Date(`${dateStr}T${pgDay.turno_fine.slice(0, 5)}:00+${offset}`)
    : null;

  const cells: OeeHourCell[] = [];

  // 4-hour blocks: 06-10, 10-14, 14-18, 18-22
  for (const ora of [6, 10, 14, 18]) {
    const blockStartTs = new Date(`${dateStr}T${pad(ora)}:00:00+${offset}`);
    // End of block = start + 4h - 1ms (stays within same calendar day)
    const blockEndTs   = new Date(blockStartTs.getTime() + 4 * 3_600_000 - 1);

    // Effective work window = intersection of [block, shift]
    const effStartMs = turnoStartTs
      ? Math.max(blockStartTs.getTime(), turnoStartTs.getTime())
      : blockStartTs.getTime();
    const effEndMs   = turnoEndTs
      ? Math.min(blockEndTs.getTime(), turnoEndTs.getTime())
      : blockEndTs.getTime();

    const effMin = Math.max(0, (effEndMs - effStartMs) / 60_000);

    // Production timestamps within this 4-hour block
    const blockProd = prodTimes
      .filter(ts => ts.getTime() >= blockStartTs.getTime() && ts.getTime() <= blockEndTs.getTime())
      .sort((a, b) => a.getTime() - b.getTime());

    const pezzi_reali = blockProd.length;

    // Skip blocks completely outside shift with no production
    if (effMin === 0 && pezzi_reali === 0) continue;

    const has_data     = pezzi_reali > 0 || effMin > 0;
    const pezzi_attesi = cycleTimeSec && effMin > 0
      ? Math.floor(effMin * 60 / cycleTimeSec)
      : 0;

    // Gap-based fermo within this block
    let minuti_fermo = 0;
    let fermi_count  = 0;

    if (cycleTimeSec && effMin > 0) {
      if (blockProd.length === 0) {
        // No production during a working block → whole block is fermo
        minuti_fermo = effMin;
        fermi_count  = 1;
      } else {
        // Gap from effective start to first piece
        const effStart = new Date(effStartMs);
        const gapStart = (blockProd[0].getTime() - effStart.getTime()) / 1000;
        if (gapStart > cycleTimeSec) {
          minuti_fermo += (gapStart - cycleTimeSec) / 60;
          fermi_count++;
        }
        // Gaps between consecutive pieces
        for (let i = 1; i < blockProd.length; i++) {
          const gap = (blockProd[i].getTime() - blockProd[i - 1].getTime()) / 1000;
          if (gap > cycleTimeSec) {
            minuti_fermo += (gap - cycleTimeSec) / 60;
            fermi_count++;
          }
        }
      }
    }

    // Cap fermo at effective working minutes
    minuti_fermo = Math.min(Math.round(minuti_fermo), Math.round(effMin));

    const disponibilita = effMin > 0
      ? Math.max(0, Math.min(1, (effMin - minuti_fermo) / effMin))
      : 0;
    const performance = pezzi_attesi > 0
      ? Math.min(1, pezzi_reali / pezzi_attesi)
      : (pezzi_reali > 0 ? 1 : 0);
    const oee = Math.round(disponibilita * performance * 1000) / 10;

    cells.push({
      linea_id:      lineaId,
      data:          dateStr,
      ora,           // block start hour: 0, 4, 8, 12, 16 or 20
      pezzi_reali,
      pezzi_attesi,
      minuti_fermo,
      fermi_count,
      disponibilita: Math.round(disponibilita * 1000) / 10,
      performance:   Math.round(performance   * 1000) / 10,
      oee,
      has_data,
    });
  }

  return cells;
}

// ─── Daily OEE computation (used by detail endpoint + daily snapshot) ─────────

export function computeCellOee(
  lineaId:    number,
  linea_fase: string,
  combos:     Array<{ modello: string; componente: string }>,
  pgDay: {
    minuti_turno:      number;
    minuti_pausa:      number;
    pezzi_pianificati: number;
    turno_inizio:      string | null;
  },
  webthronRows: HeatmapWebthronRow[],
  dateStr:      string,
  deliberaFasi: string[],
): OeeCellResult {
  const combosSet = new Set(combos.map(c => `${c.modello}|${c.componente}`));
  const prodRows  = webthronRows.filter(r =>
    r.fase === linea_fase && combosSet.has(`${r.modello}|${r.componente}`)
  );
  const pezzi_reali = prodRows.length;

  const prodSerials  = new Set(prodRows.map(r => r.cod_seriale));
  const deliberaRows = prodSerials.size > 0
    ? webthronRows.filter(r => deliberaFasi.includes(r.fase) && prodSerials.has(r.cod_seriale))
    : [];
  const latestBySerial = new Map<string, string | null>();
  for (const r of deliberaRows) latestBySerial.set(r.cod_seriale, r.esito_delibera);
  const pezzi_deliberati = latestBySerial.size;
  let pezzi_conformi = 0;
  for (const esito of latestBySerial.values()) if (isConforming(esito)) pezzi_conformi++;

  const { minuti_turno, minuti_pausa, pezzi_pianificati, turno_inizio } = pgDay;
  const turno_oggi = minuti_turno > 0;
  const has_data   = turno_oggi || pezzi_reali > 0;
  const net_planned  = Math.max(1, minuti_turno - minuti_pausa);
  const cycleTimeSec = turno_oggi && pezzi_pianificati > 0
    ? Math.round(net_planned * 60 / pezzi_pianificati)
    : turno_oggi && pezzi_reali > 0
      ? Math.round(net_planned * 60 / pezzi_reali)  // inferred from actual production
      : null;

  const prodTimestamps = prodRows
    .map(r => r.data_inserimento)
    .sort((a, b) => a.getTime() - b.getTime());

  let minuti_fermo = 0;
  let fermi_count  = 0;

  if (cycleTimeSec && turno_inizio && prodTimestamps.length > 0) {
    const offset       = romeOffsetForDate(dateStr);
    const turnoStartTs = new Date(`${dateStr}T${turno_inizio.slice(0, 5)}:00+${offset}`);
    const gapStart = (prodTimestamps[0].getTime() - turnoStartTs.getTime()) / 1000;
    if (gapStart > cycleTimeSec) { minuti_fermo += (gapStart - cycleTimeSec) / 60; fermi_count++; }
    for (let i = 1; i < prodTimestamps.length; i++) {
      const gap = (prodTimestamps[i].getTime() - prodTimestamps[i - 1].getTime()) / 1000;
      if (gap > cycleTimeSec) { minuti_fermo += (gap - cycleTimeSec) / 60; fermi_count++; }
    }
  }
  minuti_fermo = Math.round(minuti_fermo);

  const disponibilita = turno_oggi
    ? Math.max(0, Math.min(1, (net_planned - minuti_fermo) / net_planned)) : 0;
  const performance = turno_oggi && pezzi_pianificati > 0
    ? Math.min(1, pezzi_reali / pezzi_pianificati) : 0;
  const qualita = pezzi_deliberati > 0
    ? Math.max(0, Math.min(1, pezzi_conformi / pezzi_deliberati)) : 1.0;
  const oee = Math.round(disponibilita * performance * qualita * 1000) / 10;

  return {
    linea_id: lineaId, data: dateStr, pezzi_reali, pezzi_pianificati, pezzi_conformi,
    pezzi_deliberati, minuti_turno: Math.round(minuti_turno), minuti_fermo,
    disponibilita: Math.round(disponibilita * 1000) / 10,
    performance:   Math.round(performance   * 1000) / 10,
    qualita:       Math.round(qualita       * 1000) / 10,
    oee, fermi_count, has_data,
  };
}

// ─── Snapshot persistence ──────────────────────────────────────────────────────

export async function saveOeeHourCells(cells: OeeHourCell[]): Promise<void> {
  for (const c of cells) {
    await db`
      INSERT INTO monitor_oee_hourly
        (linea_id, data, ora, pezzi_reali, pezzi_attesi, minuti_fermo, fermi_count,
         disponibilita, performance, oee, has_data, computed_at)
      VALUES
        (${c.linea_id}, ${c.data}::date, ${c.ora}, ${c.pezzi_reali}, ${c.pezzi_attesi},
         ${c.minuti_fermo}, ${c.fermi_count}, ${c.disponibilita}, ${c.performance},
         ${c.oee}, ${c.has_data}, NOW())
      ON CONFLICT (linea_id, data, ora) DO UPDATE SET
        pezzi_reali   = EXCLUDED.pezzi_reali,
        pezzi_attesi  = EXCLUDED.pezzi_attesi,
        minuti_fermo  = EXCLUDED.minuti_fermo,
        fermi_count   = EXCLUDED.fermi_count,
        disponibilita = EXCLUDED.disponibilita,
        performance   = EXCLUDED.performance,
        oee           = EXCLUDED.oee,
        has_data      = EXCLUDED.has_data,
        computed_at   = NOW()
    `;
  }
}

export async function saveOeeCells(cells: OeeCellResult[]): Promise<void> {
  for (const cell of cells) {
    if (!cell.has_data) continue;
    await db`
      INSERT INTO monitor_oee_daily
        (linea_id, data, pezzi_reali, pezzi_pianificati, pezzi_conformi, pezzi_deliberati,
         minuti_turno, minuti_fermo, disponibilita, performance, qualita, oee, fermi_count, computed_at)
      VALUES
        (${cell.linea_id}, ${cell.data}::date, ${cell.pezzi_reali}, ${cell.pezzi_pianificati},
         ${cell.pezzi_conformi}, ${cell.pezzi_deliberati}, ${cell.minuti_turno}, ${cell.minuti_fermo},
         ${cell.disponibilita}, ${cell.performance}, ${cell.qualita}, ${cell.oee}, ${cell.fermi_count}, NOW())
      ON CONFLICT (linea_id, data) DO UPDATE SET
        pezzi_reali = EXCLUDED.pezzi_reali, pezzi_pianificati = EXCLUDED.pezzi_pianificati,
        pezzi_conformi = EXCLUDED.pezzi_conformi, pezzi_deliberati = EXCLUDED.pezzi_deliberati,
        minuti_turno = EXCLUDED.minuti_turno, minuti_fermo = EXCLUDED.minuti_fermo,
        disponibilita = EXCLUDED.disponibilita, performance = EXCLUDED.performance,
        qualita = EXCLUDED.qualita, oee = EXCLUDED.oee,
        fermi_count = EXCLUDED.fermi_count, computed_at = NOW()
    `;
  }
}

// ─── Daily snapshot job ───────────────────────────────────────────────────────

export async function snapshotDay(dateStr: string): Promise<void> {
  const deliberaFasi = getDeliberaFasi();

  const linee = await db`
    SELECT ml.id, ml.nome, ml.fase,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('modello', mlc.modello, 'componente', mlc.componente))
          FILTER (WHERE mlc.id IS NOT NULL), '[]'::json
      ) AS combos
    FROM monitor_linea ml
    LEFT JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
    GROUP BY ml.id, ml.nome, ml.fase
  `;
  if (linee.length === 0) return;

  const [turni, quantita, pause] = await Promise.all([
    db`SELECT linea_id,
              SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_turno,
              MIN(ora_inizio::text) AS turno_inizio,
              MAX(ora_fine::text)   AS turno_fine
       FROM monitor_turno WHERE data = ${dateStr}::date GROUP BY linea_id`,
    db`SELECT linea_id, quantita_giornaliera FROM monitor_quantita_giorno WHERE data = ${dateStr}::date`,
    db`SELECT linea_id,
              SUM(EXTRACT(EPOCH FROM (ora_fine::time - ora_inizio::time))) / 60.0 AS minuti_pausa
       FROM monitor_pausa WHERE data = ${dateStr}::date GROUP BY linea_id`,
  ]);

  const allCombos: LineaCombo[] = linee.flatMap(l =>
    (l.combos as Array<{ modello: string; componente: string }>).map(c => ({
      fase: l.fase as string, modello: c.modello, componente: c.componente,
    }))
  );

  const webthronRows = allCombos.length > 0
    ? await queryWebthronRange(dateStr, dateStr, allCombos, deliberaFasi)
    : [];

  const dailyCells: OeeCellResult[] = [];
  const hourCells:  OeeHourCell[]   = [];

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

    dailyCells.push(computeCellOee(l.id as number, l.fase as string, combos,
      pgDay, webthronRows, dateStr, deliberaFasi));
    hourCells.push(...computeHourlyCells(l.id as number, l.fase as string, combos,
      pgDay, webthronRows, dateStr));
  }

  await saveOeeCells(dailyCells);
  await saveOeeHourCells(hourCells);
  logger.info(`[Heatmap] Snapshot ${dateStr} — ${dailyCells.filter(c => c.has_data).length} linee, ${hourCells.filter(c => c.has_data).length} ore`);
}
