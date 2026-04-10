/**
 * Buffer data access — reads from PostgreSQL (webthron_events_history).
 * Zero direct WebThron queries at serving time.
 *
 * queryFasi() and queryModelliComponenti() read from webthron_lookup_* tables
 * that are refreshed once per day at 02:00 by the scheduler.
 */

import { db } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BufferCombo = { modello: string; componente: string };
export type BufferItem  = { seriale: string; commessa: string | null };

// ─── Buffer query — PostgreSQL only ──────────────────────────────────────────
//
// Reads webthron_events_history for the last 14 days.
// DISTINCT ON (cod_seriale) ORDER BY data_inserimento DESC gives the most
// recent event per serial — equivalent to "highest iddocu" in WebThron.
// JS then filters by fase + combo + commessa (same logic as before).
//

async function fetchFromHistory(componenti: string[]): Promise<Array<{
  seriale:    string;
  fase:       string;
  modello:    string;
  componente: string;
  commessa:   string | null;
}>> {
  if (componenti.length === 0) return [];

  const rows = await db`
    SELECT DISTINCT ON (cod_seriale)
      cod_seriale AS seriale, fase, modello, componente, commessa
    FROM webthron_events_history
    WHERE data_cache >= CURRENT_DATE - INTERVAL '14 days'
      AND componente = ANY(${componenti})
    ORDER BY cod_seriale, data_inserimento DESC
  `;

  return rows as unknown as Array<{
    seriale:    string;
    fase:       string;
    modello:    string;
    componente: string;
    commessa:   string | null;
  }>;
}

function filterForLinea(
  rows: Awaited<ReturnType<typeof fetchFromHistory>>,
  fasi:   string[],
  combos: BufferCombo[],
): BufferItem[] {
  if (fasi.length === 0 || combos.length === 0) return [];
  const result: BufferItem[] = [];
  for (const row of rows) {
    if (
      fasi.includes(row.fase) &&
      row.commessa &&
      combos.some(c => c.modello === row.modello && c.componente === row.componente)
    ) {
      result.push({ seriale: row.seriale, commessa: row.commessa });
    }
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function queryBuffer(fasi: string[], combos: BufferCombo[]): Promise<BufferItem[]> {
  if (fasi.length === 0 || combos.length === 0) return [];
  const componenti = [...new Set(combos.map(c => c.componente))];
  const rows = await fetchFromHistory(componenti);
  return filterForLinea(rows, fasi, combos);
}

export type LineaInput = { id: number; fasi: string[]; combos: BufferCombo[] };

export async function queryBufferAll(linee: LineaInput[]): Promise<Map<number, BufferItem[]>> {
  const result = new Map<number, BufferItem[]>(linee.map(l => [l.id, []]));
  const valid  = linee.filter(l => l.fasi.length > 0 && l.combos.length > 0);
  if (valid.length === 0) return result;

  // All unique componenti — one PG round-trip
  const componenti = [...new Set(valid.flatMap(l => l.combos.map(c => c.componente)))];
  const rows = await fetchFromHistory(componenti);

  for (const linea of valid) {
    result.set(linea.id, filterForLinea(rows, linea.fasi, linea.combos));
  }
  return result;
}

// ─── Lookup queries — PostgreSQL only ────────────────────────────────────────
// These tables are populated once per day by refreshLookupTables() in pg-webthron-sync.
// Falls back to empty array if not yet populated (first run before 02:00).

export async function queryFasi(): Promise<string[]> {
  const rows = await db`SELECT fase FROM webthron_lookup_fasi ORDER BY fase`;
  return rows.map(r => r.fase as string);
}

export async function queryModelliComponenti(): Promise<BufferCombo[]> {
  const rows = await db`SELECT modello, componente FROM webthron_lookup_combos ORDER BY modello, componente`;
  return rows.map(r => ({ modello: r.modello as string, componente: r.componente as string }));
}
