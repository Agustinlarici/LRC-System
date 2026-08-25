import sql from 'mssql';
import { db } from '../../db/client.js';

// Tabella "$ext" di Item — contiene i campi dell'estensione EOS User Defined
// Field, tra cui il campo 22 usato qui come famiglia articolo. Vedi il
// commento su LSA_TABLE in edi/dynamics-client.ts per il perché del "$ext".
const ITEM_EXT_TABLE = 'STR$Item$437dbf0e-84ff-417a-965d-ed2bb9650972$ext';
const EOS_UDF_22      = 'EOS User Defined Field 22$5d2c2370-931f-423b-bfb5-2128499f89ff';

function getBcConfig(): sql.config {
  if (!process.env.BC_USER || !process.env.BC_PASSWORD) {
    throw new Error('BC_USER e BC_PASSWORD sono richiesti per la sync con Business Central');
  }
  const base = {
    server:   process.env.BC_SERVER   ?? '192.168.1.159',
    database: process.env.BC_DATABASE ?? 'STR',
    options: {
      encrypt:                false,
      trustServerCertificate: true,
    },
    connectionTimeout: 15000,
    requestTimeout:    120000,
  };

  // STRSQL02 (server BC dal 2026) accetta solo l'utente di dominio Windows
  // usrnav@STRLAN — richiede autenticazione NTLM, non un login SQL nativo.
  if (process.env.BC_DOMAIN) {
    return {
      ...base,
      authentication: {
        type: 'ntlm',
        options: {
          domain:   process.env.BC_DOMAIN,
          userName: process.env.BC_USER,
          password: process.env.BC_PASSWORD,
        },
      },
    };
  }

  return {
    ...base,
    user:     process.env.BC_USER,
    password: process.env.BC_PASSWORD,
  };
}

interface BcArticle {
  code:        string;
  description: string | null;
  family:      string | null;
}

async function queryBcArticles(): Promise<BcArticle[]> {
  const pool = await sql.connect(getBcConfig());
  try {
    const result = await pool.request().query(`
      SELECT
        A.[No_]              AS code,
        A.[Description]      AS description,
        B.[${EOS_UDF_22}]    AS family
      FROM [STR$Item$437dbf0e-84ff-417a-965d-ed2bb9650972] A
      LEFT JOIN [${ITEM_EXT_TABLE}] B
        ON B.[No_] = A.[No_]
    `);
    return (result.recordset as Array<{ code: unknown; description: unknown; family: unknown }>).map(r => ({
      code:        String(r.code ?? '').trim(),
      description: r.description ? String(r.description).trim() || null : null,
      family:      r.family      ? String(r.family).trim()      || null : null,
    })).filter(a => a.code.length > 0);
  } finally {
    await pool.close();
  }
}

export interface SyncResult {
  ok:            boolean;
  bc_total:      number;
  existing_in_pg: number;
  inserted:      number;
  updated:       number;
}

const BATCH_SIZE = 2000;

export async function syncPackArticles(): Promise<SyncResult> {
  const articles = await queryBcArticles();

  const existing = await db`SELECT code FROM pack_article`;
  const existingCodes = new Set(existing.map(r => r.code as string));

  let inserted = 0;
  let updated  = 0;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE).map(a => ({
      code:        a.code,
      description: a.description ?? null,
      family:      a.family      ?? null,
    }));

    await db`
      INSERT INTO pack_article ${db(batch, 'code', 'description', 'family')}
      ON CONFLICT (code) DO UPDATE SET
        description = EXCLUDED.description,
        family      = EXCLUDED.family
    `;

    for (const a of batch) {
      if (existingCodes.has(a.code)) updated++; else inserted++;
    }
  }

  return {
    ok:             true,
    bc_total:       articles.length,
    existing_in_pg: existingCodes.size,
    inserted,
    updated,
  };
}
