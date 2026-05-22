import sql from 'mssql';

// ─── Placeholder table names — sostituire con i nomi reali in Dynamics ────────

// TODO: reemplazar con el nombre real de la tabla header de expediciones en Dynamics
const SHIPMENT_HEADER_TABLE = 'PLACEHOLDER_HEADER';

// TODO: reemplazar con el nombre real de la tabla detalle de expediciones
const SHIPMENT_DETAIL_TABLE = 'PLACEHOLDER_DETAIL';

// TODO: reemplazar con tabla y campo donde está el N° contrato/orden Ferrari (14 caracteres)
// Formato: 10 dígitos número contrato + 4 dígitos posición, rellenados con ceros (ej: 00006015180015)
const CONTRACT_NUMBER_EXPR = 'CAST(d.PLACEHOLDER_CONTRACT_FIELD AS VARCHAR(14))';

// ─── Config ───────────────────────────────────────────────────────────────────

function getDynamicsConfig(): sql.config {
  return {
    server:   process.env.DYNAMICS_DB_SERVER   ?? '',
    database: process.env.DYNAMICS_DB_NAME     ?? '',
    user:     process.env.DYNAMICS_DB_USER     ?? '',
    password: process.env.DYNAMICS_DB_PASSWORD ?? '',
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
): Promise<DynamicsShipment[]> {
  if (customerAccounts.length === 0) return [];

  const pool = await sql.connect(getDynamicsConfig());
  try {
    const req = pool.request();

    // Bind customer accounts as individual params to avoid string injection
    const paramNames = customerAccounts.map((_, i) => {
      req.input(`acc${i}`, sql.VarChar(20), customerAccounts[i]);
      return `@acc${i}`;
    });

    if (from) req.input('from', sql.Date, new Date(from));
    if (to)   req.input('to',   sql.Date, new Date(to));

    const dateFilter = [
      from ? 'AND h.Posting_Date >= @from' : '',
      to   ? 'AND h.Posting_Date <= @to'   : '',
    ].join(' ');

    const result = await req.query(`
      SELECT
        h.No_                                        AS shipment_id,
        CONVERT(VARCHAR(10), h.Posting_Date, 23)     AS shipment_date,
        h.Sell_to_Customer_No_                       AS customer_account,
        h.No_                                        AS document_number,
        CONVERT(VARCHAR(10), h.Posting_Date, 23)     AS document_date,
        CAST(0 AS BIT)                               AS is_extra_cee,
        COUNT(d.Line_No_)                            AS line_count
      FROM [${SHIPMENT_HEADER_TABLE}] h
      LEFT JOIN [${SHIPMENT_DETAIL_TABLE}] d ON d.Document_No_ = h.No_
      WHERE h.Sell_to_Customer_No_ IN (${paramNames.join(', ')})
        ${dateFilter}
      GROUP BY h.No_, h.Posting_Date, h.Sell_to_Customer_No_
      ORDER BY h.Posting_Date DESC
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

export async function getShipmentLines(shipmentId: string): Promise<DynamicsLine[]> {
  const pool = await sql.connect(getDynamicsConfig());
  try {
    const result = await pool.request()
      .input('shipmentId', sql.VarChar(50), shipmentId)
      .query(`
        SELECT
          d.No_                                AS article_code,
          d.Description                        AS description,
          d.Quantity                           AS quantity,
          d.Unit_of_Measure_Code               AS unit_of_measure,
          ${CONTRACT_NUMBER_EXPR}              AS contract_number
        FROM [${SHIPMENT_DETAIL_TABLE}] d
        WHERE d.Document_No_ = @shipmentId
        ORDER BY d.Line_No_
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
