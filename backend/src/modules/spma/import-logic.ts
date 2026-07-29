import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { rebuildSpma } from './plan.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normHeader(s: string): string {
  return String(s)
    .replace(/ /g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normBasic(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pickCol(headers: string[], ...candidates: string[]): string | null {
  const normMap = new Map(headers.map(h => [normHeader(h), h]));
  for (const c of candidates) {
    const key = normHeader(c);
    if (normMap.has(key)) return normMap.get(key)!;
  }
  for (const c of candidates) {
    const key = normHeader(c);
    if (!key) continue;
    for (const [norm, orig] of normMap) {
      if (norm.includes(key)) return orig;
    }
  }
  return null;
}

export function normalizeCommessa(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'number') {
    if (!isFinite(val)) return null;
    return String(Math.round(val));
  }
  const s = String(val).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(-?\d+)\.0+$/);
  if (m) return m[1];
  return s;
}

// Formato europeo GG/MM/AAAA (o GG-MM-AAAA) — se non lo forziamo esplicitamente,
// new Date(stringa) di JS assume MM/GG/AAAA (US) e interpreta silenziosamente
// male qualsiasi data con giorno <= 12 (es. "04/09/2026" letto come 9 aprile
// invece di 4 settembre), senza nessun errore o avviso.
function parseEuropeanDate(s: string): Date | null {
  const match = s.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = parseInt(dd, 10), month = parseInt(mm, 10), year = parseInt(yyyy, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return isNaN(date.getTime()) ? null : date;
}

export function combineDateTime(dateVal: unknown, timeVal: unknown): Date | null {
  if (dateVal == null) return null;
  let date: Date;
  if (dateVal instanceof Date) {
    date = dateVal;
  } else {
    const str = String(dateVal);
    const european = parseEuropeanDate(str);
    if (european) {
      date = european;
    } else {
      date = new Date(str);
      if (isNaN(date.getTime())) return null;
    }
  }

  if (timeVal == null) return date;

  let h = 0, m = 0, s = 0;
  if (timeVal instanceof Date) {
    h = timeVal.getHours(); m = timeVal.getMinutes(); s = timeVal.getSeconds();
  } else {
    const match = String(timeVal).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) { h = +match[1]; m = +match[2]; s = match[3] ? +match[3] : 0; }
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, s);
}

export async function findOrCreateLine(name: string): Promise<number> {
  const trimmed = name.trim();
  const existing = await db`SELECT id FROM spma_line WHERE LOWER(name) = LOWER(${trimmed}) LIMIT 1`;
  if (existing.length > 0) return Number(existing[0].id);
  const [row] = await db`INSERT INTO spma_line (name) VALUES (${trimmed}) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`;
  return Number(row.id);
}

export async function bestAliasMatch(sheetName: string): Promise<number | null> {
  const norm = normBasic(sheetName);
  if (!norm) return null;
  const aliases = await db`SELECT alias_norm, line_id FROM spma_line_alias WHERE active = TRUE`;
  let best: { lineId: number; len: number } | null = null;
  for (const a of aliases) {
    const an = String(a.alias_norm);
    if (an && norm.includes(an)) {
      if (!best || an.length > best.len) best = { lineId: Number(a.line_id), len: an.length };
    }
  }
  return best ? best.lineId : null;
}

// ─── Core import function ─────────────────────────────────────────────────────

export interface SpmaImportResult {
  sheets: string[];
  total_rows_seen: number;
  upserts: number;
  skipped: number;
  deleted_stale: number;
  warnings: string[];
  plan: Awaited<ReturnType<typeof rebuildSpma>> | null;
}

