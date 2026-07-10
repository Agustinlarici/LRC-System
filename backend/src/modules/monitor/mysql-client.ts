import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function resetWebthronPool(): void {
  pool = null;
}

export function getWebthronPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:             process.env.WEBTHRON_HOST ?? '192.168.1.12',
      port:             parseInt(process.env.WEBTHRON_PORT ?? '3306'),
      database:         process.env.WEBTHRON_DB ?? 'WebThron',
      user:             process.env.WEBTHRON_USER ?? '',
      password:         process.env.WEBTHRON_PASS ?? '',
      waitForConnections: true,
      connectionLimit:  1,   // mai più di 1 query parallela su WebThron
      queueLimit:       2,   // al massimo 2 in coda, poi rifiuta
      timezone:         'local',
      connectTimeout:   8000,
    });
    // Libera la connessione in 5 min di inattività invece degli 8h di default MySQL.
    // Nessun privilegio admin richiesto.
    pool.on('connection', (conn) => {
      conn.query('SET SESSION wait_timeout = 300, SESSION interactive_timeout = 300');
    });
  }
  return pool;
}

// ─── Shared type ──────────────────────────────────────────────────────────────

export interface WebthronEvent {
  fase:             string;
  modello:          string;
  componente:       string;
  cod_seriale:      string;
  commessa:         string | null;
  esito_delibera:   string | null;
  data_inserimento: Date;
}

export type Combo = { modello: string; componente: string };
export type LineaCombo = { fase: string; modello: string; componente: string };

// ─── Date filter modes ────────────────────────────────────────────────────────

type DateFilter =
  | { mode: 'since'; since: Date }               // datain > ?  — usa indice, incrementale/giornaliero
  | { mode: 'range'; from: string; to: string };  // DATE(CONVERT_TZ(datain,...)) BETWEEN ? AND ? — backfill

// ─── Unified WebThron query ───────────────────────────────────────────────────
//
// Single function used by:
//   - pg-webthron-sync.ts  (daily sync → webthron_events_history)
//   - heatmap.ts           (history backfill → webthron_events_history)
//
// Guards:
//   - MAX_EXECUTION_TIME(180000) hint — server-side timeout 3 min
//   - Driver timeout: 3 min
//   - wait_timeout = 300 s — MySQL libera connessione idle in 5 min
//   - connectionLimit = 1 — mai query parallele su WebThron
//   - mode 'since' usa indice su datain — nessun full table scan

