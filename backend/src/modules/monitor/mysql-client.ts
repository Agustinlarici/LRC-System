import mysql from 'mysql2/promise';
import { getIKnowFlags, IKnowDisabledError } from '../../lib/system-flags.js';
import { logger } from '../../lib/logger.js';
import { createGuard, runWithReaper, WebthronBusyError } from './webthron-guard.js';
import { buildRangeSlices } from './webthron-time.js';

export { IKnowDisabledError, WebthronBusyError };

let pool: mysql.Pool | null = null;
let bucciPool: mysql.Pool | null = null;

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// WebThron è MariaDB con tabelle MyISAM: una SELECT lunga blocca le scritture di iKnow.
// Il hint /*+ MAX_EXECUTION_TIME */ è solo MySQL e MariaDB lo ignora: il limite vero è
// `max_statement_time`, impostato su ogni connessione.
const MAX_STATEMENT_SECONDS = Math.max(1, envInt('WEBTHRON_MAX_STATEMENT_SECONDS', 15));

const guard = createGuard({
  minGapMs:      envInt('WEBTHRON_MIN_GAP_MS', 200),
  slowMs:        envInt('WEBTHRON_SLOW_MS', 3000),
  strikesToOpen: Math.max(1, envInt('WEBTHRON_BREAKER_STRIKES', 2)),
  cooldownMs:    envInt('WEBTHRON_BREAKER_COOLDOWN_SECONDS', 300) * 1000,
  maxQueue:      Math.max(1, envInt('WEBTHRON_MAX_QUEUE', 6)),
  onOpen:  (cooldownMs, reason) => logger.warn(`[WebThron] Interruttore di sicurezza APERTO per ${Math.round(cooldownMs / 1000)} s (${reason})`),
  onClose: () => logger.info('[WebThron] Interruttore di sicurezza chiuso: riprendo le query'),
});

// La Spedizione Bucci ha una guardia e una connessione tutte sue: è una scansione manuale di un
// operatore, e non deve restare ferma perché la sync (o un backfill) ha fatto scattare il proprio
// interruttore. Sono comunque solo letture brevi, che su MyISAM non si bloccano tra loro.
const BUCCI_MAX_STATEMENT_SECONDS = Math.max(1, envInt('WEBTHRON_BUCCI_MAX_STATEMENT_SECONDS', 20));

const bucciGuard = createGuard({
  minGapMs:      envInt('WEBTHRON_BUCCI_MIN_GAP_MS', 50),
  slowMs:        envInt('WEBTHRON_BUCCI_SLOW_MS', 5000),
  strikesToOpen: Math.max(1, envInt('WEBTHRON_BUCCI_BREAKER_STRIKES', 3)),
  cooldownMs:    envInt('WEBTHRON_BUCCI_BREAKER_COOLDOWN_SECONDS', 60) * 1000,
  maxQueue:      Math.max(1, envInt('WEBTHRON_BUCCI_MAX_QUEUE', 6)),
  onOpen:  (cooldownMs, reason) => logger.warn(`[WebThron/Bucci] Interruttore di sicurezza APERTO per ${Math.round(cooldownMs / 1000)} s (${reason})`),
  onClose: () => logger.info('[WebThron/Bucci] Interruttore di sicurezza chiuso: riprendo le query'),
});

/** Stato delle guardie (per diagnostica). */
export const getWebthronGuardState = guard.getState;
export const getBucciGuardState    = bucciGuard.getState;

// Strumenti di emergenza (processi attivi, KILL): non fanno coda e funzionano anche a interruttore aperto.
function isEmergencyStatement(arg: unknown): boolean {
  const sql = typeof arg === 'string' ? arg : (arg as { sql?: string } | null)?.sql;
  return typeof sql === 'string' && /^\s*(KILL|SHOW)\b/i.test(sql);
}

export function resetWebthronPool(): void {
  pool = null;
  bucciPool = null;
}

/** Chiude tutte le connessioni verso WebThron (spegnimento del backend). */
export async function closeWebthronPools(): Promise<void> {
  const open = [pool, bucciPool].filter((p): p is mysql.Pool => p !== null);
  await Promise.all(open.map(p => p.end()));
  resetWebthronPool();
}

async function assertIKnowEnabled(): Promise<void> {
  if (!(await getIKnowFlags()).iknow_enabled) throw new IKnowDisabledError();
}

// Metodi che aprono una connessione o eseguono una query verso WebThron.
const GUARDED = new Set<string | symbol>(['execute', 'query', 'getConnection']);

