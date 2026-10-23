import { getWebthronPool } from '../monitor/mysql-client.js';

// Documenti iKnow "cofano Bucci": ubidocum.tipdoc 0330, componente 'cofano'
const BUCCI_TIPDOC     = '0330';
const BUCCI_COMPONENTE = 'cofano';

const QUERY_TIMEOUT_MS = 8_000;
const MAX_ROWS         = 100;
const MAX_BATCH_ROWS   = 2000;

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_LOOKBACK_DAYS     = 365;

export interface BucciUnit {
  seriale:    string;
  componente: string | null;
  commessa:   string | null;
  modello:    string | null;
}

export type ParsedScan =
  | { kind: 'commessa'; commessa: string }
  | { kind: 'seriale';  seriale: string };

/** Finestra di ricerca su ubidocum.datain, per non scansionare l'intero storico. */
export function lookbackDays(): number {
  const n = parseInt(process.env.BUCCI_LOOKBACK_DAYS ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(n, MAX_LOOKBACK_DAYS);
}

/**
 * "BUCC…" + 4 cifre finali → commessa (ultime 4 cifre); qualsiasi altro codice → seriale.
 * Ritorna null per codici vuoti, troppo lunghi o con caratteri di controllo.
 */
export function parseScan(raw: string): ParsedScan | null {
  const code = raw.trim();
  if (!code || code.length > 64 || /[\u0000-\u001f\u007f]/.test(code)) return null;

  if (code.toUpperCase().startsWith('BUCC')) {
    const tail = code.slice(-4);
    return /^\d{4}$/.test(tail) ? { kind: 'commessa', commessa: tail } : null;
  }
  return { kind: 'seriale', seriale: code };
}

/** Deduplica per seriale mantenendo l'ordine di arrivo. */
export function dedupeBySeriale(rows: BucciUnit[]): BucciUnit[] {
  const seen = new Map<string, BucciUnit>();
  for (const r of rows) if (!seen.has(r.seriale)) seen.set(r.seriale, r);
  return [...seen.values()];
}

const SQL_BASE = `
  SELECT /*+ MAX_EXECUTION_TIME(5000) */
    Extra186.stringa     AS seriale,
    ikExtra45Tab.stringa AS componente,
    Extra30.stringa      AS commessa,
    ikExtra43Tab.stringa AS modello
  FROM ubidocum ubi
  LEFT JOIN ikExtra Extra43
    ON ubi.iddocu = Extra43.iddocu  AND Extra43.idcampo  = 43  AND Extra43.idcomm  = 0 AND Extra43.seq  = 0
  LEFT JOIN ikExtraTab ikExtra43Tab
    ON ikExtra43Tab.id = Extra43.stringa
  LEFT JOIN ikExtra Extra186
    ON ubi.iddocu = Extra186.iddocu AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
  LEFT JOIN ikExtra Extra45
    ON ubi.iddocu = Extra45.iddocu  AND Extra45.idcampo  = 45  AND Extra45.idcomm  = 0 AND Extra45.seq  = 0
  LEFT JOIN ikExtra Extra30
    ON ubi.iddocu = Extra30.iddocu  AND Extra30.idcampo  = 30  AND Extra30.idcomm  = 0 AND Extra30.seq  = 0
  LEFT JOIN ikExtraTab ikExtra45Tab
    ON ikExtra45Tab.id = Extra45.stringa
  WHERE ubi.tipdoc = ?
    AND ubi.datain >= ?
    AND ikExtra45Tab.stringa = ?
    AND Extra186.stringa IS NOT NULL
`;

async function run(column: string, values: string[], days: number, maxRows = MAX_ROWS): Promise<BucciUnit[]> {
  if (values.length === 0) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  const marks = values.map(() => '?').join(',');
  const sql   = `${SQL_BASE} AND ${column} IN (${marks}) ORDER BY ubi.datain DESC LIMIT ${maxRows}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (getWebthronPool() as any).execute(
    { sql, timeout: QUERY_TIMEOUT_MS },
    [BUCCI_TIPDOC, since, BUCCI_COMPONENTE, ...values],
  );
  return dedupeBySeriale((rows as Array<Record<string, unknown>>).map(r => ({
    seriale:    String(r.seriale),
    componente: (r.componente as string | null) ?? null,
    commessa:   (r.commessa   as string | null) ?? null,
    modello:    (r.modello    as string | null) ?? null,
  })));
}

export const findBySeriale  = (seriale: string,  days = lookbackDays()) => run('Extra186.stringa', [seriale],  days);
export const findByCommessa = (commessa: string, days = lookbackDays()) => run('Extra30.stringa',  [commessa], days);

// Versioni "in blocco" per la verifica alla chiusura: una sola query per tutti i codici della spedizione
export const findBySerialiMany  = (seriali: string[],   days = lookbackDays()) => run('Extra186.stringa', seriali,   days, MAX_BATCH_ROWS);
export const findByCommesseMany = (commesse: string[],  days = lookbackDays()) => run('Extra30.stringa',  commesse,  days, MAX_BATCH_ROWS);

// "Tipo Lotto Primer": campo 121 (id → descrizione via ikExtraTab, come gli altri campi lista) del documento di fase primer (tipdoc 0031, fase *461*),
// collegato al cofano tramite il seriale (campo 186). Una sola riga, solo per il seriale salvato.
const PRIMER_TIPDOC    = '0031';
const PRIMER_FASE_LIKE = '%461%';

const SQL_PRIMER = `
  SELECT /*+ MAX_EXECUTION_TIME(5000) */
    Extra186.stringa AS seriale,
    COALESCE(ikExtra121Tab.stringa, Extra121.stringa) AS tipo_lotto_primer
  FROM ubidocum ubi
  JOIN ikExtra Extra186
    ON ubi.iddocu = Extra186.iddocu AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
  JOIN ikExtra Extra62
    ON ubi.iddocu = Extra62.iddocu  AND Extra62.idcampo  = 62  AND Extra62.idcomm  = 0 AND Extra62.seq  = 0
  JOIN ikExtra Extra121
    ON ubi.iddocu = Extra121.iddocu AND Extra121.idcampo = 121 AND Extra121.idcomm = 0 AND Extra121.seq = 0
  LEFT JOIN ikExtraTab ikExtra121Tab
    ON ikExtra121Tab.id = Extra121.stringa
  WHERE ubi.tipdoc = ?
    AND ubi.datain >= ?
    AND Extra62.stringa LIKE ?
    AND Extra121.stringa IS NOT NULL AND Extra121.stringa <> ''
    AND Extra186.stringa IN (%MARKS%)
  ORDER BY ubi.datain DESC
  LIMIT ${MAX_BATCH_ROWS}
`;

/** Tipo Lotto Primer per più seriali con una sola query. Chiave della mappa: seriale in maiuscolo. */
export async function findTipoLottoPrimerMany(seriali: string[], days = lookbackDays()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (seriali.length === 0) return out;
  const since = new Date(Date.now() - days * 86_400_000);
  const sql   = SQL_PRIMER.replace('%MARKS%', seriali.map(() => '?').join(','));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (getWebthronPool() as any).execute(
    { sql, timeout: QUERY_TIMEOUT_MS },
    [PRIMER_TIPDOC, since, PRIMER_FASE_LIKE, ...seriali],
  );
  // righe già ordinate dalla più recente: vale la prima di ogni seriale
  for (const r of rows as Array<Record<string, unknown>>) {
    const key = String(r.seriale).toUpperCase();
    if (!out.has(key)) out.set(key, String(r.tipo_lotto_primer));
  }
  return out;
}