export async function runSpmaImport(buffer: Buffer, fileName: string): Promise<SpmaImportResult> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new Error('File non leggibile (non è un Excel/CSV valido)');
  }

  const sheets = workbook.SheetNames;
  let totalRows = 0, upserted = 0, skipped = 0;
  const warnings: string[] = [];
  const importedCodes = new Set<string>();
  const calendarDatesToFill = new Map<string, { lineId: number; dateStr: string }>();
  const lineNameCache = new Map<number, string>();

  async function lineName(lineId: number): Promise<string> {
    const cached = lineNameCache.get(lineId);
    if (cached) return cached;
    const [row] = await db`SELECT name FROM spma_line WHERE id = ${lineId}`;
    const name = row ? String(row.name) : String(lineId);
    lineNameCache.set(lineId, name);
    return name;
  }

  for (const sheetName of sheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: false,
      defval: null,
      cellDates: true,
    } as XLSX.Sheet2JSONOpts);

    if (rows.length === 0) {
      const ref = sheet['!ref'] ?? 'undefined';
      const rawSample = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
      logger.warn({ sheetName, ref, rawRows: rawSample.length, rawSample: rawSample.slice(0, 3) }, 'spma-import: foglio vuoto da sheet_to_json');
      const rawRowCount = rawSample.length;
      if (rawRowCount > 0) {
        const firstRow = rawSample[0];
        warnings.push(`Foglio "${sheetName}": ${rawRowCount} righe raw trovate ma sheet_to_json restituisce 0. Prima riga raw: ${JSON.stringify(firstRow).slice(0, 200)}`);
      } else {
        warnings.push(`Foglio "${sheetName}": foglio vuoto (ref=${ref}).`);
      }
      continue;
    }

    const headers = Object.keys(rows[0] ?? {});
    const colFecha = pickCol(headers, 'Data Ingresso Linea', 'Data Ingresso', 'Data');
    const colOra   = pickCol(headers, 'Ora Ingresso Linea',  'Ora Ingresso',  'Ora');
    const colComm  = pickCol(headers, 'Commessa/Ordine', 'Commessa', 'Ordine');
    const colModel = pickCol(headers, 'Modello', 'Model', 'Tipo Vettura', 'Modello/Tipo');
    const colLine  = pickCol(headers, 'Linea di Montaggio', 'Linea', 'Line');
    const colPos   = headers.find(h => normHeader(h) === 'posizione') ?? null;
    const colStato = pickCol(headers, 'Stato', 'Status');

    if (!colFecha || !colComm) {
      warnings.push(`Foglio "${sheetName}": colonne minime mancanti (Commessa, Data). Saltato.`);
      continue;
    }

    const sheetLineId = await bestAliasMatch(sheetName);

    for (let i = 0; i < rows.length; i++) {
      totalRows++;
      const row = rows[i];

      try {
        // "schedulato" aggiorna solo prod_commessa_inserimenti (Programma
        // Produzione, con il flag "da verificare" — non è ancora fisicamente
        // in linea) e NON spma_commessa, per non alterare il tabellone SPMA.
        let statoSchedulatoOnly = false;
        if (colStato && row[colStato] != null) {
          const stato = String(row[colStato]).trim().toLowerCase();
          if (stato === 'schedulato') {
            statoSchedulatoOnly = true;
          } else if (!['avviato', 'in sequenza'].includes(stato)) {
            skipped++; continue;
          }
        }

        const commCode = normalizeCommessa(row[colComm!]);
        if (!commCode) { skipped++; continue; }

        const dt = combineDateTime(
          row[colFecha!],
          colOra ? row[colOra] : null,
        );
        if (!dt) {
          warnings.push(`Foglio "${sheetName}", riga ${i + 2}: data/ora non valida.`);
          skipped++; continue;
        }

        const modelCode = (colModel && row[colModel] != null)
          ? String(row[colModel]).trim() || '-'
          : '-';

        let lineId: number;
        if (colLine && row[colLine] != null) {
          lineId = await findOrCreateLine(String(row[colLine]));
        } else if (sheetLineId != null) {
          lineId = sheetLineId;
        } else {
          lineId = await findOrCreateLine(sheetName);
          const norm = normBasic(sheetName);
          if (norm) {
            await db`
              INSERT INTO spma_line_alias (alias, alias_norm, line_id, active)
              VALUES (${sheetName}, ${norm}, ${lineId}, TRUE)
              ON CONFLICT (alias_norm) DO UPDATE SET line_id = EXCLUDED.line_id, active = TRUE
            `;
          }
        }

        let posIndex: number | null = null;
        if (colPos && row[colPos] != null) {
          const pv = parseFloat(String(row[colPos]));
          if (!isNaN(pv)) posIndex = Math.round(pv);
        }

        if (!statoSchedulatoOnly) {
          await db`
            INSERT INTO spma_commessa
              (commessa_code, model_code, line_id, line_entry_ts, pos_index)
            VALUES
              (${commCode}, ${modelCode}, ${lineId}, ${dt.toISOString()}, ${posIndex})
            ON CONFLICT (commessa_code) DO UPDATE SET
              model_code    = EXCLUDED.model_code,
              line_id       = EXCLUDED.line_id,
              line_entry_ts = EXCLUDED.line_entry_ts,
              pos_index     = EXCLUDED.pos_index
          `;
          importedCodes.add(commCode);
        }

        // Stessa importazione aggiorna anche la data di ingresso in linea
        // usata dal modulo Programma Produzione (tabella separata, stesso file).
        // schedulato=TRUE quando la riga aveva Stato "Schedulato" (non ancora
        // fisicamente in linea) — il foglio la mostra con un flag "da
        // verificare" invece di darla per confermata come avviato/in sequenza.
        await db`
          INSERT INTO prod_commessa_inserimenti (commessa, linea, insertion_line_ts, schedulato, updated_at)
          VALUES (${commCode}, ${await lineName(lineId)}, ${dt.toISOString()}, ${statoSchedulatoOnly}, now())
          ON CONFLICT (commessa) DO UPDATE SET
            linea             = EXCLUDED.linea,
            schedulato        = EXCLUDED.schedulato,
            insertion_line_ts = EXCLUDED.insertion_line_ts,
            updated_at        = now()
        `.catch(err => logger.warn({ err, commCode }, 'programma-produzione: aggiornamento prod_commessa_inserimenti fallito'));

        const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(dt);
        const calKey  = `${lineId}:${dateStr}`;
        if (!calendarDatesToFill.has(calKey)) calendarDatesToFill.set(calKey, { lineId, dateStr });

        upserted++;
      } catch (err) {
        skipped++;
        warnings.push(`Foglio "${sheetName}", riga ${i + 2}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Auto-populate calendar ───────────────────────────────────────────────
  if (calendarDatesToFill.size > 0) {
    try {
      const defaults = await db`SELECT day_of_week, shift_start, shift_end, is_working FROM spma_calendar_defaults`;
      const defByDay = new Map(defaults.map(d => [Number(d.day_of_week), d]));
      for (const { lineId, dateStr } of calendarDatesToFill.values()) {
        const dow = new Date(`${dateStr}T12:00:00`).getDay();
        const def = defByDay.get(dow);
        if (!def || !def.is_working) continue;
        await db`
          INSERT INTO spma_line_calendar (line_id, work_date, start_time, end_time, auto_generated)
          VALUES (${lineId}, ${dateStr}, ${String(def.shift_start)}, ${String(def.shift_end)}, TRUE)
          ON CONFLICT (line_id, work_date) DO NOTHING
        `.catch(err => logger.warn({ err, lineId, dateStr }, 'spma: calendar insert failed'));
      }
    } catch (err) {
      logger.warn({ err }, 'spma: calendar auto-populate failed');
    }
  }

  // ─── Cleanup stale commesse ───────────────────────────────────────────────
  let deleted = 0;
  if (importedCodes.size > 0) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 10);
    const toDelete = await db`
      SELECT id, commessa_code FROM spma_commessa
      WHERE line_entry_ts > ${horizon.toISOString()}
        AND commessa_code != ALL(${[...importedCodes]})
    `;
    if (toDelete.length > 0) {
      const ids = toDelete.map(r => Number(r.id));
      await db`DELETE FROM spma_commessa WHERE id = ANY(${ids})`;
      deleted = ids.length;
    }
  }

  // ─── Rebuild plan ─────────────────────────────────────────────────────────
  let planResult: Awaited<ReturnType<typeof rebuildSpma>> | null = null;
  try {
    planResult = await rebuildSpma();
  } catch (err) {
    logger.error({ err }, 'spma: plan rebuild failed after import');
    warnings.push(`Rebuild piano fallito: ${(err as Error).message}`);
  }

  // ─── Log import ───────────────────────────────────────────────────────────
  await db`
    INSERT INTO spma_import_log (file_name, total_rows, upserts, skipped, deleted_stale, sheets)
    VALUES (${fileName}, ${totalRows}, ${upserted}, ${skipped}, ${deleted}, ${sheets})
  `.catch(err => logger.warn({ err }, 'spma: failed to save import log'));

  return {
    sheets,
    total_rows_seen: totalRows,
    upserts:         upserted,
    skipped,
    deleted_stale:   deleted,
    warnings:        warnings.slice(0, 100),
    plan:            planResult,
  };
}
