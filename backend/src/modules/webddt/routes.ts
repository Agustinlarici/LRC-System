import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { validateSpmaFile } from '../../lib/mime-check.js';
import { getShipments, getWebDdtLines, getShipmentAccounts, getWebDdtLineStatuses } from '../edi/dynamics-client.js';

export const webddtRoutes = new Hono();

// Clienti abilitati al modulo WebDDT, con relativo Supplier ID (6 cifre)
const SUPPLIER_CODES: Record<string, string> = {
  C558:  '025391',
  C3027: '207523',
};
const ACCOUNTS = Object.keys(SUPPLIER_CODES);

// 28 columns per Ferrari WebDDT template (Template_Without_Containers)
const COLUMNS = [
  'Shipper number',
  'Ship date and time',
  'Expected arrival date and time',
  'Remarks',
  'Supplier ID',
  'Ship from ID',
  'Facility ID',
  'Ship to ID',
  'Dock code',
  'Freight value',
  'SCAC code',
  'AETC',
  'PRO number',
  'Vehicle number',
  'Vehicle type',
  'Transportation method',
  'Route code',
  'Buyer part number',
  'PO number',
  'PO line number',
  'Shipped quantity',
  'Quantity unit of measure',
  'Net weight',
  'Weight unit of measure',
  'Pull signal',
  'Engineering level',
  'Model year',
  'Lot number',
] as const;

function extractDocNo(raw: string): string {
  const str = String(raw || '').trim();
  const dashIdx = str.lastIndexOf('-');
  if (dashIdx < 0) return str;
  const suffix = str.slice(dashIdx + 1);
  const num = parseInt(suffix, 10);
  return isNaN(num) ? suffix : String(num);
}

// Normalizza unità di misura: NUMERO/NUM/NR./etc. → NR
const UOM_NORMALIZE: Record<string, string> = {
  'NUMERO': 'NR', 'NUM': 'NR', 'NR.': 'NR', 'N': 'NR',
  'PZ': 'NR', 'PCS': 'NR', 'PCE': 'NR',
};
function normalizeUom(uom: string): string {
  return UOM_NORMALIZE[String(uom).toUpperCase().trim()] ?? uom;
}

