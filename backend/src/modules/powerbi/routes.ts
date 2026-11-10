/**
 * Datos para Power BI por HTTP (alternativa al conector PostgreSQL, che richiede Npgsql sul gateway).
 *
 *   GET /api/powerbi/bom.csv     intestazione  X-Api-Key: <POWERBI_API_KEY>
 *
 * Legge solo PostgreSQL (vista v_iknow_bom), mai WebThron. Il CSV ha gli stessi 7 campi, con gli
 * stessi nomi e lo stesso ordine della query originale di Power BI, e si tiene in memoria pochi
 * minuti: molte richieste costano come una. Senza POWERBI_API_KEY nel .env l'endpoint è spento.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../db/client.js';

export const powerbiRoutes = new Hono();

const CACHE_MS = Math.max(0, parseInt(process.env.POWERBI_CACHE_SECONDS ?? '', 10) || 300) * 1000;

export const BOM_COLUMNS = ['Data_Inserimento', 'Descrizione', 'Codice_Vendita', 'Modello', 'Codint', 'Componente', 'Versione'] as const;

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

/** Costruisce il CSV (intestazione + righe) a partire da righe con le colonne di BOM_COLUMNS. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  const lines = [BOM_COLUMNS.join(',')];
  for (const r of rows) lines.push(BOM_COLUMNS.map(c => csvField(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

let cache: { body: string; at: number } | null = null;

powerbiRoutes.get('/bom.csv', async (c) => {
  const expected = process.env.POWERBI_API_KEY;
  if (!expected) throw new HTTPException(503, { message: 'Endpoint Power BI non configurato' });
  if (!keyMatches(c.req.header('x-api-key'), expected)) throw new HTTPException(401, { message: 'Chiave non valida' });

  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await db`
      SELECT data_inserimento AS "Data_Inserimento", descrizione AS "Descrizione",
             codice_vendita   AS "Codice_Vendita",   modello     AS "Modello",
             codint           AS "Codint",           componente  AS "Componente",
             versione         AS "Versione"
      FROM v_iknow_bom
      ORDER BY codice_vendita ASC NULLS FIRST
    `;
    cache = { body: toCsv(rows as unknown as Array<Record<string, unknown>>), at: Date.now() };
  }

  return c.body(cache.body, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Cache-Control': 'private, max-age=60',
  });
});
