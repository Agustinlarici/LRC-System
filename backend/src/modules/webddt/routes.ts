import { Hono } from 'hono';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule } from '../../lib/auth.js';
import { getShipments, getWebDdtLines } from '../edi/dynamics-client.js';

export const webddtRoutes = new Hono();

const FERRARI_ACCOUNT = 'C558';

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

// GET /api/webddt/shipments — lista spedizioni Ferrari (C558) con flag downloaded
webddtRoutes.get('/shipments', requireModule('webddt'), async (c) => {
  try {
    const { from, to, search, limit: lStr, offset: oStr } = c.req.query();
    const limit  = Math.min(parseInt(lStr  || '200', 10), 500);
    const offset = parseInt(oStr || '0', 10);

    const rows = await getShipments(
      [FERRARI_ACCOUNT],
      from  || undefined,
      to    || undefined,
      { limit, offset, search: search || undefined },
    );

    if (rows.length === 0) return c.json([]);

    const ids = rows.map(r => r.shipment_id);
    const dlRows = await db<{ shipment_id: string; downloaded_at: string }[]>`
      SELECT shipment_id, downloaded_at::text
      FROM webddt_downloads
      WHERE shipment_id = ANY(${ids})
    `;
    const dlMap = new Map(dlRows.map(r => [r.shipment_id, r.downloaded_at]));

    return c.json(rows.map(r => ({
      ...r,
      downloaded_at: dlMap.get(r.shipment_id) ?? null,
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

  // Leggi supplier_code dal client EDI Ferrari
  const [ediClient] = await db`
    SELECT supplier_code FROM edi_clients WHERE customer_account = ${FERRARI_ACCOUNT} LIMIT 1
  `;
  const supplierCode = ediClient?.supplier_code
    ? String(ediClient.supplier_code).padStart(6, '0')
    : '';

  const rows: Record<string, string | number>[] = [];

  for (const shipmentId of body.shipment_ids) {
    const shipperNo = extractDocNo(shipmentId).padStart(6, '0');
    const lines = await getWebDdtLines(shipmentId);

    for (const line of lines) {
      const commessa  = line.lsa_task_no ?? '';
      const buyerPart = commessa
        ? `${commessa}   ${line.article_code}`
        : line.article_code;

      const row: Record<string, string | number> = {};
      for (const col of COLUMNS) row[col] = '';

      const poNumber = line.contract_number
        ? String(line.contract_number).padStart(9, '0')
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
