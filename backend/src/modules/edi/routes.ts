import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { getShipments, getShipmentLines, getShipmentPrices } from './dynamics-client.js';
import { writeEdiFile, isUncPath, parseUnc, listUncFolder } from '../../lib/smb-writer.js';
import { scanFerrariFolder, CAMPI_OUTPUT } from './ferrari-ingresso-parser.js';
import { startSyncInBackground, getSyncState } from './ferrari-delins-sync.js';

export const ediRoutes = new Hono();
const MODULE = 'edi' as const;

// Generators live next to the compiled output (backend/edi_generators/)
const GENERATORS_DIR = join(process.cwd(), 'edi_generators');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EdiClientSchema = z.object({
  customer_account:          z.string().min(1).max(20),
  description:               z.string().min(1),
  edi_type:                  z.string().min(1).max(50),
  cdt_company_name:          z.string().max(35).default(''),
  cdt_vat:                   z.string().max(20).default(''),
  cdt_address_1:             z.string().max(35).nullish(),
  cdt_address_2:             z.string().max(35).nullish(),
  cdt_address_3:             z.string().max(35).nullish(),
  cdt_address_4:             z.string().max(35).nullish(),
  sdt_vat:          z.string().max(20).default(''),
  supplier_code:    z.string().min(1).max(9).regex(/^\d+$/, 'Solo cifre numeriche'),
  csg_establishment_code: z.string().max(20).default(''),
  csg_company_name:          z.string().max(35).default(''),
  csg_address_1:             z.string().max(35).nullish(),
  csg_address_2:             z.string().max(35).nullish(),
  csg_address_3:             z.string().max(35).nullish(),
  csg_address_4:             z.string().max(35).nullish(),
  csg_supply_point:          z.string().max(17).nullish(),
  output_folder:             z.string().min(1),
  auto_generate:             z.boolean().default(false),
});

const GenerateSchema = z.object({
  shipment_id:     z.string().min(1),
  customer_account: z.string().min(1),
  document_number: z.string(),
  document_date:   z.string().nullish(),
  is_extra_cee:    z.boolean().default(false),
  force:           z.boolean().default(false),
  lines: z.array(z.object({
    article_code:    z.string(),
    description:     z.string(),
    quantity:        z.number(),
    unit_of_measure: z.string(),
    contract_number: z.string().nullable(),
  })),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function listGenerators(): Promise<string[]> {
  try {
    const files = await readdir(GENERATORS_DIR);
    return files.filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
  } catch {
    return [];
  }
}

async function nextSequence(year: number): Promise<number> {
  const [row] = await db`
    INSERT INTO edi_sequence (year, last_sequence) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_sequence = edi_sequence.last_sequence + 1
    RETURNING last_sequence
  `;
  return row.last_sequence as number;
}

// ─── GET /generators ──────────────────────────────────────────────────────────

ediRoutes.get('/generators', requireModule(MODULE), async (c) => {
  return c.json(await listGenerators());
});

// ─── GET /clients ─────────────────────────────────────────────────────────────

ediRoutes.get('/clients', requireModule(MODULE), async (c) => {
  const rows = await db`SELECT * FROM edi_clients ORDER BY description`;
  return c.json(rows);
});

// ─── POST /clients ────────────────────────────────────────────────────────────

ediRoutes.post('/clients', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, EdiClientSchema);

  if (!isUncPath(body.output_folder)) {
    try {
      await access(body.output_folder, constants.W_OK);
    } catch {
      throw new HTTPException(400, { message: `Cartella non accessibile: "${body.output_folder}"` });
    }
  }

  const b = body as Required<typeof body>;
  const [row] = await db`
    INSERT INTO edi_clients (
      customer_account, description, edi_type,
      cdt_company_name, cdt_vat,
      cdt_address_1, cdt_address_2, cdt_address_3, cdt_address_4,
      sdt_vat, supplier_code,
      csg_establishment_code, csg_company_name,
      csg_address_1, csg_address_2, csg_address_3, csg_address_4,
      csg_supply_point, output_folder, auto_generate
    ) VALUES (
      ${b.customer_account}, ${b.description}, ${b.edi_type},
      ${b.cdt_company_name ?? ''}, ${b.cdt_vat ?? ''},
      ${b.cdt_address_1 ?? null}, ${b.cdt_address_2 ?? null},
      ${b.cdt_address_3 ?? null}, ${b.cdt_address_4 ?? null},
      ${b.sdt_vat ?? ''}, ${b.supplier_code},
      ${b.csg_establishment_code}, ${b.csg_company_name ?? ''},
      ${b.csg_address_1 ?? null}, ${b.csg_address_2 ?? null},
      ${b.csg_address_3 ?? null}, ${b.csg_address_4 ?? null},
      ${b.csg_supply_point ?? null}, ${b.output_folder}, ${b.auto_generate ?? false}
    ) RETURNING *
  `;
  return c.json(row, 201);
});

