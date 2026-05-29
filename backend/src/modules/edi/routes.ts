import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { readdir, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { getShipments, getShipmentLines } from './dynamics-client.js';

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

  try {
    await access(body.output_folder, constants.W_OK);
  } catch {
    throw new HTTPException(400, { message: `Cartella non accessibile: "${body.output_folder}"` });
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
      csg_supply_point, output_folder
    ) VALUES (
      ${b.customer_account}, ${b.description}, ${b.edi_type},
      ${b.cdt_company_name ?? ''}, ${b.cdt_vat ?? ''},
      ${b.cdt_address_1 ?? null}, ${b.cdt_address_2 ?? null},
      ${b.cdt_address_3 ?? null}, ${b.cdt_address_4 ?? null},
      ${b.sdt_vat ?? ''}, ${b.supplier_code},
      ${b.csg_establishment_code}, ${b.csg_company_name ?? ''},
      ${b.csg_address_1 ?? null}, ${b.csg_address_2 ?? null},
      ${b.csg_address_3 ?? null}, ${b.csg_address_4 ?? null},
      ${b.csg_supply_point ?? null}, ${b.output_folder}
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
  const clients = await db`SELECT customer_account FROM edi_clients`;
  const accounts = clients.map(r => r.customer_account as string);
  if (accounts.length === 0) return c.json([]);

  const q = c.req.query();
  const filterAcct: string | undefined = q['customer_account'];
  const filterFrom: string | undefined = q['from'];
  const filterTo:   string | undefined = q['to'];

  const filtered = filterAcct ? accounts.filter(a => a === filterAcct) : accounts;

  try {
    const shipments = await getShipments(filtered, filterFrom, filterTo);

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

// ─── GET /shipments/:id ───────────────────────────────────────────────────────

ediRoutes.get('/shipments/:id', requireModule(MODULE), async (c) => {
  const shipmentId = c.req.param('id') ?? '';
  try {
    const lines = await getShipmentLines(shipmentId);
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

  // Write to output_folder
  const outputPath = join(client.output_folder as string, filename);
  try {
    await writeFile(outputPath, fileContent, 'utf-8');
  } catch (err) {
    await db`
      INSERT INTO edi_history
        (shipment_id, customer_account, edi_type, filename, status, error_message, file_content, is_regeneration)
      VALUES
        (${body.shipment_id}, ${body.customer_account}, ${client.edi_type as string},
         ${filename}, 'error', ${(err as Error).message}, ${fileContent}, ${body.force === true})
    `;
    throw new HTTPException(500, {
      message: `Impossibile scrivere il file "${outputPath}": ${(err as Error).message}`,
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
