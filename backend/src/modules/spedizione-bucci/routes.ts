import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { auditLog } from '../../lib/audit.js';
import { getIKnowFlags } from '../../lib/system-flags.js';
import { logger } from '../../lib/logger.js';
import { parseScan, findBySerialiMany, findByCommesseMany, findByCommessa, findTipoLottoPrimerMany, lookbackDays } from './lookup.js';
import { planResolution, type Problem } from './verify.js';

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

async function touchShipment(id: number, userName: string) {
  await db`UPDATE bucci_shipment SET modified_at = now(), modified_by_name = ${userName} WHERE id = ${id} AND was_closed`;
}

async function requireIKnow() {
  const flags = await getIKnowFlags();
  if (!flags.iknow_enabled) {
    throw new HTTPException(503, { message: 'Connessione iKnow disabilitata dall\'amministratore' });
  }
}

// ─── Lista / dettaglio ────────────────────────────────────────────────────────

// GET /api/bucci/shipments — storico spedizioni con numero di cofani
spedizioneBucciRoutes.get('/shipments', requireModule(MODULE), async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);
  const rows = await db`
    SELECT s.id, s.status, s.note, s.created_by_name, s.created_at, s.closed_at, s.closed_by_name,
           s.modified_at, s.modified_by_name,
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
    SELECT id, status, note, created_by_name, created_at, closed_at, closed_by_name, modified_at, modified_by_name
    FROM bucci_shipment WHERE id = ${id}
  `;
  if (!shipment) throw new HTTPException(404, { message: 'Spedizione non trovata' });
  const items = await db`
    SELECT id, scanned_code, seriale, componente, modello, commessa, tipo_lotto_primer, conto_garanzia, scanned_by_name, scanned_at
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

// Non si chiude con cofani non ancora risolti (seriale NULL): prima /verify
spedizioneBucciRoutes.post('/shipments/:id/close', requireModule(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const user = c.get('user');
  const [row] = await db`
    UPDATE bucci_shipment
    SET status = 'closed', was_closed = true, closed_at = now(), closed_by_name = ${user.display_name}
    WHERE id = ${id} AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM bucci_shipment_item i WHERE i.shipment_id = ${id} AND i.seriale IS NULL)
    RETURNING id
  `;
  if (!row) {
    const s = await requireShipment(id);
    if (s.status === 'open') {
      throw new HTTPException(409, { message: 'Ci sono cofani non ancora verificati: verifica la spedizione prima di chiuderla' });
    }
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
  code: z.string().min(1).max(64),
});

// POST /api/bucci/shipments/:id/scan
//  → 201 { status:'added', item }   codice salvato con seriale NULL: lo risolve /verify, qui niente iKnow
//  → 409 già presente / spedizione chiusa
// Controllo doppi immediato: per BUCC… valgono le ultime 4 cifre, per gli altri codici il codice intero.
spedizioneBucciRoutes.post('/shipments/:id/scan', requireModule(MODULE), async (c) => {
  const id   = parseId(c.req.param('id'));
  const body = await parseBody(c, ScanSchema);
  const user = c.get('user');

  await requireOpenShipment(id);

  const parsed = parseScan(body.code);
  if (!parsed) throw new HTTPException(400, { message: 'Codice non valido' });
  const code = body.code.trim();

  const [dup] = parsed.kind === 'commessa'
    ? await db`
        SELECT scanned_code FROM bucci_shipment_item
        WHERE shipment_id = ${id}
          AND ((upper(scanned_code) LIKE 'BUCC%' AND right(trim(scanned_code), 4) = ${parsed.commessa})
               OR commessa = ${parsed.commessa})
        LIMIT 1`
    : await db`
        SELECT scanned_code FROM bucci_shipment_item
        WHERE shipment_id = ${id}
          AND (upper(scanned_code) = upper(${code}) OR upper(seriale) = upper(${code}))
        LIMIT 1`;
  if (dup) throw new HTTPException(409, { message: `${code} già presente in questa spedizione` });

  // Inserimento atomico: fallisce se la spedizione nel frattempo è stata chiusa
  const [item] = await db`
    INSERT INTO bucci_shipment_item (shipment_id, scanned_code, scanned_by_name)
    SELECT s.id, ${code}, ${user.display_name}
    FROM bucci_shipment s
    WHERE s.id = ${id} AND s.status = 'open'
    RETURNING id, scanned_code, seriale, componente, modello, commessa, tipo_lotto_primer, conto_garanzia, scanned_by_name, scanned_at
  `;
  if (!item) {
    await requireOpenShipment(id);
    throw new HTTPException(409, { message: 'Spedizione non modificabile' });
  }

  await touchShipment(id, user.display_name);
  return c.json({ status: 'added', item }, 201);
});

// POST /api/bucci/shipments/:id/verify
// Risolve in iKnow, con query in blocco, i codici non ancora risolti (seriale NULL), completa il Tipo Lotto Primer
// mancante e segnala i problemi. Idempotente: il frontend lo richiama ogni qualche scansione e prima di chiudere.
spedizioneBucciRoutes.post('/shipments/:id/verify', requireModule(MODULE), async (c) => {
  const id = parseId(c.req.param('id'));
  await requireOpenShipment(id);
  await requireIKnow();

  const before = await db`
    SELECT id, scanned_code, seriale FROM bucci_shipment_item WHERE shipment_id = ${id} ORDER BY id
  ` as unknown as Array<{ id: number; scanned_code: string; seriale: string | null }>;

  const pending = before.filter(i => i.seriale === null);
  const taken   = new Set(before.flatMap(i => i.seriale ? [i.seriale.toUpperCase()] : []));
  let problems: Problem[] = [];
  let iknowError = false;

  if (pending.length > 0) {
    const parsed   = pending.map(p => parseScan(p.scanned_code));
    const seriali  = parsed.flatMap(p => p?.kind === 'seriale' ? [p.seriale] : []);
    const commesse = [...new Set(parsed.flatMap(p => p?.kind === 'commessa' ? [p.commessa] : []))];
    try {
      const [bySeriale, byCommessa] = await Promise.all([findBySerialiMany(seriali), findByCommesseMany(commesse)]);
      const plan = planResolution(pending, taken, bySeriale, byCommessa);
      problems = plan.problems;
      for (const r of plan.resolved) {
        try {
          await db`
            UPDATE bucci_shipment_item
            SET seriale = ${r.unit.seriale}, componente = ${r.unit.componente}, modello = ${r.unit.modello}, commessa = ${r.unit.commessa}
            WHERE id = ${r.item_id} AND shipment_id = ${id} AND seriale IS NULL
          `;
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') throw err;
          const item = pending.find(p => p.id === r.item_id)!;
          problems.push({ item_id: item.id, scanned_code: item.scanned_code, kind: 'duplicate', seriale: r.unit.seriale });
        }
      }
    } catch (err) {
      logger.error({ err }, 'spedizione-bucci: query iKnow fallita');
      iknowError = true;
    }
  }

  // Tipo Lotto Primer mancante (anche per cofani risolti prima); se iKnow non risponde i cofani restano salvati
  let primerUnavailable = false;
  const missing = (await db`
    SELECT id, seriale FROM bucci_shipment_item
    WHERE shipment_id = ${id} AND seriale IS NOT NULL AND tipo_lotto_primer IS NULL
  `) as unknown as Array<{ id: number; seriale: string }>;
  if (missing.length > 0 && !iknowError) {
    try {
      const primer = await findTipoLottoPrimerMany(missing.map(m => m.seriale));
      for (const m of missing) {
        const value = primer.get(m.seriale.toUpperCase());
        if (value) await db`UPDATE bucci_shipment_item SET tipo_lotto_primer = ${value} WHERE id = ${m.id} AND shipment_id = ${id}`;
      }
    } catch (err) {
      logger.warn({ err }, 'spedizione-bucci: tipo lotto primer non letto');
      primerUnavailable = true;
    }
  }

  const items = (await db`
    SELECT id, scanned_code, seriale, componente, modello, commessa, tipo_lotto_primer, conto_garanzia, scanned_by_name, scanned_at
    FROM bucci_shipment_item WHERE shipment_id = ${id} ORDER BY id
  `) as unknown as Array<{ id: number; seriale: string | null; tipo_lotto_primer: string | null }>;

  const resolvedSeriali = items.flatMap(i => i.seriale ? [i.seriale] : []);
  const others = resolvedSeriali.length === 0 ? [] : (await db`
    SELECT DISTINCT ON (seriale) seriale, shipment_id FROM bucci_shipment_item
    WHERE seriale = ANY(${resolvedSeriali}) AND shipment_id <> ${id}
    ORDER BY seriale, shipment_id DESC
  `) as unknown as Array<{ seriale: string; shipment_id: number }>;
  const otherBySeriale = new Map(others.map(o => [o.seriale, o.shipment_id]));

  const warnings = items.flatMap(i => {
    const out: Array<{ item_id: number; kind: 'no_primer' | 'in_other_shipment'; shipment_id?: number }> = [];
    if (i.seriale && !i.tipo_lotto_primer) out.push({ item_id: i.id, kind: 'no_primer' });
    const other = i.seriale ? otherBySeriale.get(i.seriale) : undefined;
    if (other) out.push({ item_id: i.id, kind: 'in_other_shipment', shipment_id: other });
    return out;
  });

  return c.json({
    items,
    problems,
    warnings,
    iknow_error: iknowError,
    primer_unavailable: primerUnavailable,
    unresolved: items.filter(i => !i.seriale).length,
  });
});

// POST /api/bucci/shipments/:id/items/:itemId/resolve — l'operatore sceglie il seriale di una commessa con più candidati
spedizioneBucciRoutes.post('/shipments/:id/items/:itemId/resolve', requireModule(MODULE), async (c) => {
  const id     = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  const body   = await parseBody(c, z.object({ seriale: z.string().min(1).max(64) }));
  await requireOpenShipment(id);
  await requireIKnow();

  const [item] = await db`SELECT scanned_code, seriale FROM bucci_shipment_item WHERE id = ${itemId} AND shipment_id = ${id}`;
  if (!item) throw new HTTPException(404, { message: 'Elemento non trovato' });
  if (item.seriale) throw new HTTPException(409, { message: 'Cofano già verificato' });
  const parsed = parseScan(item.scanned_code);
  if (parsed?.kind !== 'commessa') throw new HTTPException(400, { message: 'Il codice non è una commessa' });

  let units;
  try {
    units = await findByCommessa(parsed.commessa);
  } catch (err) {
    logger.error({ err }, 'spedizione-bucci: query iKnow fallita');
    throw new HTTPException(502, { message: 'iKnow non raggiungibile o troppo lento, riprovare' });
  }
  const unit = units.find(u => u.seriale.toUpperCase() === body.seriale.toUpperCase());
  if (!unit) throw new HTTPException(404, { message: `${body.seriale} non appartiene alla commessa ${parsed.commessa}` });

  try {
    await db`
      UPDATE bucci_shipment_item
      SET seriale = ${unit.seriale}, componente = ${unit.componente}, modello = ${unit.modello}, commessa = ${unit.commessa}
      WHERE id = ${itemId} AND shipment_id = ${id} AND seriale IS NULL
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HTTPException(409, { message: `${unit.seriale} già presente in questa spedizione` });
    }
    throw err;
  }
  await touchShipment(id, c.get('user').display_name);
  return c.json({ status: 'resolved' });
});

// PATCH /api/bucci/shipments/:id/items/:itemId — flag Conto Garanzia (solo spedizione aperta)
spedizioneBucciRoutes.patch('/shipments/:id/items/:itemId', requireModule(MODULE), async (c) => {
  const id     = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  const body   = await parseBody(c, z.object({ conto_garanzia: z.boolean() }));
  await requireOpenShipment(id);
  const [row] = await db`
    UPDATE bucci_shipment_item SET conto_garanzia = ${body.conto_garanzia}
    WHERE id = ${itemId} AND shipment_id = ${id}
    RETURNING id, conto_garanzia
  `;
  if (!row) throw new HTTPException(404, { message: 'Elemento non trovato' });
  await touchShipment(id, c.get('user').display_name);
  return c.json(row);
});

spedizioneBucciRoutes.delete('/shipments/:id/items/:itemId', requireModule(MODULE), async (c) => {
  const id     = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  await requireOpenShipment(id);
  const [row] = await db`DELETE FROM bucci_shipment_item WHERE id = ${itemId} AND shipment_id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Elemento non trovato' });
  await touchShipment(id, c.get('user').display_name);
  return c.json({ status: 'deleted' });
});