// ─── PUT /clients/:id ─────────────────────────────────────────────────────────

ediRoutes.put('/clients/:id', requireManage(MODULE), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, EdiClientSchema);
  const b = body as Required<typeof body>;

  try {
    await access(b.output_folder, constants.W_OK);
  } catch {
    throw new HTTPException(400, { message: `Cartella non accessibile: "${b.output_folder}"` });
  }

  const [row] = await db`
    UPDATE edi_clients SET
      customer_account        = ${b.customer_account},
      description             = ${b.description},
      edi_type                = ${b.edi_type},
      cdt_company_name        = ${b.cdt_company_name ?? ''},
      cdt_vat                 = ${b.cdt_vat ?? ''},
      cdt_address_1           = ${b.cdt_address_1 ?? null},
      cdt_address_2           = ${b.cdt_address_2 ?? null},
      cdt_address_3           = ${b.cdt_address_3 ?? null},
      cdt_address_4           = ${b.cdt_address_4 ?? null},
      sdt_vat                 = ${b.sdt_vat ?? ''},
      supplier_code           = ${b.supplier_code},
      csg_establishment_code  = ${b.csg_establishment_code},
      csg_company_name        = ${b.csg_company_name ?? ''},
      csg_address_1           = ${b.csg_address_1 ?? null},
      csg_address_2           = ${b.csg_address_2 ?? null},
      csg_address_3           = ${b.csg_address_3 ?? null},
      csg_address_4           = ${b.csg_address_4 ?? null},
      csg_supply_point        = ${b.csg_supply_point ?? null},
      output_folder           = ${b.output_folder},
      auto_generate           = ${b.auto_generate ?? false},
      updated_at              = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Cliente EDI non trovato' });
  return c.json(row);
});

// ─── DELETE /clients/:id ──────────────────────────────────────────────────────

ediRoutes.delete('/clients/:id', requireManage(MODULE), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [row] = await db`DELETE FROM edi_clients WHERE id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Cliente EDI non trovato' });
  return c.json({ status: 'deleted' });
});

// ─── GET /shipments ───────────────────────────────────────────────────────────