/** Margine oltre il limite del server dopo il quale una query ancora in corso viene tagliata con KILL QUERY. */
const KILL_GRACE_SECONDS = Math.max(1, envInt('WEBTHRON_KILL_GRACE_SECONDS', 5));

/**
 * Taglia sul server la query in corso della connessione `threadId`, da una connessione a parte
 * (quella del pool è occupata dalla query stessa). Un utente può chiudere solo i propri thread.
 * Si usa solo se `max_statement_time` non ha fatto il suo lavoro.
 */
async function killRunningQuery(threadId: number | null, label: string): Promise<void> {
  if (threadId === null || !Number.isInteger(threadId)) {
    logger.warn(`[WebThron${label}] Query oltre il limite ma thread ignoto: impossibile tagliarla`);
    return;
  }
  let killer: mysql.Connection | null = null;
  try {
    killer = await mysql.createConnection({
      host:           process.env.WEBTHRON_HOST ?? '192.168.1.12',
      port:           parseInt(process.env.WEBTHRON_PORT ?? '3306'),
      database:       process.env.WEBTHRON_DB ?? 'WebThron',
      user:           process.env.WEBTHRON_USER ?? '',
      password:       process.env.WEBTHRON_PASS ?? '',
      connectTimeout: 5000,
    });
    await killer.query(`KILL QUERY ${threadId}`);
    logger.warn(`[WebThron${label}] Query oltre il limite: eseguito KILL QUERY ${threadId}`);
  } catch (err) {
    logger.error(`[WebThron${label}] KILL QUERY ${threadId} fallito: ${err instanceof Error ? err.message : err}`);
  } finally {
    await killer?.end().catch(() => {});
  }
}

/**
 * Costruisce un pool verso WebThron con le protezioni: con `iknow_enabled` spento ogni query viene
 * rifiutata prima di toccare la rete; poi passa dalla guardia (coda, pausa, interruttore).
 */
function buildGuardedPool(poolGuard: ReturnType<typeof createGuard>, maxStatementSeconds: number, label = ''): mysql.Pool {
  const raw = mysql.createPool({
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
  // Limite di tempo vero lato server + sessione di sola lettura: nessuna query può
  // restare appesa a bloccare iKnow, e il nostro codice non può scrivere su WebThron.
  // Nessun privilegio admin richiesto.
  // Con connectionLimit = 1 c'è una sola connessione viva: ne ricordiamo il thread per poterla tagliare.
  let threadId: number | null = null;
  raw.on('connection', (conn) => {
    const id = (conn as unknown as { threadId?: number; connection?: { threadId?: number } });
    threadId = id.threadId ?? id.connection?.threadId ?? null;
    // Se un SET viene rifiutato si registra un avviso e si continua: nessun errore non gestito.
    const setup = (sql: string) => {
      const warn = (err: Error) => logger.warn(`[WebThron] Impostazione di sessione non applicata (${sql}): ${err.message}`);
      const r = conn.query(sql) as unknown as { catch?: (f: (e: Error) => void) => unknown; on?: (ev: string, f: (e: Error) => void) => unknown };
      if (typeof r?.catch === 'function') r.catch(warn);
      else if (typeof r?.on === 'function') r.on('error', warn);
    };
    setup('SET SESSION wait_timeout = 300, SESSION interactive_timeout = 300');
    setup(`SET SESSION max_statement_time = ${maxStatementSeconds}`);
    setup('SET SESSION TRANSACTION READ ONLY');
  });
  return new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (!GUARDED.has(prop) || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await assertIKnowEnabled();
        if (prop === 'getConnection') return value.apply(target, args);
        const emergency = isEmergencyStatement(args[0]);
        return poolGuard.run(
          // Rete di sicurezza: se la query è ancora in corso oltre il limite del server, la si taglia
          () => emergency
            ? value.apply(target, args)
            : runWithReaper(
                () => value.apply(target, args),
                (maxStatementSeconds + KILL_GRACE_SECONDS) * 1000,
                () => killRunningQuery(threadId, label),
              ),
          { bypass: emergency },
        );
      };
    },
  });
}

/**
 * Unico punto di uscita verso iKnow per sync, backfill e strumenti di diagnostica.
 * La Spedizione Bucci usa `getBucciPool()`, separato.
 */
export function getWebthronPool(): mysql.Pool {
  if (!pool) pool = buildGuardedPool(guard, MAX_STATEMENT_SECONDS);
  return pool;
}

