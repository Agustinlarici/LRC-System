import sql from 'mssql';
import { getDynamicsConfig } from '../edi/dynamics-client.js';

// ─── Tabelle Dynamics (DB: STR) ───────────────────────────────────────────────

const SALES_LINE_TABLE     = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972';
const SALES_LINE_LSA_TABLE = 'STR$Sales Line$34bccc94-c43f-4899-8aa8-c820f9e64421';
const SALES_HEADER_TABLE   = 'STR$Sales Header$437dbf0e-84ff-417a-965d-ed2bb9650972';

const ITEM_ATTR_MAPPING_TABLE  = 'STR$Item Attribute Value Mapping$437dbf0e-84ff-417a-965d-ed2bb9650972';
const ITEM_ATTR_VALUE_TABLE    = 'STR$Item Attribute Value$437dbf0e-84ff-417a-965d-ed2bb9650972';
const ITEM_ATTR_DEF_TABLE      = 'STR$Item Attribute$437dbf0e-84ff-417a-965d-ed2bb9650972';

// Clienti / filtri di dominio (stessi del vecchio prod_ins_routes.py)
const CUSTOMER_ACCOUNTS = ['C558', 'C3027', 'C850'];
const EXCLUDED_ITEM_CODES = [
  'ATTREZZAT', '/M', '0ATTREZZAT', '0IMPGENERA',
  'PRESTAZ01', 'PRESTAZ02', 'PRESTAZ03', 'PRESTAZ04', 'PRESTAZ05',
];
const LOCATION_CODES = ['101', '01'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BcSalesOrderLine {
  codice_articolo:        string;
  commessa:                string;
  description:             string;
  description_extension:   string;
  ubicazione:              string;
  planned_shipment_date:   string | null;
  shipment_date:           string | null;
  fa_posting_date:         string | null;
  data_registrazione:      string | null;
}

export interface BcItemAttribute {
  codice_articolo:          string;
  item_attribute_id:        number;
  item_attribute_value_id:  number | null;
  value:                    string | null;
}

export interface BcItemAttributeDefinition {
  id:   number;
  name: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Righe di vendita aperte (Commessa valorizzata) per i clienti di produzione.
 * Porta fedele della query in ProduzioneSTR/backend/routes/prod_ins_routes.py.
 */
export async function getProductionSalesOrders(): Promise<BcSalesOrderLine[]> {
  const pool = await sql.connect(getDynamicsConfig());
  try {
    const req = pool.request();

    const custParams = CUSTOMER_ACCOUNTS.map((acc, i) => {
      req.input(`cust${i}`, sql.VarChar(20), acc);
      return `@cust${i}`;
    });
    const excludedParams = EXCLUDED_ITEM_CODES.map((code, i) => {
      req.input(`excl${i}`, sql.VarChar(50), code);
      return `@excl${i}`;
    });
    const locationParams = LOCATION_CODES.map((loc, i) => {
      req.input(`loc${i}`, sql.VarChar(20), loc);
      return `@loc${i}`;
    });

    const result = await req.query(`
      SELECT
        sl.[No_]                                                    AS codice_articolo,
        LTRIM(RTRIM(ISNULL(lsa.[LSA Task No_], '')))                AS commessa,
        ISNULL(sl.[Description], '')                                AS description,
        ISNULL(lsa.[LSA Description Extension], '')                 AS description_extension,
        ISNULL(sl.[Location Code], '')                               AS ubicazione,
        CONVERT(VARCHAR(10), sl.[Planned Shipment Date], 23)        AS planned_shipment_date,
        CONVERT(VARCHAR(10), sl.[Shipment Date], 23)                AS shipment_date,
        CONVERT(VARCHAR(10), sl.[FA Posting Date], 23)              AS fa_posting_date,
        CONVERT(VARCHAR(10), sh.[Posting Date], 23)                 AS data_registrazione
      FROM [${SALES_LINE_TABLE}] sl WITH (NOLOCK)
      INNER JOIN [${SALES_LINE_LSA_TABLE}] lsa WITH (NOLOCK)
        ON  sl.[Document Type] = lsa.[Document Type]
        AND sl.[Document No_]  = lsa.[Document No_]
        AND sl.[Line No_]      = lsa.[Line No_]
      INNER JOIN [${SALES_HEADER_TABLE}] sh WITH (NOLOCK)
        ON  sl.[Document Type] = sh.[Document Type]
        AND sl.[Document No_]  = sh.[No_]
      WHERE sl.[Document Type] IN (1, 92)
        AND sl.[Type] = 2
        AND sl.[Sell-to Customer No_] IN (${custParams.join(', ')})
        AND sl.[No_] NOT IN (${excludedParams.join(', ')})
        AND sl.[Outstanding Quantity] <> 0
        AND sl.[Location Code] IN (${locationParams.join(', ')})
        AND LTRIM(RTRIM(ISNULL(lsa.[LSA Task No_], ''))) <> ''
        AND sh.[Order Date] > DATEADD(MONTH, -6, GETDATE())
    `);

    return (result.recordset as Array<Record<string, unknown>>).map(r => ({
      codice_articolo:       String(r.codice_articolo ?? '').trim(),
      commessa:              String(r.commessa ?? '').trim(),
      description:           String(r.description ?? ''),
      description_extension: String(r.description_extension ?? ''),
      ubicazione:            String(r.ubicazione ?? ''),
      planned_shipment_date: r.planned_shipment_date ? String(r.planned_shipment_date) : null,
      shipment_date:         r.shipment_date ? String(r.shipment_date) : null,
      fa_posting_date:       r.fa_posting_date ? String(r.fa_posting_date) : null,
      data_registrazione:    r.data_registrazione ? String(r.data_registrazione) : null,
    })).filter(r => r.codice_articolo.length > 0);
  } finally {
    await pool.close();
  }
}

/**
 * Attributi BC (Item Attribute Value Mapping + Item Attribute Value) per un
 * lotto di codici articolo. Chunked internamente per evitare query con
 * migliaia di parametri IN(...).
 */
export async function getItemAttributesForArticles(articleCodes: string[]): Promise<BcItemAttribute[]> {
  const codes = [...new Set(articleCodes.filter(c => c && c.trim().length > 0))];
  if (codes.length === 0) return [];

  const CHUNK = 500;
  const out: BcItemAttribute[] = [];
  const pool = await sql.connect(getDynamicsConfig());

  try {
    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      const req = pool.request();
      const placeholders = chunk.map((code, j) => {
        req.input(`code${j}`, sql.VarChar(100), code);
        return `@code${j}`;
      });

      const result = await req.query(`
        SELECT
          m.[No_]                     AS codice_articolo,
          m.[Item Attribute ID]       AS item_attribute_id,
          m.[Item Attribute Value ID] AS item_attribute_value_id,
          v.[Value]                   AS value
        FROM [${ITEM_ATTR_MAPPING_TABLE}] m WITH (NOLOCK)
        LEFT JOIN [${ITEM_ATTR_VALUE_TABLE}] v WITH (NOLOCK)
          ON v.[ID] = m.[Item Attribute Value ID]
        WHERE m.[No_] IN (${placeholders.join(', ')})
      `);

      for (const r of result.recordset as Array<Record<string, unknown>>) {
        const codiceArticolo = String(r.codice_articolo ?? '').trim();
        if (!codiceArticolo) continue;
        out.push({
          codice_articolo:         codiceArticolo,
          item_attribute_id:       Number(r.item_attribute_id),
          item_attribute_value_id: r.item_attribute_value_id != null ? Number(r.item_attribute_value_id) : null,
          value:                   r.value != null ? String(r.value).trim() : null,
        });
      }
    }
    return out;
  } finally {
    await pool.close();
  }
}

/**
 * Nome reale (BC: [Name]) di ogni Item Attribute ID — tabella di anagrafica
 * piccola (poche decine di righe), letta per intero una volta a sync invece
 * che joinata riga per riga sulla mapping (che può avere migliaia di righe).
 * Usata solo come default suggerito per prod_item_attribute_label.categoria_label
 * al primo avvistamento di un ID nuovo — non sovrascrive rinomine manuali.
 */
export async function getItemAttributeDefinitions(): Promise<BcItemAttributeDefinition[]> {
  const pool = await sql.connect(getDynamicsConfig());
  try {
    const result = await pool.request().query(`
      SELECT [ID] AS id, [Name] AS name
      FROM [${ITEM_ATTR_DEF_TABLE}] WITH (NOLOCK)
    `);
    return (result.recordset as Array<Record<string, unknown>>)
      .map(r => ({ id: Number(r.id), name: String(r.name ?? '').trim() }))
      .filter(r => r.name.length > 0);
  } finally {
    await pool.close();
  }
}
