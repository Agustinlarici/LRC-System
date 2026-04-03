import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { getBufferCache, bufferFullRefresh, refreshSingleBuffer } from './cache.js';
import { queryBuffer, queryFasi, queryModelliComponenti } from './mysql-client.js';

export const bufferRoutes = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const comboSchema = z.object({
  modello:    z.string().min(1),
  componente: z.string().min(1),
});

const lineaSchema = z.object({
  nome:          z.string().min(1),
  fasi:          z.array(z.string().min(1)).min(1),
  soglia_verde:  z.number().int().min(1),
  soglia_giallo: z.number().int().min(1),
  combos:        z.array(comboSchema),
});

// ─── GET /api/buffer/fasi ─────────────────────────────────────────────────────

bufferRoutes.get('/fasi', async (c) => {
  try {
    return c.json(await queryFasi());
  } catch {
    return c.json([]);
  }
});

// ─── GET /api/buffer/modelli ──────────────────────────────────────────────────

bufferRoutes.get('/modelli', async (c) => {
  try {
    return c.json(await queryModelliComponenti());
  } catch {
    return c.json([]);
  }
});

// ─── GET /api/buffer ──────────────────────────────────────────────────────────

bufferRoutes.get('/', async (c) => {
  const linee = await db`SELECT id, nome, attivo, created_at FROM buffer_linea ORDER BY nome`;

  const result = await Promise.all(linee.map(async (l) => {
    const fasi     = await db`SELECT fase FROM buffer_linea_fase  WHERE linea_id = ${l.id} ORDER BY id`;
    const combos   = await db`SELECT modello, componente FROM buffer_linea_combo WHERE linea_id = ${l.id} ORDER BY id`;
    const [soglie] = await db`SELECT soglia_verde, soglia_giallo FROM buffer_soglie WHERE linea_id = ${l.id}`;
    return {
      ...l,
      fasi:   fasi.map(f => f.fase as string),
      combos,
      soglie: soglie ?? { soglia_verde: 10, soglia_giallo: 5 },
    };
  }));

  return c.json(result);
});

// ─── POST /api/buffer ─────────────────────────────────────────────────────────

bufferRoutes.post('/', async (c) => {
  const body = await parseBody(c, lineaSchema);

  let newLineaId = 0;
  await db.begin(async (sql) => {
    const q = sql as unknown as typeof db;
    const [linea] = await q`INSERT INTO buffer_linea (nome) VALUES (${body.nome}) RETURNING id`;
    newLineaId = linea.id as number;

    for (const fase of body.fasi) {
      await q`INSERT INTO buffer_linea_fase (linea_id, fase) VALUES (${newLineaId}, ${fase})`;
    }
    await q`
      INSERT INTO buffer_soglie (linea_id, soglia_verde, soglia_giallo)
      VALUES (${newLineaId}, ${body.soglia_verde}, ${body.soglia_giallo})
    `;
    for (const combo of body.combos) {
      await q`INSERT INTO buffer_linea_combo (linea_id, modello, componente) VALUES (${newLineaId}, ${combo.modello}, ${combo.componente})`;
    }
  });

  refreshSingleBuffer(newLineaId); // fire-and-forget: one query only for the new buffer
  return c.json({ ok: true }, 201);
});

// ─── GET /api/buffer/:id/stato ────────────────────────────────────────────────

bufferRoutes.get('/:id/stato', async (c) => {
  const id = parseId(c.req.param('id'));

  const [linea] = await db`SELECT id, nome FROM buffer_linea WHERE id = ${id} AND attivo = true`;
  if (!linea) throw new HTTPException(404, { message: 'Buffer non trovato' });

  const [soglie] = await db`SELECT soglia_verde, soglia_giallo FROM buffer_soglie WHERE linea_id = ${id}`;
  const s = soglie ?? { soglia_verde: 10, soglia_giallo: 5 };

  const cached = getBufferCache(id);
  const items  = cached?.items ?? [];
  const count  = items.length;
  const commesse = [...new Set(items.map(i => i.commessa).filter(Boolean) as string[])].sort();

  const colore: 'verde' | 'giallo' | 'rosso' =
    count >= (s.soglia_verde  as number) ? 'verde'  :
    count >= (s.soglia_giallo as number) ? 'giallo' : 'rosso';

  return c.json({ count, commesse, colore, soglie: s });
});

// ─── PUT /api/buffer/:id ──────────────────────────────────────────────────────

bufferRoutes.put('/:id', async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, lineaSchema);

  const [existing] = await db`SELECT id FROM buffer_linea WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Buffer non trovato' });

  await db.begin(async (sql) => {
    const q = sql as unknown as typeof db;
    await q`UPDATE buffer_linea SET nome = ${body.nome} WHERE id = ${id}`;

    await q`DELETE FROM buffer_linea_fase WHERE linea_id = ${id}`;
    for (const fase of body.fasi) {
      await q`INSERT INTO buffer_linea_fase (linea_id, fase) VALUES (${id}, ${fase})`;
    }
    await q`
      INSERT INTO buffer_soglie (linea_id, soglia_verde, soglia_giallo)
      VALUES (${id}, ${body.soglia_verde}, ${body.soglia_giallo})
      ON CONFLICT (linea_id) DO UPDATE
        SET soglia_verde  = EXCLUDED.soglia_verde,
            soglia_giallo = EXCLUDED.soglia_giallo
    `;
    await q`DELETE FROM buffer_linea_combo WHERE linea_id = ${id}`;
    for (const combo of body.combos) {
      await q`INSERT INTO buffer_linea_combo (linea_id, modello, componente) VALUES (${id}, ${combo.modello}, ${combo.componente})`;
    }
  });

  return c.json({ ok: true });
});

// ─── DELETE /api/buffer/:id ───────────────────────────────────────────────────

bufferRoutes.delete('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [deleted] = await db`DELETE FROM buffer_linea WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Buffer non trovato' });
  return c.body(null, 204);
});