ediRoutes.get('/shipments', requireModule(MODULE), async (c) => {
  const q = c.req.query();
  const filterAcct:  string | undefined = q['customer_account'];
  const filterFrom:  string | undefined = q['from'];
  const filterTo:    string | undefined = q['to'];
  const allCustomers = q['all'] === 'true';
  const limit  = Math.min(Math.max(parseInt(q['limit']  ?? '10',  10), 1), 100);
  const offset = Math.max(parseInt(q['offset'] ?? '0',   10), 0);
  const search = q['search'] ?? '';

  const clients = await db`SELECT customer_account FROM edi_clients`;
  const accounts = clients.map(r => r.customer_account as string);
  if (!allCustomers && accounts.length === 0) return c.json([]);

  const filtered = allCustomers ? [] : (filterAcct ? accounts.filter(a => a === filterAcct) : accounts);

  try {
    const shipments = await getShipments(filtered, filterFrom, filterTo, {
      allCustomers, limit, offset, search: search || undefined,
    });

    // Cross-reference with history to get last status
    const ids = shipments.map(s => s.shipment_id);
    const history = ids.length > 0 ? await db`
      SELECT DISTINCT ON (shipment_id) shipment_id, status, generated_at
      FROM edi_history
      WHERE shipment_id = ANY(${ids})
      ORDER BY shipment_id, generated_at DESC
    ` : [];

    const histMap = new Map(history.map(h => [h.shipment_id as string, h.status as string]));

    // Also attach the edi_type from client config
    const clientMap = new Map(
      (await db`SELECT customer_account, edi_type FROM edi_clients`).map(r => [
        r.customer_account as string,
        r.edi_type as string,
      ])
    );

    return c.json(shipments.map(s => ({
      ...s,
      edi_type:   clientMap.get(s.customer_account) ?? '',
      edi_status: histMap.get(s.shipment_id) ?? 'pending',
    })));
  } catch (err) {
    throw new HTTPException(503, {
      message: `Dynamics non disponibile: ${(err as Error).message}`,
    });
  }
});

// ─── GET /shipments/prices?ids=X,Y,Z ─────────────────────────────────────────

ediRoutes.get('/shipments/prices', requireModule(MODULE), async (c) => {
  const idsParam = c.req.query('ids') ?? '';
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return c.json([]);
  try {
    const prices = await getShipmentPrices(ids);
    return c.json(prices);
  } catch (err) {
    throw new HTTPException(503, {
      message: `Dynamics non disponibile: ${(err as Error).message}`,
    });
  }
});

// ─── GET /shipments/:id ───────────────────────────────────────────────────────

ediRoutes.get('/shipments/:id', requireModule(MODULE), async (c) => {
  const shipmentId = c.req.param('id') ?? '';
  const raw = c.req.query('raw') === 'true';
  try {
    const lines = await getShipmentLines(shipmentId, { raw });
    return c.json(lines);
  } catch (err) {
    throw new HTTPException(503, {
      message: `Dynamics non disponibile: ${(err as Error).message}`,
    });
  }
});

// ─── POST /generate ───────────────────────────────────────────────────────────

