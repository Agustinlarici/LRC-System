import sql from 'mssql';
import { db } from '../../db/client.js';

function getBcConfig(): sql.config {
  if (!process.env.BC_USER || !process.env.BC_PASSWORD) {
    throw new Error('BC_USER e BC_PASSWORD sono richiesti per la sync con Business Central');
  }
  return {
    server:   process.env.BC_SERVER   ?? '192.168.1.159',
    database: process.env.BC_DATABASE ?? 'STR',
    user:     process.env.BC_USER,
    password: process.env.BC_PASSWORD,
    options: {
      encrypt:                false,
      trustServerCertificate: true,
    },
    connectionTimeout: 15000,
    requestTimeout:    60000,
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
        A.[No_]                       AS code,
        A.[Description]               AS description,
        B.[EOS User Defined Field 22] AS family
      FROM [STR$Item$437dbf0e-84ff-417a-965d-ed2bb9650972] A
      LEFT JOIN [STR$Item$5d2c2370-931f-423b-bfb5-2128499f89ff] B
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

export async function syncPackArticles(): Promise<SyncResult> {
  const articles = await queryBcArticles();

  const existing = await db`SELECT code FROM pack_article`;
  const existingCodes = new Set(existing.map(r => r.code as string));

  let inserted = 0;
  let updated  = 0;

  for (const a of articles) {
    const isNew = !existingCodes.has(a.code);
    await db`
      INSERT INTO pack_article (code, description, family)
      VALUES (${a.code}, ${a.description ?? null}, ${a.family ?? null})
      ON CONFLICT (code) DO UPDATE SET
        description = EXCLUDED.description,
        family      = EXCLUDED.family
    `;
    if (isNew) inserted++; else updated++;
  }

  return {
    ok:             true,
    bc_total:       articles.length,
    existing_in_pg: existingCodes.size,
    inserted,
    updated,
  };
}