/** Connessione dedicata alla Spedizione Bucci: coda, interruttore e limiti propri. */
export function getBucciPool(): mysql.Pool {
  if (!bucciPool) bucciPool = buildGuardedPool(bucciGuard, BUCCI_MAX_STATEMENT_SECONDS, '/Bucci');
  return bucciPool;
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
  // Campi extra (opzionali: le righe lette dallo storico locale prima della migrazione 0087 non li hanno)
  versione?:         string | null;   // campo 44
  operatore?:        string | null;   // campo 21
  colore?:           string | null;   // campo 28
  protocollo_cesta?: string | null;   // campo 554
}

export type Combo = { modello: string; componente: string };
export type LineaCombo = { fase: string; modello: string; componente: string };

// ─── Date filter modes ────────────────────────────────────────────────────────

type DateFilter =
  | { mode: 'since'; since: Date }               // datain > ?  — usa indice, incrementale/giornaliero
  | { mode: 'range'; from: string; to: string };  // giorni [from, to] letti a rebanadine di datain (indice), backfill

/** Ore per rebanadina nelle letture di giorni interi: ~1000 documenti al massimo, query da pochi ms. */
const RANGE_SLICE_HOURS = 4;
const SLICE_ROW_LIMIT   = 20_000;

// ─── Unified WebThron query ───────────────────────────────────────────────────
//
// Single function used by:
//   - pg-webthron-sync.ts  (sync ogni 30 s + rilettura notturna → webthron_events_history)
//   - heatmap.ts           (history backfill → webthron_events_history)
//
// Guards:
//   - max_statement_time (sessione) — il server interrompe qualunque query oltre il limite
//   - guardia (webthron-guard.ts): una query alla volta, pausa minima, coda limitata,
//     interruttore di sicurezza se le query diventano lente
//   - connectionLimit = 1 — mai query parallele su WebThron
//   - 'since' e ogni rebanadina di 'range' filtrano su `datain` (indice): nessuna scansione
//
// 'versione' (44) e 'colore' (28) sono liste (id → testo in ikExtraTab);
// 'operatore' (21) e 'protocollo_cesta' (554) sono testo libero.