ediRoutes.post('/generate', requireManage(MODULE), async (c) => {
  const body = await parseBody(c, GenerateSchema);

  // Guard: already sent?
  if (!body.force) {
    const [existing] = await db`
      SELECT id FROM edi_history
      WHERE shipment_id = ${body.shipment_id} AND status = 'sent'
      ORDER BY generated_at DESC LIMIT 1
    `;
    if (existing) {
      throw new HTTPException(409, {
        message: 'Spedizione già inviata. Confermare la rigenerazione.',
      });
    }
  }

  // Load client config
  const [client] = await db`
    SELECT * FROM edi_clients WHERE customer_account = ${body.customer_account}
  `;
  if (!client) throw new HTTPException(404, { message: 'Cliente EDI non configurato' });

  // DESADV_MCLAREN: il numero ordine è opzionale (RFF+ON con if nel generatore)
  // AVIEXP_FERRARI e DESADV_AUDI: il numero contratto/ordine è obbligatorio
  const ediTypesRequiringContract = ['AVIEXP_FERRARI', 'DESADV_AUDI'];
  if (ediTypesRequiringContract.includes(client.edi_type as string)) {
    const missing = body.lines.filter(l => !l.contract_number || l.contract_number.trim() === '');
    if (missing.length > 0) {
      throw new HTTPException(400, {
        message: `${missing.length} riga/righe senza N° contratto / ordine acquisto. Compilare prima di generare.`,
      });
    }
  }

  // Load generator module
  let generatorMod: { generate: (s: unknown, c: unknown, seq: number) => string };
  try {
    const genPath = pathToFileURL(join(GENERATORS_DIR, `${client.edi_type as string}.js`)).href;
    generatorMod = await import(genPath) as typeof generatorMod;
  } catch {
    throw new HTTPException(500, {
      message: `Generatore EDI "${client.edi_type as string}" non trovato in ${GENERATORS_DIR}`,
    });
  }

  // Allocate sequence
  const year     = new Date().getFullYear();
  const sequence = await nextSequence(year);

  // Build filename
  const now = new Date();
  const ts  = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const seqPadded = String(sequence).padStart(11, '0');
  const filename  = `${client.edi_type as string}_${client.supplier_code as string}_${seqPadded}_${ts}.txt`;

  // Generate content
  let fileContent: string;
  try {
    fileContent = generatorMod.generate(body, client, sequence);
  } catch (err) {
    await db`
      INSERT INTO edi_history
        (shipment_id, customer_account, edi_type, filename, status, error_message, is_regeneration)
      VALUES
        (${body.shipment_id}, ${body.customer_account}, ${client.edi_type as string},
         ${filename}, 'error', ${(err as Error).message}, ${body.force === true})
    `;
    throw new HTTPException(500, { message: `Errore generazione: ${(err as Error).message}` });
  }

  // Write to output_folder (local path or UNC/SMB)
  try {
    await writeEdiFile(client.output_folder as string, filename, fileContent);
  } catch (err) {
    await db`
      INSERT INTO edi_history
        (shipment_id, customer_account, edi_type, filename, status, error_message, file_content, is_regeneration)
      VALUES
        (${body.shipment_id}, ${body.customer_account}, ${client.edi_type as string},
         ${filename}, 'error', ${(err as Error).message}, ${fileContent}, ${body.force === true})
    `;
    throw new HTTPException(500, {
      message: `Impossibile scrivere il file "${filename}": ${(err as Error).message}`,
    });
  }

  // Save successful history record
  const [histRow] = await db`
    INSERT INTO edi_history
      (shipment_id, customer_account, edi_type, filename, status, file_content, is_regeneration)
    VALUES
      (${body.shipment_id}, ${body.customer_account}, ${client.edi_type as string},
       ${filename}, 'sent', ${fileContent}, ${body.force === true})
    RETURNING *
  `;

  return c.json({ filename, history: histRow }, 201);
});

// ─── GET /history ─────────────────────────────────────────────────────────────

ediRoutes.get('/history', requireModule(MODULE), async (c) => {
  const q = c.req.query();
  const fromDate: string | null    = q['from']             ?? null;
  const toDate:   string | null    = q['to']               ?? null;
  const acct:     string | null    = q['customer_account'] ?? null;

  const fromFilter = fromDate ? db`AND generated_at::date >= ${fromDate}::date` : db``;
  const toFilter   = toDate   ? db`AND generated_at::date <= ${toDate}::date`   : db``;
  const acctFilter = acct     ? db`AND customer_account = ${acct}`              : db``;

  const rows = await db`
    SELECT id, shipment_id, customer_account, edi_type, filename,
           generated_at, status, error_message, is_regeneration
    FROM edi_history
    WHERE 1=1
    ${fromFilter}
    ${toFilter}
    ${acctFilter}
    ORDER BY generated_at DESC
    LIMIT 500
  `;
  return c.json(rows);
});

// ─── GET /history/:id/content ─────────────────────────────────────────────────

ediRoutes.get('/history/:id/content', requireModule(MODULE), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [row] = await db`
    SELECT file_content, filename FROM edi_history WHERE id = ${id}
  `;
  if (!row) throw new HTTPException(404, { message: 'Voce non trovata' });
  return c.json({ content: row.file_content, filename: row.filename });
});

// ─── GET /ingresso/ordini — tutti i contratti con ordini chiusi ──────────────