// ─── POST /api/buffer/refresh ─────────────────────────────────────────────────

bufferRoutes.post('/refresh', async (c) => {
  bufferFullRefresh(); // fire and forget
  return c.json({ ok: true, message: 'Refresh avviato' });
});

// ─── GET /api/buffer/debug-webthron?from=YYYY-MM-DD&to=YYYY-MM-DD ────────────
// Conta i record in WebThron per le combo della linea 11 in un range di date.

bufferRoutes.get('/debug-webthron', async (c) => {
  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  const from = c.req.query('from') ?? '2026-03-03';
  const to   = c.req.query('to')   ?? '2026-03-06';
  try {
    const [rows] = await getWebthronPool().execute({
      sql: `
        SELECT /*+ MAX_EXECUTION_TIME(60000) */
          DATE(ubi.datain) AS giorno,
          ikExtra62Tab.stringa AS fase,
          COUNT(*) AS n
        FROM ubidocum ubi
        LEFT JOIN ikExtra Extra62 ON ubi.iddocu = Extra62.iddocu AND Extra62.idcampo = 62 AND Extra62.idcomm = 0 AND Extra62.seq = 0
        LEFT JOIN ikExtra Extra43 ON ubi.iddocu = Extra43.iddocu AND Extra43.idcampo = 43 AND Extra43.idcomm = 0 AND Extra43.seq = 0
        LEFT JOIN ikExtra Extra45 ON ubi.iddocu = Extra45.iddocu AND Extra45.idcampo = 45 AND Extra45.idcomm = 0 AND Extra45.seq = 0
        LEFT JOIN ikExtraTab ikExtra62Tab ON ikExtra62Tab.id = Extra62.stringa
        LEFT JOIN ikExtraTab ikExtra43Tab ON ikExtra43Tab.id = Extra43.stringa
        LEFT JOIN ikExtraTab ikExtra45Tab ON ikExtra45Tab.id = Extra45.stringa
        WHERE ubi.datain >= ? AND ubi.datain < DATE_ADD(?, INTERVAL 1 DAY)
          AND ikExtra43Tab.stringa = 'F175'
          AND ikExtra45Tab.stringa = 'PAR. POST / REAR BUMPER'
        GROUP BY DATE(ubi.datain), ikExtra62Tab.stringa
        ORDER BY giorno
      `,
      timeout: 60_000,
    }, [from, to]) as any;
    return c.json({ from, to, rows });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ─── GET /api/buffer/ping-mysql ───────────────────────────────────────────────

bufferRoutes.get('/ping-mysql', async (c) => {
  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  try {
    const [rows] = await getWebthronPool().execute({ sql: 'SELECT /*+ MAX_EXECUTION_TIME(10000) */ COUNT(*) AS cnt FROM ubidocum WHERE datain >= CURDATE() - INTERVAL 1 DAY', timeout: 10_000 }) as any;
    return c.json({ ok: true, ubidocum_1day: rows[0].cnt });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ─── GET /api/buffer/processi ─────────────────────────────────────────────────

bufferRoutes.get('/processi', async (c) => {
  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  try {
    const [rows] = await getWebthronPool().execute({ sql: 'SHOW PROCESSLIST', timeout: 10_000 }) as any;
    return c.json(rows);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ─── POST /api/buffer/kill/:id ────────────────────────────────────────────────

bufferRoutes.post('/kill/:id', async (c) => {
  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  const id = parseInt(c.req.param('id'), 10);
  try {
    await getWebthronPool().execute({ sql: `KILL QUERY ${id}`, timeout: 5_000 });
    return c.json({ killed: id });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ─── POST /api/buffer/kill-zombie ─────────────────────────────────────────────

bufferRoutes.post('/kill-zombie', async (c) => {
  const { getWebthronPool } = await import('../monitor/mysql-client.js');
  const pool = getWebthronPool();
  try {
    const [rows] = await pool.execute({ sql: 'SHOW PROCESSLIST', timeout: 10_000 }) as any;
    const zombies = (rows as any[]).filter(r => r.Command !== 'Sleep' && r.Time > 10);
    const results = [];
    for (const z of zombies) {
      try {
        await pool.execute({ sql: `KILL QUERY ${z.Id}`, timeout: 5_000 });
        results.push({ id: z.Id, time: z.Time, status: 'killed' });
      } catch (e) {
        results.push({ id: z.Id, time: z.Time, status: 'error', error: String(e) });
      }
    }
    return c.json({ killed: results.length, results });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ─── GET /api/buffer/:id/debug ────────────────────────────────────────────────

bufferRoutes.get('/:id/debug', async (c) => {
  const id     = parseId(c.req.param('id'));
  const fasi   = await db`SELECT fase FROM buffer_linea_fase  WHERE linea_id = ${id} ORDER BY id`;
  const combos = await db`SELECT modello, componente FROM buffer_linea_combo WHERE linea_id = ${id} ORDER BY id`;
  const fasiArr   = fasi.map(f => f.fase as string);
  const combosArr = combos as unknown as Array<{ modello: string; componente: string }>;
  try {
    const items = await queryBuffer(fasiArr, combosArr);
    return c.json({ fasi: fasiArr, combos: combosArr, count: items.length, items: items.slice(0, 10) });
  } catch (err) {
    return c.json({ fasi: fasiArr, combos: combosArr, error: String(err) }, 500);
  }
});
