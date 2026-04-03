import { getWebthronPool } from '../monitor/mysql-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BufferCombo = { modello: string; componente: string };
export type BufferItem  = { seriale: string; commessa: string | null };

const QUERY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// ─── Raw fetch ────────────────────────────────────────────────────────────────
//
// Flat SELECT with tipdoc + date + componente filter — no GROUP BY, no subqueries.
// All logic (last document per serial, fase/combo filter) is done in JS.
//

type RawRow = {
  iddocu:     number;
  seriale:    string | null;
  fase:       string | null;
  modello:    string | null;
  componente: string | null;
  commessa:   string | null;
};

async function fetchRawDocuments(componenti: string[]): Promise<RawRow[]> {
  if (componenti.length === 0) return [];

  const compPh  = componenti.map(() => '?').join(', ');
  const tipdoc  = `'0080','0160','1520','5004','5005','5006','5007','5010','5016','PX01'`;

  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(300000) */
      ubi.iddocu,
      Extra186.stringa     AS seriale,
      ikExtra62Tab.stringa AS fase,
      ikExtra43Tab.stringa AS modello,
      ikExtra45Tab.stringa AS componente,
      Extra30.stringa      AS commessa
    FROM ubidocum AS ubi
    LEFT JOIN ikExtra AS Extra186 ON ubi.iddocu = Extra186.iddocu AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
    LEFT JOIN ikExtra AS Extra62  ON ubi.iddocu = Extra62.iddocu  AND Extra62.idcampo  = 62  AND Extra62.idcomm  = 0 AND Extra62.seq  = 0
    LEFT JOIN ikExtra AS Extra43  ON ubi.iddocu = Extra43.iddocu  AND Extra43.idcampo  = 43  AND Extra43.idcomm  = 0 AND Extra43.seq  = 0
    LEFT JOIN ikExtra AS Extra45  ON ubi.iddocu = Extra45.iddocu  AND Extra45.idcampo  = 45  AND Extra45.idcomm  = 0 AND Extra45.seq  = 0
    LEFT JOIN ikExtra AS Extra30  ON ubi.iddocu = Extra30.iddocu  AND Extra30.idcampo  = 30  AND Extra30.idcomm  = 0 AND Extra30.seq  = 0
    LEFT JOIN ikExtraTab AS ikExtra62Tab ON ikExtra62Tab.id = Extra62.stringa
    LEFT JOIN ikExtraTab AS ikExtra43Tab ON ikExtra43Tab.id = Extra43.stringa
    LEFT JOIN ikExtraTab AS ikExtra45Tab ON ikExtra45Tab.id = Extra45.stringa
    WHERE ubi.tipdoc IN (${tipdoc})
      AND ubi.datain >= CURDATE() - INTERVAL 14 DAY
      AND ikExtra45Tab.stringa IN (${compPh})
    LIMIT 15000
  `;

  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT }, componenti);
  return rows as RawRow[];
}

// ─── JS processing ────────────────────────────────────────────────────────────
//
// 1. For each serial keep only the row with the highest iddocu (last document)
// 2. Filter: fase + modello + componente match config AND commessa not null
//

function processForLinea(rows: RawRow[], fasi: string[], combos: BufferCombo[]): BufferItem[] {
  if (fasi.length === 0 || combos.length === 0) return [];

  // Step 1 — last document per serial
  const lastDoc = new Map<string, RawRow>();
  for (const row of rows) {
    if (!row.seriale) continue;
    const existing = lastDoc.get(row.seriale);
    if (!existing || row.iddocu > existing.iddocu) {
      lastDoc.set(row.seriale, row);
    }
  }

  // Step 2 — filter by fase + combo + commessa
  const result: BufferItem[] = [];
  for (const row of lastDoc.values()) {
    if (
      row.fase      && fasi.includes(row.fase) &&
      row.modello   && row.componente           &&
      row.commessa  &&
      combos.some(c => c.modello === row.modello && c.componente === row.componente)
    ) {
      result.push({ seriale: row.seriale!, commessa: row.commessa });
    }
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function queryBuffer(fasi: string[], combos: BufferCombo[]): Promise<BufferItem[]> {
  if (fasi.length === 0 || combos.length === 0) return [];
  const componenti = [...new Set(combos.map(c => c.componente))];
  const rows = await fetchRawDocuments(componenti);
  return processForLinea(rows, fasi, combos);
}

export type LineaInput = { id: number; fasi: string[]; combos: BufferCombo[] };

export async function queryBufferAll(linee: LineaInput[]): Promise<Map<number, BufferItem[]>> {
  const result = new Map<number, BufferItem[]>(linee.map(l => [l.id, []]));
  const valid  = linee.filter(l => l.fasi.length > 0 && l.combos.length > 0);
  if (valid.length === 0) return result;

  // All unique componenti across all linee — one MySQL round-trip
  const componenti = [...new Set(valid.flatMap(l => l.combos.map(c => c.componente)))];
  const rows = await fetchRawDocuments(componenti);

  for (const linea of valid) {
    result.set(linea.id, processForLinea(rows, linea.fasi, linea.combos));
  }
  return result;
}

// ─── Lookup queries (con cache in memoria — TTL 24h) ─────────────────────────
// queryFasi e queryModelliComponenti sono dati quasi-statici (lista fasi/modelli
// da WebThron). Vengono interrogati solo ad ogni apertura delle impostazioni buffer.
// La cache evita query ripetute a WebThron: si aggiorna al massimo una volta al giorno.

const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore

let fasiCache:     { data: string[];     ts: number } | null = null;
let modelliCache:  { data: BufferCombo[]; ts: number } | null = null;

export async function queryFasi(): Promise<string[]> {
  if (fasiCache && Date.now() - fasiCache.ts < LOOKUP_TTL_MS) return fasiCache.data;
  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(300000) */ DISTINCT t.stringa AS fase
    FROM ikExtraTab t
    WHERE t.id IN (SELECT DISTINCT e.stringa FROM ikExtra e WHERE e.idcampo = 62)
    ORDER BY t.stringa
    LIMIT 1000
  `;
  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT });
  const data = (rows as Array<{ fase: string }>).map(r => r.fase);
  fasiCache = { data, ts: Date.now() };
  return data;
}

export async function queryModelliComponenti(): Promise<BufferCombo[]> {
  if (modelliCache && Date.now() - modelliCache.ts < LOOKUP_TTL_MS) return modelliCache.data;
  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(300000) */ DISTINCT t43.stringa AS modello, t45.stringa AS componente
    FROM ikExtra e43
    JOIN ikExtraTab t43 ON t43.id = e43.stringa AND e43.idcampo = 43
    JOIN ikExtra e45    ON e45.iddocu = e43.iddocu AND e45.idcampo = 45 AND e45.idcomm = 0 AND e45.seq = 0
    JOIN ikExtraTab t45 ON t45.id = e45.stringa
    WHERE e43.idcomm = 0 AND e43.seq = 0
    ORDER BY t43.stringa, t45.stringa
    LIMIT 1000
  `;
  const [rows] = await getWebthronPool().execute({ sql, timeout: QUERY_TIMEOUT });
  const data = (rows as Array<{ modello: string; componente: string }>).map(r => ({
    modello:    r.modello,
    componente: r.componente,
  }));
  modelliCache = { data, ts: Date.now() };
  return data;
}