export async function queryWebthronEvents(
  prodCombos:   LineaCombo[],
  deliberaFasi: string[],
  dateFilter:   DateFilter,
): Promise<WebthronEvent[]> {
  if (prodCombos.length === 0) return [];

  const TIMEOUT_MS = 3 * 60 * 1000;

  const prodConditions = prodCombos
    .map(() => `(ikExtra62Tab.stringa = ? AND ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');
  const prodParams = prodCombos.flatMap(c => [c.fase, c.modello, c.componente]);

  const allModelli    = [...new Set(prodCombos.map(c => c.modello))];
  const allComponenti = [...new Set(prodCombos.map(c => c.componente))];

  const delibFasiPH       = deliberaFasi.map(() => '?').join(', ');
  const delibModelliPH    = allModelli.map(() => '?').join(', ');
  const delibComponentiPH = allComponenti.map(() => '?').join(', ');

  let dateClause: string;
  let dateParams: unknown[];
  let rowLimit:   number;

  switch (dateFilter.mode) {
    case 'since':
      dateClause  = `AND ubi.datain > ?`;
      dateParams  = [dateFilter.since];
      rowLimit    = 5000;
      break;
    case 'range':
      dateClause  = `AND DATE(CONVERT_TZ(ubi.datain, '+00:00', '+01:00')) BETWEEN ? AND ?`;
      dateParams  = [dateFilter.from, dateFilter.to];
      rowLimit    = 200000;
      break;
  }

  const sql = `
    SELECT /*+ MAX_EXECUTION_TIME(180000) */
      ikExtra62Tab.stringa  AS fase,
      ikExtra43Tab.stringa  AS modello,
      ikExtra45Tab.stringa  AS componente,
      Extra186.stringa      AS cod_seriale,
      Extra30.stringa       AS commessa,
      CASE WHEN ikExtra62Tab.stringa = 'DELIBERA VERNICIATURA'
        THEN COALESCE(ikExtra71Tab.stringa, ikExtra41Tab.stringa)
        ELSE ikExtra136Tab.stringa
      END AS esito_delibera,
      ubi.datain            AS data_inserimento
    FROM ubidocum ubi
    LEFT JOIN ikExtra    Extra62    ON ubi.iddocu = Extra62.iddocu    AND Extra62.idcampo  = 62  AND Extra62.idcomm = 0 AND Extra62.seq = 0
    LEFT JOIN ikExtra    Extra43    ON ubi.iddocu = Extra43.iddocu    AND Extra43.idcampo  = 43  AND Extra43.idcomm = 0 AND Extra43.seq = 0
    LEFT JOIN ikExtra    Extra45    ON ubi.iddocu = Extra45.iddocu    AND Extra45.idcampo  = 45  AND Extra45.idcomm = 0 AND Extra45.seq = 0
    LEFT JOIN ikExtra    Extra186   ON ubi.iddocu = Extra186.iddocu   AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
    LEFT JOIN ikExtra    Extra30    ON ubi.iddocu = Extra30.iddocu    AND Extra30.idcampo  = 30  AND Extra30.idcomm  = 0 AND Extra30.seq  = 0
    LEFT JOIN ikExtra    Extra136   ON ubi.iddocu = Extra136.iddocu   AND Extra136.idcampo = 136 AND Extra136.idcomm = 0 AND Extra136.seq = 0
    LEFT JOIN ikExtra    Extra71    ON ubi.iddocu = Extra71.iddocu    AND Extra71.idcampo  = 71  AND Extra71.idcomm = 0 AND Extra71.seq  = 0
    LEFT JOIN ikExtra    Extra41    ON ubi.iddocu = Extra41.iddocu    AND Extra41.idcampo  = 41  AND Extra41.idcomm = 0 AND Extra41.seq  = 0
    LEFT JOIN ikExtraTab ikExtra62Tab  ON ikExtra62Tab.id  = Extra62.stringa
    LEFT JOIN ikExtraTab ikExtra43Tab  ON ikExtra43Tab.id  = Extra43.stringa
    LEFT JOIN ikExtraTab ikExtra45Tab  ON ikExtra45Tab.id  = Extra45.stringa
    LEFT JOIN ikExtraTab ikExtra136Tab ON ikExtra136Tab.id = Extra136.stringa
    LEFT JOIN ikExtraTab ikExtra71Tab  ON ikExtra71Tab.id  = Extra71.stringa
    LEFT JOIN ikExtraTab ikExtra41Tab  ON ikExtra41Tab.id  = Extra41.stringa
    WHERE
      ubi.tipdoc IN ('0080','1520','5004','5005','5006','5007','5010','5016','PX01','0160','0090','5019','1040','5009','5018','0480','5020')
      ${dateClause}
      AND Extra186.stringa     IS NOT NULL
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
    LIMIT ${rowLimit}
  `;

  const params = [
    ...dateParams,
    ...prodParams,
    ...deliberaFasi, ...allModelli, ...allComponenti,
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (getWebthronPool() as any).execute({ sql, timeout: TIMEOUT_MS }, params);
  return (rows as Array<Record<string, unknown>>).map(r => ({
    fase:             r.fase             as string,
    modello:          r.modello          as string,
    componente:       r.componente       as string,
    cod_seriale:      r.cod_seriale      as string,
    commessa:         (r.commessa        as string | null) ?? null,
    esito_delibera:   r.esito_delibera   as string | null,
    data_inserimento: r.data_inserimento as Date,
  }));
}
