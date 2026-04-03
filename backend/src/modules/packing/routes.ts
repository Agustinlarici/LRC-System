import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { syncPackArticles } from './bc-client.js';
import { logger } from '../../lib/logger.js';

export const packingRoutes = new Hono();

// ─── Operators ────────────────────────────────────────────────────────────────

packingRoutes.get('/operators', async (c) => {
  const rows = await db`SELECT id, name FROM pack_operator ORDER BY name`;
  return c.json(rows);
});

packingRoutes.post('/operators', async (c) => {
  const body = await parseBody(c, z.object({ name: z.string().min(1) }));
  const [row] = await db`INSERT INTO pack_operator (name) VALUES (${body.name}) RETURNING id, name`;
  return c.json(row, 201);
});

packingRoutes.delete('/operators/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [deleted] = await db`DELETE FROM pack_operator WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Operatore non trovato' });
  return c.json({ status: 'deleted' });
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

packingRoutes.post('/dispatch-destinations', async (c) => {
  const body = await parseBody(c, z.object({ name: z.string().min(1) }));
  const [row] = await db`INSERT INTO pack_dispatch_destination (name) VALUES (${body.name}) RETURNING id, name`;
  return c.json(row, 201);
});

packingRoutes.delete('/dispatch-destinations/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [deleted] = await db`DELETE FROM pack_dispatch_destination WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Destinazione non trovata' });
  return c.json({ status: 'deleted' });
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
  if (!dispatch) return c.json({ allowed: false, reason: 'dispatch_not_found' });

  // Count total rules for this article
  const [totalRules] = await db`
    SELECT COUNT(*)::int AS total FROM pack_article_dispatch WHERE article_code = ${body.articleCode}
  `;
  // No rules configured → allowed anywhere
  if ((totalRules.total as number) === 0) return c.json({ allowed: true });

  // Rules exist → check if this destination is allowed
  const [match] = await db`
    SELECT COUNT(*)::int AS total
    FROM pack_article_dispatch
    WHERE article_code = ${body.articleCode} AND destination_id = ${dispatch.destination_id}
  `;
  return c.json({ allowed: (match.total as number) > 0 });
});

// ─── Article → Destination rules ──────────────────────────────────────────────

packingRoutes.get('/article-dispatch-rules', async (c) => {
  const rows = await db`
    SELECT ad.article_code, a.description, ad.destination_id, d.name AS destination_name
    FROM pack_article_dispatch ad
    LEFT JOIN pack_article a ON a.code = ad.article_code
    LEFT JOIN pack_dispatch_destination d ON d.id = ad.destination_id
    ORDER BY ad.article_code, d.name
  `;
  return c.json(rows);
});

packingRoutes.post('/article-dispatch-rules', async (c) => {
  const body = await parseBody(c, z.object({
    article_code:   z.string().min(1),
    destination_id: z.number().int().positive(),
  }));
  await db`
    INSERT INTO pack_article_dispatch (article_code, destination_id)
    VALUES (${body.article_code}, ${body.destination_id})
    ON CONFLICT (article_code, destination_id) DO NOTHING
  `;
  return c.json({ status: 'ok' }, 201);
});

