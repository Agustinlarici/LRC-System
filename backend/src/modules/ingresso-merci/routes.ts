import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';

export const ingressoMerciRoutes = new Hono();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  materiale:    z.string().min(1, 'materiale è obbligatorio'),
  mezzo:        z.string().min(1, 'mezzo è obbligatorio'),
  commessa:     z.string().optional().nullable(),
  inseritoDa:   z.string().default('Anonimo'),
  orarioArrivo: z.string().min(1, 'orario_arrivo è obbligatorio'),
});

const SegnaArrivatoSchema = z.object({
  ricevutoDa: z.string().min(1, 'ricevuto_da è obbligatorio'),
});

// ─── GET / ────────────────────────────────────────────────────────────────────

ingressoMerciRoutes.get('/', async (c) => {
  const rows = await db`
    SELECT id, materiale, mezzo, commessa, inserito_da,
           orario_arrivo, timestamp_inserimento
    FROM ingresso_merci
    ORDER BY orario_arrivo ASC
  `;
  return c.json(
    rows.map(r => ({
      id:                   r.id,
      materiale:            r.materiale,
      mezzo:                r.mezzo,
      commessa:             r.commessa,
      inseritoDa:           r.inserito_da,
      orarioArrivo:         r.orario_arrivo
        ? new Date(r.orario_arrivo as string).toISOString().slice(0, 16)
        : '',
      timestampInserimento: fmtDisplay(r.timestamp_inserimento),
    }))
  );
});

// ─── POST / ───────────────────────────────────────────────────────────────────

ingressoMerciRoutes.post('/', async (c) => {
  const body = await parseBody(c, CreateSchema);
  const [row] = await db`
    INSERT INTO ingresso_merci (materiale, mezzo, commessa, inserito_da, orario_arrivo)
    VALUES (
      ${body.materiale},
      ${body.mezzo},
      ${body.commessa ?? null},
      ${body.inseritoDa ?? 'Anonimo'},
      ${body.orarioArrivo.replace('T', ' ')}
    )
    RETURNING id
  `;
  return c.json({ id: row.id }, 201);
});

// ─── POST /:id/arrivato ───────────────────────────────────────────────────────

ingressoMerciRoutes.post('/:id/arrivato', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const { ricevutoDa } = await parseBody(c, SegnaArrivatoSchema);

  const [existing] = await db`
    SELECT materiale, mezzo, commessa, inserito_da, orario_arrivo
    FROM ingresso_merci WHERE id = ${id}
  `;
  if (!existing) throw new HTTPException(404, { message: 'Materiale non trovato' });

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    await tx`
      INSERT INTO ingresso_merci_storico
        (materiale, mezzo, commessa, inserito_da, orario_arrivo, ricevuto_da)
      VALUES (
        ${existing.materiale},
        ${existing.mezzo},
        ${existing.commessa},
        ${existing.inserito_da},
        ${existing.orario_arrivo},
        ${ricevutoDa}
      )
    `;
    await tx`DELETE FROM ingresso_merci WHERE id = ${id}`;
  });

  return c.json({ ok: true });
});

// ─── GET /storico ─────────────────────────────────────────────────────────────

ingressoMerciRoutes.get('/storico', async (c) => {
  const rows = await db`
    SELECT id, materiale, mezzo, commessa, inserito_da,
           orario_arrivo, ricevuto_da, timestamp_ricezione
    FROM ingresso_merci_storico
    ORDER BY timestamp_ricezione DESC
    LIMIT 100
  `;
  return c.json(
    rows.map(r => ({
      id:                  r.id,
      materiale:           r.materiale,
      mezzo:               r.mezzo,
      commessa:            r.commessa,
      inseritoDa:          r.inserito_da,
      orarioArrivo:        fmtDisplay(r.orario_arrivo),
      ricevutoDa:          r.ricevuto_da,
      timestampRicezione:  r.timestamp_ricezione
        ? new Date(r.timestamp_ricezione as string).toLocaleString('it-IT')
        : '',
    }))
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDisplay(dt: unknown): string {
  if (!dt) return '';
  const d = new Date(dt as string);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