ediRoutes.get('/ingresso/ordini', requireModule(MODULE), async (c) => {
  const rows = await db`
    WITH keyed AS (
      SELECT *,
        CASE
          WHEN NULLIF(TRIM(commessa), '') IS NOT NULL
            THEN COALESCE(NULLIF(TRIM(num_contratto), ''), num_programma)
          WHEN NULLIF(TRIM(num_contratto), '') LIKE '63%'
            THEN NULLIF(TRIM(num_contratto), '')
          ELSE source_file
        END AS contratto_key
      FROM edi_ferrari_delins
    ),
    base AS (
      SELECT
        contratto_key,
        num_programma,
        commessa,
        file_mtime,
        scanned_at,
        CASE
          WHEN tipo_documento = 'Forecast' OR tipo_schedulazione = 'Forecast' THEN 1
          WHEN NULLIF(TRIM(commessa), '') IS NULL
            AND NULLIF(TRIM(num_contratto), '') NOT LIKE '63%' THEN 1
          ELSE CEIL(
            ROW_NUMBER() OVER (
              PARTITION BY contratto_key
              ORDER BY data_consegna, codice_articolo, num_programma
            )::float / 50
          )::int
        END AS chunk,
        tipo_documento,
        tipo_schedulazione
      FROM keyed
    ),
    chunk_counts AS (
      SELECT contratto_key, MAX(chunk) AS total_chunks
      FROM base
      GROUP BY contratto_key
    )
    SELECT
      CASE WHEN cc.total_chunks > 1
        THEN b.contratto_key || '-' || b.chunk::text
        ELSE b.contratto_key
      END                                           AS num_contratto,
      COUNT(DISTINCT b.num_programma)::int          AS programmi,
      COUNT(*)::int                                 AS righe,
      MAX(b.file_mtime)                             AS file_mtime,
      MIN(b.scanned_at)                             AS scanned_at,
      MAX(NULLIF(TRIM(b.commessa), '')) IS NOT NULL AS has_commessa,
      BOOL_OR(b.tipo_documento = 'Forecast' OR b.tipo_schedulazione = 'Forecast') AS is_forecast
    FROM base b
    JOIN chunk_counts cc ON cc.contratto_key = b.contratto_key
    GROUP BY b.contratto_key, b.chunk, cc.total_chunks
    ORDER BY MAX(b.file_mtime) DESC NULLS LAST, num_contratto
  `;
  return c.json(rows);
});

// ─── GET /ingresso/ordini/:num_contratto/download — CSV di tutte le righe ────

