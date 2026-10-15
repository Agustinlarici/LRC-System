import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { auditLog } from '../../lib/audit.js';
import { getIKnowFlags } from '../../lib/system-flags.js';
import { logger } from '../../lib/logger.js';
import { parseScan, findBySeriale, findByCommessa, findTipoLottoPrimer, lookbackDays, type BucciUnit } from './lookup.js';

export const spedizioneBucciRoutes = new Hono();

const MODULE = 'spedizione_bucci' as const;

function parseId(raw: string | undefined): number {
  const id = parseInt(raw ?? '', 10);
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

async function requireShipment(id: number) {
  const [s] = await db`SELECT id, status FROM bucci_shipment WHERE id = ${id}`;
  if (!s) throw new HTTPException(404, { message: 'Spedizione non trovata' });
  return s as { id: number; status: 'open' | 'closed' };
}

async function requireOpenShipment(id: number) {
  const s = await requireShipment(id);
  if (s.status !== 'open') throw new HTTPException(409, { message: 'Spedizione chiusa: non modificabile' });
  return s;
}

// ─── Lista / dettaglio ────────────────────────────────────────────────────────

// GET /api/bucci/shipments — storico spedizioni con numero di cofani
spedizioneBucciRoutes.get('/shipments', requireModule(MODULE), async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);
  const rows = await db`
    SELECT s.id, s.status, s.note, s.created_by_name, s.created_at, s.closed_at, s.closed_by_name,
           COUNT(i.id)::int AS items
    FROM bucci_shipment s
    LEFT JOIN bucci_shipment_item i ON i.shipment_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `;
  return c.json(rows);
});

// GET /api/bucci/shipments/:id
spedizioneBucciRoutes.get('/shipments/:id', requireModule(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  const [shipment] = await db`
    SELECT id, status, note, created_by_name, created_at, closed_at, closed_by_name
    FROM bucci_shipment WHERE id = ${id}
  `;
  if (!shipment) throw new HTTPException(404, { message: 'Spedizione non trovata' });
  const items = await db`
    SELECT id, scanned_code, seriale, componente, commessa, tipo_lotto_primer, scanned_by_name, scanned_at
    FROM bucci_shipment_item WHERE shipment_id = ${id}
    ORDER BY id ASC
  `;
  return c.json({ ...shipment, items, lookback_days: lookbackDays() });
});

// ─── Creazione / chiusura ─────────────────────────────────────────────────────

spedizioneBucciRoutes.post('/shipments', requireModule(MODULE), async (c) => {
  const body = await parseBody(c, z.object({ note: z.string().trim().max(500).optional() }));
  const user = c.get('user');
  const [row] = await db`
    INSERT INTO bucci_shipment (created_by_id, created_by_name, note)
    VALUES (${user.id}, ${user.display_name}, ${body.note || null})
    RETURNING id
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'bucci_shipment_create', entity: 'bucci_shipment', entityId: row.id });
  return c.json({ id: row.id }, 201);
});

spedizioneBucciRoutes.post('/shipments/:id/close', requireModule(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const user = c.get('user');
  const [row] = await db`
    UPDATE bucci_shipment
    SET status = 'closed', closed_at = now(), closed_by_name = ${user.display_name}
    WHERE id = ${id} AND status = 'open'
    RETURNING id
  `;
  if (!row) {
    await requireShipment(id);
    throw new HTTPException(409, { message: 'Spedizione già chiusa' });
  }
  await auditLog({ userId: user.id, username: user.username, action: 'bucci_shipment_close', entity: 'bucci_shipment', entityId: id });
  return c.json({ status: 'closed' });
});

spedizioneBucciRoutes.post('/shipments/:id/reopen', requireManage(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const user = c.get('user');
  const [row] = await db`
    UPDATE bucci_shipment
    SET status = 'open', closed_at = NULL, closed_by_name = NULL
    WHERE id = ${id} AND status = 'closed'
    RETURNING id
  `;
  if (!row) {
    await requireShipment(id);
    throw new HTTPException(409, { message: 'Spedizione già aperta' });
  }
  await auditLog({ userId: user.id, username: user.username, action: 'bucci_shipment_reopen', entity: 'bucci_shipment', entityId: id });
  return c.json({ status: 'open' });
});

spedizioneBucciRoutes.delete('/shipments/:id', requireManage(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const user = c.get('user');
  const [row] = await db`DELETE FROM bucci_shipment WHERE id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Spedizione non trovata' });
  await auditLog({ userId: user.id, username: user.username, action: 'bucci_shipment_delete', entity: 'bucci_shipment', entityId: id });
  return c.json({ status: 'deleted' });
});

