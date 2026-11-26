/**
 * Copia notturna dei documenti BOM di iKnow in webthron_bom (vista v_iknow_bom per Power BI).
 *
 * Al posto di una query unica con 9 JOIN e ORDER BY (che su ubidocum/ikExtra, tabelle MyISAM,
 * tiene un lock di lettura lungo), si fa leggere WebThron a piccoli passi:
 *   1. una lettura sull'indice di `tipdoc`: gli iddocu dei BOM e la data (nessun JOIN, nessun ORDER BY);
 *   2. i campi extra a lotti di iddocu, solo per chiave primaria (iddocu, idcampo, idcomm, seq);
 *   3. i testi delle liste da ikExtraTab (1.200 righe circa), una volta sola.
 * Ogni passo passa dalla guardia (una query alla volta, pausa, limite di tempo sul server,
 * interruttore di sicurezza). Gira una volta a notte e si può lanciare a mano.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';
import { startRun, endRun, failRun } from '../../lib/sync-stats.js';
import { getWebthronPool } from './mysql-client.js';

const BATCH_IDS    = 500;     // iddocu per lotto verso WebThron
const INSERT_CHUNK = 1000;    // righe per INSERT in PostgreSQL (7 colonne)
const MAX_DOCS     = Math.max(1000, parseInt(process.env.WEBTHRON_BOM_MAX_DOCS ?? '', 10) || 200_000);
const TIMEOUT_MS   = 30 * 1000;   // rete di sicurezza lato client; il limite vero è max_statement_time

// Campi extra letti: idcampo → colonna. Gli ultimi tre sono liste (id → testo in ikExtraTab).
const CAMPI = { 205: 'codice_vendita', 246: 'descrizione', 43: 'modello', 265: 'codint', 45: 'componente', 44: 'versione' } as const;
const CAMPI_LISTA = new Set([43, 45, 44]);

export interface BomRecord {
  iddocu:           number;
  data_inserimento: Date | null;
  codice_vendita:   string | null;
  descrizione:      string | null;
  modello:          string | null;
  codint:           string | null;
  componente:       string | null;
  versione:         string | null;
}

let running = false;

export function isBomSyncRunning(): boolean {
  return running;
}

/** Spezza una lista in gruppi di al massimo `size` elementi. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Unisce documenti, campi extra e testi delle liste in righe pronte per PostgreSQL. */
export function buildBomRecords(
  docs:   Array<{ iddocu: number; datain: Date | null }>,
  extra:  Array<{ iddocu: number; idcampo: number; stringa: string | null }>,
  lista:  Map<string, string>,
): BomRecord[] {
  const byDoc = new Map<number, Partial<Record<(typeof CAMPI)[keyof typeof CAMPI], string>>>();
  for (const e of extra) {
    const col = CAMPI[e.idcampo as keyof typeof CAMPI];
    if (!col || e.stringa === null) continue;
    const valore = CAMPI_LISTA.has(e.idcampo) ? (lista.get(String(e.stringa)) ?? null) : e.stringa;
    if (valore === null) continue;
    const riga = byDoc.get(e.iddocu) ?? {};
    riga[col] = valore;
    byDoc.set(e.iddocu, riga);
  }
  return docs.map(d => {
    const r = byDoc.get(d.iddocu) ?? {};
    return {
      iddocu:           d.iddocu,
      data_inserimento: d.datain,
      codice_vendita:   r.codice_vendita ?? null,
      descrizione:      r.descrizione    ?? null,
      modello:          r.modello        ?? null,
      codint:           r.codint         ?? null,
      componente:       r.componente     ?? null,
      versione:         r.versione       ?? null,
    };
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function leggi<T>(sql: string): Promise<T[]> {
  const [rows] = await (getWebthronPool() as any).execute({ sql, timeout: TIMEOUT_MS });
  return rows as T[];
}

/**
 * Legge i BOM da WebThron e li copia in webthron_bom. Ritorna le righe lette (o null se saltata).
 * Con `force` ignora l'interruttore della query ma non quello generale di iKnow (lo controlla il pool).
 */
export async function syncBom(opts: { force?: boolean } = {}): Promise<number | null> {
  if (!process.env.WEBTHRON_HOST) return null;
  if (!opts.force && !(await isIKnowEnabled('iknow_bom_enabled'))) {
    logger.debug('[BomSync] Disabilitata — skip');
    return null;
  }
  if (running) throw new Error('Sync BOM già in corso');

  running = true;
  startRun('bom_sync');
  try {
    // 1. Documenti BOM: lettura sull'indice di tipdoc, senza JOIN né ORDER BY
    const docsRaw = await leggi<{ iddocu: number; datain: Date | null }>(
      `SELECT iddocu, datain FROM ubidocum WHERE tipdoc = 'BOM'`,
    );
    if (docsRaw.length > MAX_DOCS) {
      throw new Error(`Troppi documenti BOM (${docsRaw.length} > ${MAX_DOCS}): sync annullata, alzare WEBTHRON_BOM_MAX_DOCS se è corretto`);
    }
    const docs = docsRaw.map(d => ({ iddocu: Number(d.iddocu), datain: d.datain }));
    if (docs.length === 0) { endRun('bom_sync', 0); return 0; }

    // 3. Testi delle liste (tabella piccola)
    const tab = await leggi<{ id: number | string; stringa: string | null }>(`SELECT id, stringa FROM ikExtraTab`);
    const lista = new Map<string, string>();
    for (const t of tab) if (t.stringa !== null) lista.set(String(t.id), t.stringa);

    // 2. Campi extra a lotti, solo per chiave primaria
    const campi = Object.keys(CAMPI).join(',');
    const extra: Array<{ iddocu: number; idcampo: number; stringa: string | null }> = [];
    for (const ids of chunk(docs.map(d => d.iddocu), BATCH_IDS)) {
      const rows = await leggi<{ iddocu: number; idcampo: number; stringa: string | null }>(
        `SELECT iddocu, idcampo, stringa FROM ikExtra
         WHERE iddocu IN (${ids.join(',')}) AND idcampo IN (${campi}) AND idcomm = 0 AND seq = 0`,
      );
      for (const r of rows) extra.push({ iddocu: Number(r.iddocu), idcampo: Number(r.idcampo), stringa: r.stringa });
    }

    // Scrittura in PostgreSQL: aggiorna solo ciò che cambia, poi toglie i BOM spariti da iKnow
    const records = buildBomRecords(docs, extra, lista);
    let cambiate = 0;
    for (const parte of chunk(records, INSERT_CHUNK)) {
      const r = await db`
        INSERT INTO webthron_bom ${db(parte)}
        ON CONFLICT (iddocu) DO UPDATE SET
          data_inserimento = EXCLUDED.data_inserimento,
          codice_vendita   = EXCLUDED.codice_vendita,
          descrizione      = EXCLUDED.descrizione,
          modello          = EXCLUDED.modello,
          codint           = EXCLUDED.codint,
          componente       = EXCLUDED.componente,
          versione         = EXCLUDED.versione,
          aggiornato_il    = now()
        WHERE (webthron_bom.data_inserimento, webthron_bom.codice_vendita, webthron_bom.descrizione,
               webthron_bom.modello, webthron_bom.codint, webthron_bom.componente, webthron_bom.versione)
              IS DISTINCT FROM
              (EXCLUDED.data_inserimento, EXCLUDED.codice_vendita, EXCLUDED.descrizione,
               EXCLUDED.modello, EXCLUDED.codint, EXCLUDED.componente, EXCLUDED.versione)
      `;
      cambiate += r.count;
    }
    const rimosse = await db`DELETE FROM webthron_bom WHERE iddocu <> ALL(${docs.map(d => d.iddocu)}::bigint[])`;

    endRun('bom_sync', records.length);
    logger.info(`[BomSync] ${records.length} BOM letti, ${cambiate} scritti, ${rimosse.count} rimossi`);
    return records.length;
  } catch (err) {
    failRun('bom_sync', err);
    throw err;
  } finally {
    running = false;
  }
}
