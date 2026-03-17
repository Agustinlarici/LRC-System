import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';

export const packingRoutes = new Hono();

// ─── Operators ────────────────────────────────────────────────────────────────

packingRoutes.get('/operators', async (c) => {
  const rows = await db`SELECT id, name FROM pack_operator ORDER BY name`;
  return c.json(rows);
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

packingRoutes.post('/sessions', async (c) => {
  const body = await parseBody(c, z.object({ operatorId: z.number().int().positive() }));
  const [row] = await db`
    INSERT INTO pack_operator_session (operator_id) VALUES (${body.operatorId}) RETURNING id
  `;
  return c.json({ sessionId: row.id }, 201);
});

// ─── Dispatch Destinations ────────────────────────────────────────────────────

packingRoutes.get('/dispatch-destinations', async (c) => {
  const rows = await db`SELECT id, name FROM pack_dispatch_destination ORDER BY name`;
  return c.json(rows);
});

packingRoutes.get('/dispatch-destinations/:id/allowed-articles', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const rows = await db`
    SELECT article_code FROM pack_article_dispatch WHERE destination_id = ${id}
  `;
  return c.json(rows.map(r => r.article_code));
});

// ─── Articles ─────────────────────────────────────────────────────────────────

packingRoutes.get('/articles', async (c) => {
  const rows = await db`SELECT code FROM pack_article ORDER BY code`;
  return c.json(rows.map(r => r.code));
});

packingRoutes.get('/check-article/:code', async (c) => {
  const code = c.req.param('code');
  const [row] = await db`SELECT COUNT(*)::int AS total FROM pack_article WHERE code = ${code}`;
  return c.json({ exists: (row.total as number) > 0 });
});

packingRoutes.post('/check-article-dispatch', async (c) => {
  const body = await parseBody(c, z.object({
    articleCode: z.string().min(1),
    dispatchId:  z.number().int().positive(),
  }));
  const [dispatch] = await db`SELECT destination_id FROM pack_dispatch WHERE id = ${body.dispatchId}`;
  if (!dispatch) return c.json({ allowed: false });
  const [row] = await db`
    SELECT COUNT(*)::int AS total
    FROM pack_article_dispatch
    WHERE article_code = ${body.articleCode} AND destination_id = ${dispatch.destination_id}
  `;
  return c.json({ allowed: (row.total as number) > 0 });
});

// ─── Dispatches ───────────────────────────────────────────────────────────────

packingRoutes.post('/dispatches', async (c) => {
  const body = await parseBody(c, z.object({
    type:          z.string().min(1),
    destinationId: z.number().int().positive(),
  }));
  const [row] = await db`
    INSERT INTO pack_dispatch (type, destination_id)
    VALUES (${body.type}, ${body.destinationId})
    RETURNING id
  `;
  return c.json({ dispatchId: row.id }, 201);
});

// ─── Pallets ──────────────────────────────────────────────────────────────────

packingRoutes.post('/pallets', async (c) => {
  const body = await parseBody(c, z.object({
    dispatchId: z.number().int().positive(),
    sessionId:  z.number().int().positive(),
  }));

  const result = await db.begin(async (tx) => {
    const [maxRow] = await tx`
      SELECT COALESCE(MAX(p.number), 0) AS max_num
      FROM pack_dispatch_pallet dp
      JOIN pack_pallet p ON dp.pallet_id = p.id
      WHERE dp.dispatch_id = ${body.dispatchId}
    `;
    const nextNumber = ((maxRow.max_num as number) ?? 0) + 1;

    const [pallet] = await tx`
      INSERT INTO pack_pallet (session_id, number) VALUES (${body.sessionId}, ${nextNumber}) RETURNING id
    `;
    await tx`
      INSERT INTO pack_dispatch_pallet (dispatch_id, pallet_id) VALUES (${body.dispatchId}, ${pallet.id})
    `;
    return { palletId: pallet.id, number: nextNumber };
  });

  return c.json({ status: 'created', dispatchId: body.dispatchId, ...result }, 201);
});

// ─── Pallet Items ─────────────────────────────────────────────────────────────

packingRoutes.post('/pallet-items', async (c) => {
  const body = await parseBody(c, z.object({
    palletId:    z.number().int().positive(),
    articleCode: z.string().min(1),
    quantity:    z.number().int().positive(),
    commessa:    z.string().optional().nullable(),
  }));
  const [row] = await db`
    INSERT INTO pack_pallet_item (pallet_id, article_code, quantity, commessa)
    VALUES (${body.palletId}, ${body.articleCode}, ${body.quantity}, ${body.commessa ?? null})
    RETURNING id
  `;
  return c.json({ id: row.id }, 201);
});

packingRoutes.patch('/pallet-items/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await c.req.json() as { articleCode?: string; quantity?: number; commessa?: string | null };

  const [existing] = await db`
    SELECT id, article_code, quantity, commessa FROM pack_pallet_item WHERE id = ${id}
  `;
  if (!existing) throw new HTTPException(404, { message: 'Item non trovato' });

  const articleCode = 'articleCode' in body ? body.articleCode! : existing.article_code as string;
  const quantity    = 'quantity'    in body ? body.quantity!    : existing.quantity    as number;
  const commessa    = 'commessa'    in body ? body.commessa     : existing.commessa    as string | null;

  await db`
    UPDATE pack_pallet_item
    SET article_code = ${articleCode}, quantity = ${quantity}, commessa = ${commessa ?? null}
    WHERE id = ${id}
  `;
  return c.json({ status: 'ok' });
});