export async function queryWebthronEvents(
  prodCombos:   LineaCombo[],
  deliberaFasi: string[],
  dateFilter:   DateFilter,
): Promise<WebthronEvent[]> {
  if (prodCombos.length === 0) return [];

  const TIMEOUT_MS = 30 * 1000;   // il limite vero è max_statement_time; questa è la rete di sicurezza lato client

  const prodConditions = prodCombos
    .map(() => `(ikExtra62Tab.stringa = ? AND ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');
  const prodParams = prodCombos.flatMap(c => [c.fase, c.modello, c.componente]);

  const allModelli    = [...new Set(prodCombos.map(c => c.modello))];
  const allComponenti = [...new Set(prodCombos.map(c => c.componente))];

  const delibFasiPH       = deliberaFasi.map(() => '?').join(', ');
  const delibModelliPH    = allModelli.map(() => '?').join(', ');
  const delibComponentiPH = allComponenti.map(() => '?').join(', ');

  const buildSql = (dateClause: string, rowLimit: number) => `
    SELECT
      ikExtra62Tab.stringa  AS fase,
      ikExtra43Tab.stringa  AS modello,
      ikExtra45Tab.stringa  AS componente,
      Extra186.stringa      AS cod_seriale,
      Extra30.stringa       AS commessa,
      CASE WHEN ikExtra62Tab.stringa = 'DELIBERA VERNICIATURA'
        THEN COALESCE(ikExtra71Tab.stringa, ikExtra41Tab.stringa)
        ELSE ikExtra136Tab.stringa
      END AS esito_delibera,
      ubi.datain            AS data_inserimento,
      ikExtra44Tab.stringa  AS versione,
      Extra21.stringa       AS operatore,
      ikExtra28Tab.stringa  AS colore,
      Extra554.stringa      AS protocollo_cesta
    FROM ubidocum ubi
    LEFT JOIN ikExtra    Extra62    ON ubi.iddocu = Extra62.iddocu    AND Extra62.idcampo  = 62  AND Extra62.idcomm = 0 AND Extra62.seq = 0
    LEFT JOIN ikExtra    Extra43    ON ubi.iddocu = Extra43.iddocu    AND Extra43.idcampo  = 43  AND Extra43.idcomm = 0 AND Extra43.seq = 0
    LEFT JOIN ikExtra    Extra45    ON ubi.iddocu = Extra45.iddocu    AND Extra45.idcampo  = 45  AND Extra45.idcomm = 0 AND Extra45.seq = 0
    LEFT JOIN ikExtra    Extra186   ON ubi.iddocu = Extra186.iddocu   AND Extra186.idcampo = 186 AND Extra186.idcomm = 0 AND Extra186.seq = 0
    LEFT JOIN ikExtra    Extra30    ON ubi.iddocu = Extra30.iddocu    AND Extra30.idcampo  = 30  AND Extra30.idcomm  = 0 AND Extra30.seq  = 0
    LEFT JOIN ikExtra    Extra136   ON ubi.iddocu = Extra136.iddocu   AND Extra136.idcampo = 136 AND Extra136.idcomm = 0 AND Extra136.seq = 0
    LEFT JOIN ikExtra    Extra71    ON ubi.iddocu = Extra71.iddocu    AND Extra71.idcampo  = 71  AND Extra71.idcomm = 0 AND Extra71.seq  = 0
    LEFT JOIN ikExtra    Extra41    ON ubi.iddocu = Extra41.iddocu    AND Extra41.idcampo  = 41  AND Extra41.idcomm = 0 AND Extra41.seq  = 0
    LEFT JOIN ikExtra    Extra44    ON ubi.iddocu = Extra44.iddocu    AND Extra44.idcampo  = 44  AND Extra44.idcomm = 0 AND Extra44.seq  = 0
    LEFT JOIN ikExtra    Extra21    ON ubi.iddocu = Extra21.iddocu    AND Extra21.idcampo  = 21  AND Extra21.idcomm = 0 AND Extra21.seq  = 0
    LEFT JOIN ikExtra    Extra28    ON ubi.iddocu = Extra28.iddocu    AND Extra28.idcampo  = 28  AND Extra28.idcomm = 0 AND Extra28.seq  = 0
    LEFT JOIN ikExtra    Extra554   ON ubi.iddocu = Extra554.iddocu   AND Extra554.idcampo = 554 AND Extra554.idcomm = 0 AND Extra554.seq = 0
    LEFT JOIN ikExtraTab ikExtra62Tab  ON ikExtra62Tab.id  = Extra62.stringa
    LEFT JOIN ikExtraTab ikExtra43Tab  ON ikExtra43Tab.id  = Extra43.stringa
    LEFT JOIN ikExtraTab ikExtra45Tab  ON ikExtra45Tab.id  = Extra45.stringa
    LEFT JOIN ikExtraTab ikExtra136Tab ON ikExtra136Tab.id = Extra136.stringa
    LEFT JOIN ikExtraTab ikExtra71Tab  ON ikExtra71Tab.id  = Extra71.stringa
    LEFT JOIN ikExtraTab ikExtra41Tab  ON ikExtra41Tab.id  = Extra41.stringa
    LEFT JOIN ikExtraTab ikExtra44Tab  ON ikExtra44Tab.id  = Extra44.stringa
    LEFT JOIN ikExtraTab ikExtra28Tab  ON ikExtra28Tab.id  = Extra28.stringa
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

  const tailParams = [...prodParams, ...deliberaFasi, ...allModelli, ...allComponenti];

  const fetchRows = async (sql: string, dateParams: unknown[]): Promise<WebthronEvent[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows] = await (getWebthronPool() as any).execute({ sql, timeout: TIMEOUT_MS }, [...dateParams, ...tailParams]);
    return (rows as Array<Record<string, unknown>>).map(r => ({
      fase:             r.fase             as string,
      modello:          r.modello          as string,
      componente:       r.componente       as string,
      cod_seriale:      r.cod_seriale      as string,
      commessa:         (r.commessa         as string | null) ?? null,
      esito_delibera:   r.esito_delibera   as string | null,
      data_inserimento: r.data_inserimento as Date,
      versione:         (r.versione         as string | null) ?? null,
      operatore:        (r.operatore        as string | null) ?? null,
      colore:           (r.colore           as string | null) ?? null,
      protocollo_cesta: (r.protocollo_cesta as string | null) ?? null,
    }));
  };

  if (dateFilter.mode === 'since') {
    return fetchRows(buildSql('AND ubi.datain > ?', 5000), [dateFilter.since]);
  }

  // Giorni interi: tante query piccole su `datain` (con la pausa della guardia tra una e l'altra)
  // invece di una query unica che blocca le tabelle per secondi.
  const sql = buildSql('AND ubi.datain >= ? AND ubi.datain < ?', SLICE_ROW_LIMIT);
  const result: WebthronEvent[] = [];
  for (const slice of buildRangeSlices(dateFilter.from, dateFilter.to, RANGE_SLICE_HOURS)) {
    const rows = await fetchRows(sql, [slice.from, slice.to]);
    if (rows.length >= SLICE_ROW_LIMIT) {
      logger.warn(`[WebThron] Rebanadina ${slice.from} → ${slice.to} al limite di ${SLICE_ROW_LIMIT} righe: dati troncati`);
    }
    result.push(...rows);
  }
  return result;
}