ediRoutes.get('/ingresso/ordini/:num_contratto/download', requireModule(MODULE), async (c) => {
  const numContratto = c.req.param('num_contratto') ?? '';
  if (!numContratto) throw new HTTPException(400, { message: 'num_contratto mancante' });

  const keyExpr = db`
    CASE
      WHEN NULLIF(TRIM(commessa), '') IS NOT NULL
        THEN COALESCE(NULLIF(TRIM(num_contratto), ''), num_programma)
      WHEN NULLIF(TRIM(num_contratto), '') LIKE '63%'
        THEN NULLIF(TRIM(num_contratto), '')
      ELSE source_file
    END
  `;

  const rows = await db`
    SELECT ${db(CAMPI_OUTPUT as unknown as string[])}, scanned_at
    FROM edi_ferrari_delins
    WHERE ${keyExpr} = ${numContratto}
    ORDER BY data_consegna, codice_articolo
  `;
  if (rows.length === 0) throw new HTTPException(404, { message: 'Contratto non trovato o nessuna riga' });

  const cols = [...CAMPI_OUTPUT, 'scanned_at'];
  const escape = (v: string) => {
    if (v.includes(';') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const header = cols.join(';');
  const lines  = rows.map(r => cols.map(c => escape(String((r as Record<string, unknown>)[c] ?? ''))).join(';'));
  const csv    = '﻿' + [header, ...lines].join('\r\n');

  const safeName = numContratto.replace(/[^a-zA-Z0-9_-]/g, '_');
  const today    = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const filename = `Ferrari_Ordine_${safeName}_${today}.csv`;

  return c.json({ csv, filename });
});

// ─── POST /ingresso/sync — avvia scansione in background (ritorna subito) ─────

ediRoutes.post('/ingresso/sync', requireModule(MODULE), (c) => {
  return c.json(startSyncInBackground(), 202);
});

// ─── GET /ingresso/sync/status — stato corrente della sync ───────────────────

ediRoutes.get('/ingresso/sync/status', requireModule(MODULE), (c) => {
  return c.json(getSyncState());
});

// ─── GET /ingresso/ordini/:num_contratto/download-portale — formato portale ──

const PORTALE_HEADERS = [
  'Codice ordine di acquisto', 'Data', 'Codice fornitore', 'Accettazione',
  'Ragione sociale 1:', 'Ragione sociale 2:', 'Indirizzo 1:', 'Indirizzo 2:',
  'Città', 'CAP', 'Provincia', 'Codice resa', 'Descrizione resa',
  'Codice spedizione', 'Descrizione spedizione', 'Descrizione pagamento',
  'Valuta', 'Acquisitore', 'Tel.', 'Fax', 'Autorizzatore',
  'Pos', 'Codice materiale', 'Descrizione', 'U.M.', 'Quantità',
  'Prezzo Netto Unitario', 'U.M.P.', 'Sconto %', 'Importo Sconto Unitario',
  'Data di consegna', 'Dest.', 'Set.', 'C.F.', 'Commessa', 'Lotto',
  'Testo articolo', 'Testo riga', 'Nota 2', 'Nota 1', 'Stato Riga',
];

const PORTALE_NOTA1 =
  "Ai fini dell'esecuzione del presente ordine troveranno applicazione" +
  "eventuali accordi specifici intercorsi tra le parti (es. MOU, LOI," +
  "Development Agreement, Supply Agreement, Letter of Assignemnt ecc.)";

ediRoutes.get('/ingresso/ordini/:num_contratto/download-portale', requireModule(MODULE), async (c) => {
  const numContratto = c.req.param('num_contratto') ?? '';
  if (!numContratto) throw new HTTPException(400, { message: 'num_contratto mancante' });

  // Detect chunk suffix e.g. "1217xxxx-2" → baseKey="1217xxxx", chunk=2
  const chunkMatch = numContratto.match(/^(.+)-(\d+)$/);
  const baseKey    = chunkMatch ? chunkMatch[1] : numContratto;
  const chunkNum   = chunkMatch ? parseInt(chunkMatch[2], 10) : null;

  const keyExpr = db`
    CASE
      WHEN NULLIF(TRIM(commessa), '') IS NOT NULL
        THEN COALESCE(NULLIF(TRIM(num_contratto), ''), num_programma)
      WHEN NULLIF(TRIM(num_contratto), '') LIKE '63%'
        THEN NULLIF(TRIM(num_contratto), '')
      ELSE source_file
    END
  `;

  const rows = chunkNum !== null
    ? await db`
        WITH base AS (
          SELECT codice_articolo, descrizione, um, quantita,
                 data_consegna, commessa, ft3_testo, pos_contratto,
                 CEIL(
                   ROW_NUMBER() OVER (
                     ORDER BY data_consegna, codice_articolo, num_programma
                   )::float / 50
                 )::int AS chunk
          FROM edi_ferrari_delins
          WHERE ${keyExpr} = ${baseKey}
        )
        SELECT codice_articolo, descrizione, um, quantita,
               data_consegna, commessa, ft3_testo, pos_contratto
        FROM base
        WHERE chunk = ${chunkNum}
        ORDER BY data_consegna, codice_articolo
      `
    : await db`
        SELECT codice_articolo, descrizione, um, quantita,
               data_consegna, commessa, ft3_testo, pos_contratto
        FROM edi_ferrari_delins
        WHERE ${keyExpr} = ${baseKey}
        ORDER BY data_consegna, codice_articolo
      `;

  if (rows.length === 0) throw new HTTPException(404, { message: 'Contratto non trovato' });

  const today = new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome',
  }).format(new Date());

  const dataRows = (rows as Record<string, unknown>[]).map((r, i) => [
    numContratto,
    today,
    '25391',
    '',
    'STR AUTOMOTIVE S.P.A.',
    '',
    'STRADA FABBRECCIA, 33',
    '',
    'PESARO',
    '61122',
    'PU',
    'EXW',
    'Ex-Works',
    '',
    '',
    '60 GG D.F.F.M.',
    'EUR',
    'LEONARDO BIN',
    '',
    '',
    '',
    String(r.pos_contratto || i + 1),
    String(r.codice_articolo ?? ''),
    String(r.descrizione ?? ''),
    String(r.um ?? ''),
    String(r.quantita ?? ''),
    '',
    String(r.um ?? ''),
    '.00',
    '',
    String(r.data_consegna ?? ''),
    '5',
    '39',
    '',
    String(r.commessa ?? ''),
    '',
    String(r.ft3_testo ?? ''),
    '',
    '',
    PORTALE_NOTA1,
    'N',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([PORTALE_HEADERS, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ordine');

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const b64      = buf.toString('base64');
  const safeName = numContratto.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const filename = `Portale_${safeName}_${dateStr}.xlsx`;

  return c.json({ xlsx: b64, filename });
});

// ─── GET /ingresso/debug — valori distinti per diagnosi filtri ───────────────

ediRoutes.get('/ingresso/debug', requireModule(MODULE), async (c) => {
  const [tipiDoc, commesse, totale] = await Promise.all([
    db`SELECT tipo_documento, COUNT(*)::int AS righe FROM edi_ferrari_delins GROUP BY tipo_documento ORDER BY righe DESC`,
    db`SELECT commessa, COUNT(*)::int AS righe FROM edi_ferrari_delins GROUP BY commessa ORDER BY righe DESC LIMIT 20`,
    db`SELECT COUNT(*)::int AS tot FROM edi_ferrari_delins`,
  ]);
  return c.json({ totale: totale[0]?.tot ?? 0, tipo_documento: tipiDoc, commessa: commesse });
});

// ─── GET /ingresso/test-smb — diagnostica connessione SMB ────────────────────

ediRoutes.get('/ingresso/test-smb', requireModule(MODULE), async (c) => {
  const folder = (c.req.query('folder') ?? '').trim();
  if (!folder || !isUncPath(folder)) {
    return c.json({ ok: false, error: 'Passare ?folder=\\\\server\\share\\path' });
  }
  const { share, subPath } = parseUnc(folder);
  const result: Record<string, unknown> = {
    share,
    subPath,
    smb_user: process.env.SMB_USER || '(non configurato)',
    smb_domain: process.env.SMB_DOMAIN || '(non configurato)',
  };
  try {
    const files = await listUncFolder(folder);
    result.ok = true;
    result.files_count = files.length;
    result.sample = files.slice(0, 5);
  } catch (err) {
    const e = err as Error & { code?: string };
    result.ok = false;
    result.error_code = e.code ?? 'n/a';
    result.error_message = e.message;
  }
  return c.json(result);
});

// ─── POST /ingresso/scan ──────────────────────────────────────────────────────

ediRoutes.post('/ingresso/scan', requireModule(MODULE), async (c) => {
  const body = await c.req.json() as { folder?: string };
  const folder = (body?.folder ?? '').trim();

  if (!folder) {
    throw new HTTPException(400, { message: 'Cartella non specificata' });
  }
  if (!isAbsolute(folder) && !isUncPath(folder)) {
    throw new HTTPException(400, { message: 'Il percorso deve essere assoluto o UNC (es. \\\\192.168.1.x\\share\\cartella)' });
  }

  try {
    const result = await scanFerrariFolder(folder);
    return c.json(result);
  } catch (err) {
    const e = err as (NodeJS.ErrnoException & { code?: string; messageName?: string });
    const code = e.code ?? '';
    const step = (e as any).messageName ?? 'n/a';
    const msg = `SMB errore in step="${step}" code="${code || 'n/a'}": ${e.message}`;
    throw new HTTPException(400, { message: msg });
  }
});