// ─── Scansione ────────────────────────────────────────────────────────────────

const ScanSchema = z.object({
  code:    z.string().min(1).max(64),
  // Usato solo per scegliere tra più seriali della stessa commessa (BUCCxxxx)
  seriale: z.string().min(1).max(64).optional(),
});

async function lookup(parsed: NonNullable<ReturnType<typeof parseScan>>): Promise<BucciUnit[]> {
  const flags = await getIKnowFlags();
  if (!flags.iknow_enabled) {
    throw new HTTPException(503, { message: 'Connessione iKnow disabilitata dall\'amministratore' });
  }
  try {
    return parsed.kind === 'seriale'
      ? await findBySeriale(parsed.seriale)
      : await findByCommessa(parsed.commessa);
  } catch (err) {
    logger.error({ err }, 'spedizione-bucci: query iKnow fallita');
    throw new HTTPException(502, { message: 'iKnow non raggiungibile o troppo lento, riprovare' });
  }
}

// POST /api/bucci/shipments/:id/scan
//  → 201 { status:'added', item, also_in_shipment, warning }  cofano salvato
//  → 200 { status:'ambiguous', candidates }              commessa con più seriali: richiamare con `seriale`
//  → 404 non trovato nella finestra di ricerca · 409 già presente / spedizione chiusa
spedizioneBucciRoutes.post('/shipments/:id/scan', requireModule(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, ScanSchema);
  const user = c.get('user');

  await requireOpenShipment(id);

  const parsed = parseScan(body.code);
  if (!parsed) throw new HTTPException(400, { message: 'Codice non valido' });

  const units = await lookup(parsed);
  if (units.length === 0) {
    const label = parsed.kind === 'seriale' ? parsed.seriale : `commessa ${parsed.commessa}`;
    throw new HTTPException(404, {
      message: `${label} non trovato in iKnow (ultimi ${lookbackDays()} giorni)`,
    });
  }

  let unit: BucciUnit;
  if (units.length === 1) {
    unit = units[0];
  } else {
    const picked = body.seriale ? units.find(u => u.seriale === body.seriale) : undefined;
    if (!picked) return c.json({ status: 'ambiguous', candidates: units });
    unit = picked;
  }

  // Seconda query, solo per il cofano scelto. Se iKnow non risponde il cofano si salva comunque.
  let tipoLotto: string | null = null;
  let warning: string | null = null;
  try {
    tipoLotto = await findTipoLottoPrimer(unit.seriale);
  } catch (err) {
    logger.warn({ err }, 'spedizione-bucci: tipo lotto primer non letto');
    warning = 'Tipo Lotto Primer non letto (iKnow lento o non raggiungibile)';
  }

  // Inserimento atomico: fallisce se la spedizione nel frattempo è stata chiusa
  const [item] = await db`
    INSERT INTO bucci_shipment_item (shipment_id, scanned_code, seriale, componente, commessa, tipo_lotto_primer, scanned_by_name)
    SELECT s.id, ${body.code.trim()}, ${unit.seriale}, ${unit.componente}, ${unit.commessa}, ${tipoLotto}, ${user.display_name}
    FROM bucci_shipment s
    WHERE s.id = ${id} AND s.status = 'open'
    ON CONFLICT (shipment_id, seriale) DO NOTHING
    RETURNING id, scanned_code, seriale, componente, commessa, tipo_lotto_primer, scanned_by_name, scanned_at
  `;
  if (!item) {
    await requireOpenShipment(id);
    throw new HTTPException(409, { message: `${unit.seriale} già presente in questa spedizione` });
  }

  // Avviso (non bloccante): seriale già spedito in un'altra spedizione
  const [other] = await db`
    SELECT shipment_id FROM bucci_shipment_item
    WHERE seriale = ${unit.seriale} AND shipment_id <> ${id}
    ORDER BY shipment_id DESC LIMIT 1
  `;

  return c.json({ status: 'added', item, also_in_shipment: other?.shipment_id ?? null, warning }, 201);
});

spedizioneBucciRoutes.delete('/shipments/:id/items/:itemId', requireModule(MODULE), async (c) => {
  const id     = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  await requireOpenShipment(id);
  const [row] = await db`DELETE FROM bucci_shipment_item WHERE id = ${itemId} AND shipment_id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Elemento non trovato' });
  return c.json({ status: 'deleted' });
});
