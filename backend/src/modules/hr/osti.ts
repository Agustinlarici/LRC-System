import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import mysql from 'mysql2/promise';
import { requireManage, type Env } from '../../lib/auth.js';

// Lettura dell'elenco dipendenti dal database MySQL di Osti (tabella juniorweb.dipendenti).
// Solo SELECT: l'utente MySQL ha solo SELECT/SHOW VIEW e non si scrive mai su Osti.
// Le righe escono nello stesso formato del CSV "elenco_dipendenti.csv" (chiavi dip_*, valori
// stringa, date gg/mm/aaaa), così l'import del frontend funziona uguale con CSV o con MySQL.
// Si leggono solo le colonne che servono: IBAN, PIN, retribuzione ecc. non escono mai da qui.

const TIMEOUT_MS = 30_000;

let pool: mysql.Pool | null = null;

function getOstiPool(): mysql.Pool {
  if (!process.env.OSTI_HOST || !process.env.OSTI_USER) {
    throw new HTTPException(503, { message: 'Connessione a Osti non configurata (OSTI_HOST / OSTI_USER)' });
  }
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.OSTI_HOST,
      port:               parseInt(process.env.OSTI_PORT ?? '3306'),
      database:           process.env.OSTI_DB ?? 'juniorweb',
      user:               process.env.OSTI_USER,
      password:           process.env.OSTI_PASS ?? '',
      waitForConnections: true,
      connectionLimit:    1,   // mai più di una query alla volta su Osti
      queueLimit:         2,
      connectTimeout:     8000,
    });
    // Libera la connessione in 5 min di inattività
    pool.on('connection', (conn) => {
      conn.query('SET SESSION wait_timeout = 300, SESSION interactive_timeout = 300');
    });
  }
  return pool;
}

const DATE_COLS = ['dip_assunto', 'dip_licenziato', 'dip_indeterminato_data', 'dip_nato_data'];
const TEXT_COLS = [
  'dip_nome', 'dip_matricola', 'dip_mansione', 'dip_qualifica', 'dip_livello', 'dip_nazione',
  'dip_indirizzo', 'dip_citta', 'dip_prov', 'dip_cap', 'dip_nato_luogo', 'dip_sesso', 'dip_cf',
  'dip_cellulare', 'dip_note', 'dip_transponder', 'dip_domicilio_indirizzo', 'dip_domicilio_citta',
  'dip_domicilio_prov', 'dip_domicilio_cap', 'dip_statocivile', 'dip_email', 'dip_note_hr',
  'dip_badge', 'dip_terminale', 'dip_indeterminato', 'dip_partime',
];

// I codici dip_reparto / dip_ditta / dip_filiale / dip_centrodicosto puntano a tabelle di Osti:
// escono già risolti in nome, con la chiave del CSV (reparto) più ditta, filiale, centro_di_costo.
const SQL = `
  SELECT /*+ MAX_EXECUTION_TIME(${TIMEOUT_MS}) */
    ${TEXT_COLS.map(c => `d.\`${c}\``).join(', ')},
    ${DATE_COLS.map(c => `DATE_FORMAT(d.\`${c}\`, '%d/%m/%Y') AS \`${c}\``).join(', ')},
    rp.rp_nome AS reparto, az.az_nome AS ditta, fl.fl_nome AS filiale, cdc.cdc_nome AS centro_di_costo
  FROM dipendenti d
  LEFT JOIN reparti       rp  ON rp.rp_id   = d.dip_reparto
  LEFT JOIN aziende       az  ON az.az_id   = d.dip_ditta
  LEFT JOIN filiali       fl  ON fl.fl_id   = d.dip_filiale
  LEFT JOIN centridicosto cdc ON cdc.cdc_id = d.dip_centrodicosto
`;

export type OstiRow = Record<string, string>;

export async function readOstiEmployees(): Promise<OstiRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await (getOstiPool() as any).query({ sql: SQL, timeout: TIMEOUT_MS });
  return (rows as Array<Record<string, unknown>>).map(r =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v).trim()])));   // Osti ha nomi con spazi ai bordi
}

export const hrOstiRoutes = new Hono<Env>();

hrOstiRoutes.get('/dipendenti', requireManage('hr'), async (c) => {
  try {
    return c.json(await readOstiEmployees());
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // Il messaggio del driver può contenere host/utente: nel log sì, nella risposta no
    console.error('[osti] lettura fallita:', err);
    throw new HTTPException(502, { message: 'Impossibile leggere i dati da Osti (database non raggiungibile o in timeout)' });
  }
});