// GET /api/webddt/shipments — lista spedizioni (C558, C3027) con flag downloaded
webddtRoutes.get('/shipments', requireModule('webddt'), async (c) => {
  try {
    const { from, to, search, limit: lStr, offset: oStr } = c.req.query();
    const limit  = Math.min(parseInt(lStr  || '200', 10), 500);
    const offset = parseInt(oStr || '0', 10);

    const rows = await getShipments(
      ACCOUNTS,
      from  || undefined,
      to    || undefined,
      { limit, offset, search: search || undefined },
    );

    if (rows.length === 0) return c.json([]);

    const ids = rows.map(r => r.shipment_id);
    const [dlRows, lineStatuses, poMapRows] = await Promise.all([
      db<{ shipment_id: string; downloaded_at: string }[]>`
        SELECT shipment_id, downloaded_at::text
        FROM webddt_downloads
        WHERE shipment_id = ANY(${ids})
      `,
      getWebDdtLineStatuses(ids),
      db<{ article_code: string }[]>`SELECT article_code FROM webddt_po_mapping`,
    ]);
    const dlMap = new Map(dlRows.map(r => [r.shipment_id, r.downloaded_at]));
    const poCodes = new Set(poMapRows.map(r => r.article_code));

    // Spedizioni con almeno una riga senza commessa e senza PO number (né da BC né dalla tabella)
    const missingSet = new Set<string>();
    for (const l of lineStatuses) {
      const hasPo = l.lsa_task_no ? !!l.contract_number : poCodes.has(l.article_code);
      if (!l.lsa_task_no && !hasPo) missingSet.add(l.shipment_id);
    }

    return c.json(rows.map(r => ({
      ...r,
      downloaded_at: dlMap.get(r.shipment_id) ?? null,
      missing_po:    missingSet.has(r.shipment_id),
    })));
  } catch (err: unknown) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /api/webddt/download — genera Excel con righe delle spedizioni selezionate
const DownloadSchema = z.object({
  shipment_ids: z.array(z.string().min(1)).min(1).max(50),
});

webddtRoutes.post('/download', requireModule('webddt'), async (c) => {
  const body = await parseBody(c, DownloadSchema);
  const user = c.get('user');

  // Determina il cliente (account) di ogni spedizione per scegliere il Supplier ID corretto
  const accountByShipment = await getShipmentAccounts(body.shipment_ids);

  // Codice articolo → PO number, usato per le righe senza commessa
  const poMapRows = await db<{ article_code: string; po_number: string }[]>`
    SELECT article_code, po_number FROM webddt_po_mapping
  `;
  const poMap = new Map(poMapRows.map(r => [r.article_code, r.po_number]));

  const rows: Record<string, string | number>[] = [];

  for (const shipmentId of body.shipment_ids) {
    const account       = accountByShipment.get(shipmentId) ?? '';
    const supplierCode  = SUPPLIER_CODES[account] ?? '';
    const shipperNo     = extractDocNo(shipmentId).padStart(5, '0');
    const lines = await getWebDdtLines(shipmentId);

    for (const line of lines) {
      const commessa  = line.lsa_task_no ?? '';
      const buyerPart = commessa
        ? `${commessa}   ${line.article_code}`
        : `${' '.repeat(6)}   ${line.article_code}`;

      const row: Record<string, string | number> = {};
      for (const col of COLUMNS) row[col] = '';

      const poNumberRaw = commessa
        ? line.contract_number ?? ''
        : poMap.get(line.article_code) ?? '';
      const poNumber = poNumberRaw
        ? String(poNumberRaw).padStart(9, '0')
        : '';

      row['Shipper number']           = shipperNo;
      row['Supplier ID']              = supplierCode;
      row['Buyer part number']        = buyerPart;
      row['PO number']                = poNumber;
      row['PO line number']           = line.lsa_line_no ?? '';
      row['Shipped quantity']         = line.quantity;
      row['Quantity unit of measure'] = normalizeUom(line.unit_of_measure);

      rows.push(row);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...COLUMNS] });
  XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Segna le spedizioni come scaricate
  for (const shipmentId of body.shipment_ids) {
    await db`
      INSERT INTO webddt_downloads (shipment_id, downloaded_by)
      VALUES (${shipmentId}, ${user?.username ?? null})
      ON CONFLICT (shipment_id) DO UPDATE
        SET downloaded_at = now(), downloaded_by = EXCLUDED.downloaded_by
    `.catch(() => {});
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  return new Response(buf as Buffer, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="WebDDT_Ferrari_${dateStr}.xlsx"`,
    },
  });
});

// ─── Mapping codice articolo → PO number (usato quando manca la commessa) ─────

const PoMappingSchema = z.object({
  article_code: z.string().min(1).max(50),
  po_number:    z.string().min(1).max(20),
});

// GET /api/webddt/po-mapping
webddtRoutes.get('/po-mapping', requireModule('webddt'), async (c) => {
  const rows = await db`SELECT * FROM webddt_po_mapping ORDER BY article_code`;
  return c.json(rows);
});

// POST /api/webddt/po-mapping — crea o aggiorna (upsert per codice articolo)
webddtRoutes.post('/po-mapping', requireManage('webddt'), async (c) => {
  const body = await parseBody(c, PoMappingSchema);
  const [row] = await db`
    INSERT INTO webddt_po_mapping (article_code, po_number)
    VALUES (${body.article_code.trim()}, ${body.po_number.trim()})
    ON CONFLICT (article_code) DO UPDATE
      SET po_number = EXCLUDED.po_number, updated_at = now()
    RETURNING *
  `;
  return c.json(row, 201);
});

// DELETE /api/webddt/po-mapping/:id
webddtRoutes.delete('/po-mapping/:id', requireManage('webddt'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  await db`DELETE FROM webddt_po_mapping WHERE id = ${id}`;
  return c.body(null, 204);
});

// Trova la colonna dell'header che corrisponde a uno dei nomi candidati (case-insensitive)
function pickCol(row: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find(k => k.trim().toLowerCase() === cand);
    if (hit) return hit;
  }
  for (const cand of candidates) {
    const hit = keys.find(k => k.trim().toLowerCase().includes(cand));
    if (hit) return hit;
  }
  return null;
}

// POST /api/webddt/po-mapping/import — carica un Excel con colonne codice articolo / PO number
webddtRoutes.post('/po-mapping/import', requireManage('webddt'), async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'Richiesta multipart non valida' });
  }

  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'File mancante (campo "file")' });

  const buffer = Buffer.from(await file.arrayBuffer());
  validateSpmaFile(buffer, file.name);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new HTTPException(400, { message: 'File Excel non valido' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });

  if (raw.length === 0) return c.json({ imported: 0, skipped: 0 });

  const artCol = pickCol(raw[0], ['codice articolo', 'articolo', 'article code', 'codice']);
  const poCol  = pickCol(raw[0], ['po number', 'numero po', 'po']);
  if (!artCol || !poCol) {
    throw new HTTPException(400, {
      message: 'Colonne non trovate. Servono "Codice Articolo" e "PO Number"',
    });
  }

  let imported = 0;
  let skipped  = 0;

  for (const row of raw) {
    const articleCode = String(row[artCol] ?? '').trim();
    const poNumber    = String(row[poCol]  ?? '').trim();
    if (!articleCode || !poNumber) { skipped++; continue; }

    await db`
      INSERT INTO webddt_po_mapping (article_code, po_number)
      VALUES (${articleCode}, ${poNumber})
      ON CONFLICT (article_code) DO UPDATE
        SET po_number = EXCLUDED.po_number, updated_at = now()
    `;
    imported++;
  }

  return c.json({ imported, skipped });
});
