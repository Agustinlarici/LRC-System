import sql from 'mssql';

// ─── Tabelle Dynamics (DB: STR) ───────────────────────────────────────────────

// Righe spedizione (EOS CWS Shipment Line) — usata per tutti i clienti EDI
const LINE_TABLE = 'STR$EOS CWS Shipment Line$a879d9e1-a8d9-4dc8-87d8-69d278c5e003';

// Estensione LSA — contiene LSA Your Reference (Purchase Order McLaren/Audi)
const LSA_TABLE  = 'STR$EOS CWS Shipment Line$34bccc94-c43f-4899-8aa8-c820f9e64421';

// Righe ordine di vendita — contiene Unit Price
const SALES_LINE_TABLE = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972';

// TODO: Ferrari — verificare se il contratto Ferrari (14 cifre/commessa)
//       si trova in LSA Your Reference o in un altro campo/tabella

// ─── Config ───────────────────────────────────────────────────────────────────

function getDynamicsConfig(): sql.config {
  return {
    server:   process.env.BC_SERVER   ?? '',
    database: process.env.BC_DATABASE ?? '',
    user:     process.env.BC_USER     ?? '',
    password: process.env.BC_PASSWORD ?? '',
    options: {
      encrypt:                false,
      trustServerCertificate: true,
    },
    connectionTimeout: 15_000,
    requestTimeout:    60_000,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DynamicsShipment {
  shipment_id:      string;
  shipment_date:    string;
  customer_account: string;
  document_number:  string;
  document_date:    string;
  is_extra_cee:     boolean;
  line_count:       number;
}

export interface DynamicsLine {
  article_code:    string;
  description:     string;
  quantity:        number;
  unit_of_measure: string;
  contract_number: string | null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getShipments(
  customerAccounts: string[],
  from?: string,
  to?: string,
  options?: { allCustomers?: boolean; limit?: number; offset?: number; search?: string },
): Promise<DynamicsShipment[]> {
  const { allCustomers = false, limit = 200, offset = 0, search } = options ?? {};
  if (!allCustomers && customerAccounts.length === 0) return [];

  const pool = await sql.connect(getDynamicsConfig());
  try {
    const req = pool.request();

    const conditions: string[] = ["LTRIM(RTRIM(ISNULL(l.[No_], ''))) <> ''"];

    if (!allCustomers) {
      const paramNames = customerAccounts.map((acc, i) => {
        req.input(`acc${i}`, sql.VarChar(20), acc);
        return `@acc${i}`;
      });
      conditions.push(`l.[Destination No_] IN (${paramNames.join(', ')})`);
    }

    if (search) {
      req.input('search', sql.VarChar(60), `%${search}%`);
      conditions.push(`l.[Document No_] LIKE @search`);
    }

    if (from) req.input('from', sql.Date, new Date(from));
    if (to)   req.input('to',   sql.Date, new Date(to));

    const dateFilter = [
      from ? `AND MIN(l.[Posting Date]) >= @from` : '',
      to   ? `AND MIN(l.[Posting Date]) <= @to`   : '',
    ].join(' ');

    req.input('limit',  sql.Int, limit);
    req.input('offset', sql.Int, offset);

    const result = await req.query(`
      SELECT
        l.[Document No_]                                    AS shipment_id,
        CONVERT(VARCHAR(10), MIN(l.[Posting Date]), 23)     AS shipment_date,
        l.[Destination No_]                                 AS customer_account,
        l.[Document No_]                                    AS document_number,
        CONVERT(VARCHAR(10), MIN(l.[Posting Date]), 23)     AS document_date,
        CAST(0 AS BIT)                                      AS is_extra_cee,
        COUNT(l.[Line No_])                                 AS line_count
      FROM [${LINE_TABLE}] l
      WHERE ${conditions.join(' AND ')}
      GROUP BY l.[Document No_], l.[Destination No_]
      HAVING 1=1 ${dateFilter}
      ORDER BY MIN(l.[Posting Date]) DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return (result.recordset as DynamicsShipment[]).map(r => ({
      ...r,
      is_extra_cee: Boolean(r.is_extra_cee),
      line_count:   Number(r.line_count),
    }));
  } finally {
    await pool.close();
  }
}

export interface ShipmentArticlePrice {
  article_code: string;
  unit_price:   number;
}

export async function getShipmentPrices(shipmentIds: string[]): Promise<ShipmentArticlePrice[]> {
  if (shipmentIds.length === 0) return [];
  const pool = await sql.connect(getDynamicsConfig());
  try {
    const req = pool.request();
    const placeholders = shipmentIds.map((sid, i) => {
      req.input(`sid${i}`, sql.VarChar(50), sid);
      return `@sid${i}`;
    });
    const result = await req.query(`
      SELECT
        l.[No_]         AS article_code,
        sl.[Unit Price] AS unit_price
      FROM [${LINE_TABLE}] l
      INNER JOIN [${SALES_LINE_TABLE}] sl
        ON  sl.[Document No_] = l.[Order No_]
        AND sl.[Line No_]     = l.[Order Line No_]
      WHERE l.[Document No_] IN (${placeholders.join(', ')})
        AND LTRIM(RTRIM(ISNULL(l.[No_], ''))) <> ''
        AND sl.[Unit Price] IS NOT NULL
    `);
    return (result.recordset as Array<{ article_code: unknown; unit_price: unknown }>).map(r => ({
      article_code: String(r.article_code ?? '').trim(),
      unit_price:   Math.round(Number(r.unit_price ?? 0) * 10000) / 10000,
    })).filter(r => r.article_code.length > 0);
  } finally {
    await pool.close();
  }
}

export async function getShipmentLines(shipmentId: string, options?: { raw?: boolean }): Promise<DynamicsLine[]> {
  const pool = await sql.connect(getDynamicsConfig());
  const contractField = options?.raw
    ? `LTRIM(RTRIM(lsa.[LSA Your Reference]))`
    : `LEFT(lsa.[LSA Your Reference], CHARINDEX(' ', lsa.[LSA Your Reference] + ' ') - 1)`;
  try {
    const result = await pool.request()
      .input('shipmentId', sql.VarChar(50), shipmentId)
      .query(`
        SELECT
          l.[No_]                                                           AS article_code,
          l.[Description]                                                   AS description,
          l.[Quantity (Base)]                                               AS quantity,
          l.[Unit of Measure]                                               AS unit_of_measure,
          ${contractField}                                                  AS contract_number
        FROM [${LINE_TABLE}] l
        LEFT JOIN [${LSA_TABLE}] lsa
          ON  lsa.[Document No_] = l.[Document No_]
          AND lsa.[Line No_]     = l.[Line No_]
        WHERE l.[Document No_] = @shipmentId
          AND LTRIM(RTRIM(ISNULL(l.[No_], ''))) <> ''
        ORDER BY l.[Line No_]
      `);

    return (result.recordset as DynamicsLine[]).map(r => ({
      article_code:    String(r.article_code    ?? '').trim(),
      description:     String(r.description     ?? '').trim(),
      quantity:        Number(r.quantity         ?? 0),
      unit_of_measure: String(r.unit_of_measure ?? '').trim(),
      contract_number: r.contract_number ? String(r.contract_number).trim() || null : null,
    }));
  } finally {
    await pool.close();
  }
}