packingRoutes.delete('/article-dispatch-rules/:code/:destId', async (c) => {
  const code   = c.req.param('code');
  const destId = parseInt(c.req.param('destId'), 10);
  if (isNaN(destId)) throw new HTTPException(400, { message: 'ID non valido' });
  await db`DELETE FROM pack_article_dispatch WHERE article_code = ${code} AND destination_id = ${destId}`;
  return c.json({ status: 'deleted' });
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

  const result = await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
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

const patchItemSchema = z.object({
  articleCode: z.string().min(1).optional(),
  quantity:    z.number().int().positive().optional(),
  commessa:    z.string().nullable().optional(),
});

packingRoutes.patch('/pallet-items/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, patchItemSchema);

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
      d.type,
      dest.name AS destination_name,
      d.created_at,
      (
        SELECT po.name
        FROM pack_dispatch_pallet pdp2
        JOIN pack_pallet pp2 ON pp2.id = pdp2.pallet_id
        JOIN pack_operator_session pos2 ON pos2.id = pp2.session_id
        JOIN pack_operator po ON po.id = pos2.operator_id
        WHERE pdp2.dispatch_id = d.id
        LIMIT 1
      ) AS operator_name,
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

  const result = await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
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

// ─── Sync from BC ─────────────────────────────────────────────────────────────

packingRoutes.post('/articles/sync-from-bc', async (c) => {
  try {
    const result = await syncPackArticles();
    return c.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`BC sync error: ${msg}`);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Containers (Scatole) ─────────────────────────────────────────────────────

packingRoutes.get('/containers', async (c) => {
  const rows = await db`SELECT * FROM pack_container ORDER BY name`;
  return c.json(rows);
});

packingRoutes.post('/containers/upsert', async (c) => {
  const body = await parseBody(c, z.object({
    id:         z.number().int().positive().optional(),
    name:       z.string().min(1),
    length_mm:  z.number().positive().optional().nullable(),
    width_mm:   z.number().positive().optional().nullable(),
    height_mm:  z.number().positive().optional().nullable(),
    tare_kg:    z.number().nonnegative().optional().nullable(),
    active:     z.boolean().optional(),
  }));

  if (body.id) {
    await db`
      UPDATE pack_container
      SET name       = ${body.name},
          length_mm  = ${body.length_mm ?? null},
          width_mm   = ${body.width_mm  ?? null},
          height_mm  = ${body.height_mm ?? null},
          tare_kg    = ${body.tare_kg   ?? null},
          active     = ${body.active    ?? true}
      WHERE id = ${body.id}
    `;
    return c.json({ status: 'updated' });
  }

  const [row] = await db`
    INSERT INTO pack_container (name, length_mm, width_mm, height_mm, tare_kg, active)
    VALUES (${body.name}, ${body.length_mm ?? null}, ${body.width_mm ?? null},
            ${body.height_mm ?? null}, ${body.tare_kg ?? null}, ${body.active ?? true})
    RETURNING id
  `;
  return c.json({ status: 'created', id: row.id }, 201);
});

packingRoutes.delete('/containers/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [deleted] = await db`DELETE FROM pack_container WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Contenitore non trovato' });
  return c.json({ status: 'deleted' });
});

// ─── Article Weights ──────────────────────────────────────────────────────────

packingRoutes.get('/article-weights', async (c) => {
  const rows = await db`
    SELECT aw.article_code, a.description, aw.unit_weight_kg
    FROM pack_article_weight aw
    LEFT JOIN pack_article a ON a.code = aw.article_code
    ORDER BY aw.article_code
  `;
  return c.json(rows);
});

packingRoutes.post('/article-weight/upsert', async (c) => {
  const body = await parseBody(c, z.object({
    article_code:   z.string().min(1),
    unit_weight_kg: z.number().positive(),
  }));
  await db`
    INSERT INTO pack_article_weight (article_code, unit_weight_kg)
    VALUES (${body.article_code}, ${body.unit_weight_kg})
    ON CONFLICT (article_code) DO UPDATE SET unit_weight_kg = EXCLUDED.unit_weight_kg, updated_at = NOW()
  `;
  return c.json({ status: 'ok' });
});

packingRoutes.delete('/article-weight/:code', async (c) => {
  const code = c.req.param('code');
  await db`DELETE FROM pack_article_weight WHERE article_code = ${code}`;
  return c.json({ status: 'deleted' });
});

// ─── Article Prices ───────────────────────────────────────────────────────────

packingRoutes.get('/article-prices', async (c) => {
  const rows = await db`
    SELECT ap.article_code, a.description, ap.currency, ap.unit_cost
    FROM pack_article_price ap
    LEFT JOIN pack_article a ON a.code = ap.article_code
    ORDER BY ap.article_code
  `;
  return c.json(rows);
});

packingRoutes.post('/article-prices/upsert', async (c) => {
  const body = await parseBody(c, z.object({
    article_code: z.string().min(1),
    currency:     z.string().min(1).default('EUR'),
    unit_cost:    z.number().nonnegative(),
  }));
  await db`
    INSERT INTO pack_article_price (article_code, currency, unit_cost)
    VALUES (${body.article_code}, ${body.currency ?? 'EUR'}, ${body.unit_cost})
    ON CONFLICT (article_code, currency) DO UPDATE SET unit_cost = EXCLUDED.unit_cost, updated_at = NOW()
  `;
  return c.json({ status: 'ok' });
});

packingRoutes.delete('/article-prices/:code', async (c) => {
  const code = c.req.param('code');
  await db`DELETE FROM pack_article_price WHERE article_code = ${code}`;
  return c.json({ status: 'deleted' });
});

// ─── Article → Container mapping ──────────────────────────────────────────────

packingRoutes.get('/article-containers', async (c) => {
  const rows = await db`
    SELECT ac.article_code, a.description, ac.container_id, pc.name AS container_name,
           pc.length_mm, pc.width_mm, pc.height_mm, pc.tare_kg
    FROM pack_article_container ac
    LEFT JOIN pack_article a ON a.code = ac.article_code
    LEFT JOIN pack_container pc ON pc.id = ac.container_id
    ORDER BY ac.article_code
  `;
  return c.json(rows);
});

packingRoutes.post('/article-container/map', async (c) => {
  const body = await parseBody(c, z.object({
    article_code: z.string().min(1),
    container_id: z.number().int().positive(),
  }));
  await db`
    INSERT INTO pack_article_container (article_code, container_id)
    VALUES (${body.article_code}, ${body.container_id})
    ON CONFLICT (article_code) DO UPDATE SET container_id = EXCLUDED.container_id
  `;
  return c.json({ status: 'ok' });
});

packingRoutes.delete('/article-container/:code', async (c) => {
  const code = c.req.param('code');
  await db`DELETE FROM pack_article_container WHERE article_code = ${code}`;
  return c.json({ status: 'deleted' });
});

// ─── Detail Logistics (per PDF Dogana) ───────────────────────────────────────

packingRoutes.get('/packing-lists/:id/detail-logistics', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [dispatch] = await db`
    SELECT d.id, d.type, dest.name AS destination_name, d.created_at
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
        a.family,
        i.quantity,
        i.commessa,
        aw.unit_weight_kg,
        ap.unit_cost,
        ap.currency,
        pc.id         AS container_id,
        pc.name       AS container_name,
        pc.length_mm,
        pc.width_mm,
        pc.height_mm,
        pc.tare_kg    AS container_tare_kg
      FROM pack_pallet_item i
      LEFT JOIN pack_article          a  ON a.code        = i.article_code
      LEFT JOIN pack_article_weight   aw ON aw.article_code = i.article_code
      LEFT JOIN pack_article_price    ap ON ap.article_code = i.article_code AND ap.currency = 'EUR'
      LEFT JOIN pack_article_container ac ON ac.article_code = i.article_code
      LEFT JOIN pack_container        pc ON pc.id          = ac.container_id
      WHERE i.pallet_id = ${p.id}
      ORDER BY i.id ASC
    `;

    const itemsMapped = items.map((it) => {
      const unitWeight     = it.unit_weight_kg  != null ? Number(it.unit_weight_kg)  : null;
      const containerTare  = it.container_tare_kg != null ? Number(it.container_tare_kg) : null;
      const unitCost       = it.unit_cost != null ? Number(it.unit_cost) : null;
      const qty            = Number(it.quantity);

      const net_kg   = unitWeight    != null ? unitWeight * qty                 : null;
      const gross_kg = unitWeight    != null && containerTare != null ? unitWeight * qty + containerTare : net_kg;
      const line_cost = unitCost     != null ? unitCost * qty                   : null;

      return {
        ...it,
        quantity:          qty,
        unit_weight_kg:    unitWeight,
        unit_cost:         unitCost,
        container_tare_kg: containerTare,
        net_kg,
        gross_kg,
        line_cost,
        missing_weight:    unitWeight == null,
        missing_container: it.container_id == null,
        missing_price:     unitCost == null,
      };
    });

    const pallet_net_kg   = itemsMapped.every(it => it.net_kg   != null) ? itemsMapped.reduce((s, it) => s + (it.net_kg   ?? 0), 0) : null;
    const pallet_gross_kg = itemsMapped.every(it => it.gross_kg != null) ? itemsMapped.reduce((s, it) => s + (it.gross_kg ?? 0), 0) : null;
    const pallet_cost     = itemsMapped.every(it => it.line_cost != null) ? itemsMapped.reduce((s, it) => s + (it.line_cost ?? 0), 0) : null;

    return {
      ...p,
      items: itemsMapped,
      pallet_net_kg,
      pallet_gross_kg,
      pallet_cost,
    };
  }));

  const total_net_kg   = palletsWithItems.every(p => p.pallet_net_kg   != null) ? palletsWithItems.reduce((s, p) => s + (p.pallet_net_kg   ?? 0), 0) : null;
  const total_gross_kg = palletsWithItems.every(p => p.pallet_gross_kg != null) ? palletsWithItems.reduce((s, p) => s + (p.pallet_gross_kg ?? 0), 0) : null;
  const total_cost     = palletsWithItems.every(p => p.pallet_cost     != null) ? palletsWithItems.reduce((s, p) => s + (p.pallet_cost     ?? 0), 0) : null;

  return c.json({
    ...dispatch,
    pallets: palletsWithItems,
    total_net_kg,
    total_gross_kg,
    total_cost,
  });
});
