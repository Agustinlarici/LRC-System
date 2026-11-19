// Fatturazione: lettura da Business Central (sola lettura). Descrizione = quella della riga dell'ordine di vendita collegata alla riga di spedizione.
import sql from 'mssql';
import { getDynamicsConfig } from '../edi/dynamics-client.js';

const LINE_TABLE       = 'STR$EOS CWS Shipment Line$a879d9e1-a8d9-4dc8-87d8-69d278c5e003';
const SALES_LINE_TABLE = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972';

export interface RigaDespacho {
  shipment_id:  string;
  line_no:      number;
  article_code: string;
  quantity:     number;
  order_no:     string;
  descrizione:  string;
}

export async function getRigheDespachi(shipmentIds: string[]): Promise<RigaDespacho[]> {
  if (shipmentIds.length === 0) return [];
  const pool = await sql.connect(getDynamicsConfig());
  try {
    const req = pool.request();
    const ph = shipmentIds.map((id, i) => { req.input(`s${i}`, sql.VarChar(50), id); return `@s${i}`; });
    const res = await req.query(`
      SELECT l.[Document No_] AS shipment_id, l.[Line No_] AS line_no, l.[No_] AS article_code,
             l.[Quantity (Base)] AS quantity, l.[Order No_] AS order_no,
             LTRIM(RTRIM(ISNULL(sl.[Description], '') + ' ' + ISNULL(sl.[Description 2], ''))) AS descrizione
      FROM [${LINE_TABLE}] l
      LEFT JOIN [${SALES_LINE_TABLE}] sl
        ON sl.[Document No_] = l.[Order No_] AND sl.[Line No_] = l.[Order Line No_]
      WHERE l.[Document No_] IN (${ph.join(', ')})
        AND LTRIM(RTRIM(ISNULL(l.[No_], ''))) <> ''
      ORDER BY l.[Document No_], l.[Line No_]
    `);
    return (res.recordset as Array<Record<string, unknown>>).map(r => ({
      shipment_id:  String(r.shipment_id ?? '').trim(),
      line_no:      Number(r.line_no ?? 0),
      article_code: String(r.article_code ?? '').trim(),
      quantity:     Number(r.quantity ?? 0),
      order_no:     String(r.order_no ?? '').trim(),
      descrizione:  String(r.descrizione ?? '').trim(),
    }));
  } finally {
    await pool.close();
  }
}