packingRoutes.delete('/pallet-items/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [deleted] = await db`DELETE FROM pack_pallet_item WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Item non trovato' });
  return c.json({ status: 'deleted' });
});

// ─── Packing Lists ────────────────────────────────────────────────────────────

packingRoutes.get('/packing-lists', async (c) => {
  const rows = await db`
    SELECT
      d.id,
      COALESCE(dest.name, d.type) AS type,
      d.created_at,
      COUNT(DISTINCT dp.pallet_id)::int  AS pallets,
      COALESCE(SUM(pi.quantity), 0)::int AS total_items
    FROM pack_dispatch d
    LEFT JOIN pack_dispatch_destination dest ON d.destination_id = dest.id
    LEFT JOIN pack_dispatch_pallet dp ON d.id = dp.dispatch_id
    LEFT JOIN pack_pallet_item pi ON dp.pallet_id = pi.pallet_id
    GROUP BY d.id, dest.name
    ORDER BY d.created_at DESC
  `;
  return c.json(rows);
});

packingRoutes.get('/packing-lists/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [dispatch] = await db`
    SELECT d.id, COALESCE(dest.name, d.type) AS type, d.created_at
    FROM pack_dispatch d
    LEFT JOIN pack_dispatch_destination dest ON d.destination_id = dest.id
    WHERE d.id = ${id}
  `;
  if (!dispatch) throw new HTTPException(404, { message: 'Spedizione non trovata' });

  const pallets = await db`
    SELECT p.id, p.number
    FROM pack_dispatch_pallet dp
    JOIN pack_pallet p ON dp.pallet_id = p.id
    WHERE dp.dispatch_id = ${id}
    ORDER BY p.number ASC, p.id ASC
  `;

  const palletsWithItems = await Promise.all(pallets.map(async (p) => {
    const items = await db`
      SELECT
        i.id AS pallet_item_id,
        i.article_code,
        a.description,
        i.quantity,
        i.commessa
      FROM pack_pallet_item i
      LEFT JOIN pack_article a ON i.article_code = a.code
      WHERE i.pallet_id = ${p.id}
      ORDER BY i.id ASC
    `;
    return { ...p, items };
  }));

  return c.json({ ...dispatch, pallets: palletsWithItems });
});

packingRoutes.post('/packing-lists/:id/pallets', async (c) => {
  const dispatchId = parseInt(c.req.param('id'), 10);
  if (isNaN(dispatchId)) throw new HTTPException(400, { message: 'ID non valido' });

  const result = await db.begin(async (tx) => {
    const [row] = await tx`
      SELECT MAX(p.number) AS max_number, MAX(p.session_id) AS session_id
      FROM pack_dispatch_pallet dp
      JOIN pack_pallet p ON dp.pallet_id = p.id
      WHERE dp.dispatch_id = ${dispatchId}
    `;
    if (!row?.session_id) throw new HTTPException(400, { message: 'Impossibile determinare la sessione originale' });

    const nextNumber = ((row.max_number as number) ?? 0) + 1;
    const [pallet] = await tx`
      INSERT INTO pack_pallet (session_id, number) VALUES (${row.session_id}, ${nextNumber}) RETURNING id
    `;
    await tx`INSERT INTO pack_dispatch_pallet (dispatch_id, pallet_id) VALUES (${dispatchId}, ${pallet.id})`;
    return { palletId: pallet.id, number: nextNumber };
  });

  return c.json({ status: 'created', dispatch_id: dispatchId, ...result }, 201);
});

packingRoutes.get('/packing-lists/:id/summary', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const rows = await db`
    SELECT
      ppi.article_code,
      a.description,
      a.family,
      ppi.commessa,
      SUM(ppi.quantity)::int AS total_quantity
    FROM pack_dispatch_pallet dp
    JOIN pack_pallet pp ON dp.pallet_id = pp.id
    JOIN pack_pallet_item ppi ON pp.id = ppi.pallet_id
    LEFT JOIN pack_article a ON ppi.article_code = a.code
    WHERE dp.dispatch_id = ${id}
    GROUP BY ppi.article_code, a.description, a.family, ppi.commessa
    ORDER BY a.family NULLS LAST, a.description NULLS LAST, ppi.commessa NULLS LAST, ppi.article_code
  `;
  return c.json(rows);
});

packingRoutes.get('/packing-lists/:id/commesse-by-group', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  try {
    const rows = await db`
      SELECT
        pa.commessa_group,
        cg.name AS group_name,
        STRING_AGG(DISTINCT ppi.commessa, '|' ORDER BY ppi.commessa) AS commesse
      FROM pack_dispatch_pallet dp
      JOIN pack_pallet pp ON dp.pallet_id = pp.id
      JOIN pack_pallet_item ppi ON pp.id = ppi.pallet_id
      JOIN pack_article pa ON ppi.article_code = pa.code
      JOIN pack_commessa_group cg ON pa.commessa_group = cg.id
      WHERE dp.dispatch_id = ${id}
        AND ppi.commessa IS NOT NULL
        AND pa.commessa_group IS NOT NULL
      GROUP BY pa.commessa_group, cg.name
      ORDER BY pa.commessa_group
    `;
    return c.json(rows);
  } catch {
    return c.json([]);
  }
});

// ─── Sync from BC (stub — BC connection not configured) ───────────────────────

packingRoutes.post('/articles/sync-from-bc', async (c) => {
  return c.json({ ok: false, error: 'Sincronizzazione BC non configurata in questo ambiente' }, 501);
});
