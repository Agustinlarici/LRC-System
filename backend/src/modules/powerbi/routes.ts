/**
 * Dati per Power BI via HTTP (alternativa al connettore PostgreSQL, che richiede Npgsql sul gateway).
 *
 *   GET /api/powerbi/bom.csv      BOM di iKnow (vista v_iknow_bom)
 *   GET /api/powerbi/eventi.csv   eventi iKnow degli ultimi 3 mesi (vista v_iknow_ultimi_3_mesi)
 *
 * Intestazione richiesta:  X-Api-Key: <POWERBI_API_KEY>
 *
 * Legge solo PostgreSQL, mai WebThron. Ogni CSV si tiene in memoria pochi minuti e una sola
 * richiesta alla volta lo ricostruisce: molte richieste costano come una. Senza POWERBI_API_KEY
 * nel .env gli endpoint sono spenti.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../db/client.js';

export const powerbiRoutes = new Hono();

const CACHE_MS = Math.max(0, parseInt(process.env.POWERBI_CACHE_SECONDS ?? '', 10) || 300) * 1000;

// Stessi nomi e ordine della query originale di Power BI
export const BOM_COLUMNS = ['Data_Inserimento', 'Descrizione', 'Codice_Vendita', 'Modello', 'Codint', 'Componente', 'Versione'] as const;
export const EVENTI_COLUMNS = [
  'Giorno', 'Data_Inserimento', 'Data_Inserimento_Roma', 'Fase', 'Modello', 'Componente', 'Cod_Seriale',
  'Commessa', 'Esito_Delibera', 'Versione', 'Operatore', 'Colore', 'Protocollo_Cesta',
] as const;

/** Confronto della chiave a tempo costante. */
export function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Costruisce il CSV (intestazione + righe) con le colonne indicate, nell'ordine dato. */
export function toCsv(columns: readonly string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => csvField(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

const cache = new Map<string, { body: string; at: number }>();
const building = new Map<string, Promise<string>>();

async function cachedCsv(name: string, build: () => Promise<string>): Promise<string> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at <= CACHE_MS) return hit.body;
  let p = building.get(name);
  if (!p) {
    p = build()
      .then(body => { cache.set(name, { body, at: Date.now() }); return body; })
      .finally(() => building.delete(name));
    building.set(name, p);
  }
  return p;
}

function guard(keyHeader: string | undefined): void {
  const expected = process.env.POWERBI_API_KEY;
  if (!expected) throw new HTTPException(503, { message: 'Endpoint Power BI non configurato' });
  if (!keyMatches(keyHeader, expected)) throw new HTTPException(401, { message: 'Chiave non valida' });
}

const CSV_HEADERS = { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, max-age=60' };

powerbiRoutes.get('/bom.csv', async (c) => {
  guard(c.req.header('x-api-key'));
  const body = await cachedCsv('bom', async () => {
    const rows = await db`
      SELECT data_inserimento AS "Data_Inserimento", descrizione AS "Descrizione",
             codice_vendita   AS "Codice_Vendita",   modello     AS "Modello",
             codint           AS "Codint",           componente  AS "Componente",
             versione         AS "Versione"
      FROM v_iknow_bom
      ORDER BY codice_vendita ASC NULLS FIRST
    `;
    return toCsv(BOM_COLUMNS, rows as unknown as Array<Record<string, unknown>>);
  });
  return c.body(body, 200, CSV_HEADERS);
});

powerbiRoutes.get('/eventi.csv', async (c) => {
  guard(c.req.header('x-api-key'));
  const body = await cachedCsv('eventi', async () => {
    const rows = await db`
      SELECT giorno::text                AS "Giorno",
             data_inserimento            AS "Data_Inserimento",
             data_inserimento_roma::text AS "Data_Inserimento_Roma",
             fase                        AS "Fase",
             modello                     AS "Modello",
             componente                  AS "Componente",
             cod_seriale                 AS "Cod_Seriale",
             commessa                    AS "Commessa",
             esito_delibera              AS "Esito_Delibera",
             versione                    AS "Versione",
             operatore                   AS "Operatore",
             colore                      AS "Colore",
             protocollo_cesta            AS "Protocollo_Cesta"
      FROM v_iknow_ultimi_3_mesi
      ORDER BY data_inserimento ASC
    `;
    return toCsv(EVENTI_COLUMNS, rows as unknown as Array<Record<string, unknown>>);
  });
  return c.body(body, 200, CSV_HEADERS);
});
