import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requireModule, requireManage, type Env } from '../../lib/auth.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';
import { buildImportPlan, normText, type EmpLite } from './vestiario.js';

export const hrVestiarioRoutes = new Hono<Env>();

// Capi (nome + colore) con quante taglie hanno assegnate
hrVestiarioRoutes.get('/capi', requireModule('hr'), async (c) => {
  const rows = await db`
    SELECT k.id, k.nome, k.colore, COUNT(t.employee_id)::int AS n_taglie
    FROM hr_capo k LEFT JOIN hr_capo_taglia t ON t.capo_id = k.id
    GROUP BY k.id ORDER BY k.nome, k.colore
  `;
  return c.json(rows);
});

// Tutte le taglie assegnate (capo × dipendente)
hrVestiarioRoutes.get('/taglie', requireModule('hr'), async (c) => {
  const rows = await db`SELECT employee_id, capo_id, taglia FROM hr_capo_taglia`;
  return c.json(rows);
});

// Dipendenti con il gilet: nella somma da ordinare non contano gli altri capi
hrVestiarioRoutes.get('/gilet', requireModule('hr'), async (c) => {
  const rows = await db`SELECT id AS employee_id FROM hr_employee WHERE gilet`;
  return c.json(rows.map(r => r.employee_id as number));
});

const capoSchema = z.object({
  nome:   z.string().trim().min(1).max(120),
  colore: z.string().trim().max(60),
});

// Rinomina capo / colore
hrVestiarioRoutes.patch('/capi/:id', requireManage('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const body = await parseBody(c, capoSchema);
  const nome = body.nome.toUpperCase();
  const colore = body.colore.toUpperCase();
  const [dup] = await db`SELECT id FROM hr_capo WHERE nome = ${nome} AND colore = ${colore} AND id <> ${id}`;
  if (dup) throw new HTTPException(409, { message: 'Esiste già un capo con questo nome e colore' });
  const [row] = await db`
    UPDATE hr_capo SET nome = ${nome}, colore = ${colore} WHERE id = ${id}
    RETURNING id, nome, colore
  `;
  if (!row) throw new HTTPException(404, { message: 'Capo non trovato' });
  const user = c.get('user');
  await auditLog({ userId: user.id, username: user.username, action: 'hr.capo.update', entity: 'hr_capo', entityId: id, details: { nome, colore } });
  return c.json(row);
});

// Eliminare un capo toglie anche le taglie assegnate
hrVestiarioRoutes.delete('/capi/:id', requireManage('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [row] = await db`DELETE FROM hr_capo WHERE id = ${id} RETURNING id, nome, colore`;
  if (!row) throw new HTTPException(404, { message: 'Capo non trovato' });
  const user = c.get('user');
  await auditLog({ userId: user.id, username: user.username, action: 'hr.capo.delete', entity: 'hr_capo', entityId: id, details: { nome: row.nome, colore: row.colore } });
  return c.json({ ok: true });
});

const importSchema = z.object({
  apply:  z.boolean().default(false),
  header: z.array(z.string().max(200)).min(2).max(80),
  rows:   z.array(z.array(z.string().max(200)).max(80)).max(3000),
});

// Import da Excel. apply=false → anteprima (nulla viene scritto); apply=true → crea i capi
// mancanti e assegna le taglie. Le celle vuote non toccano le taglie già presenti.
hrVestiarioRoutes.post('/import', requireManage('hr'), async (c) => {
  const body = await parseBody(c, importSchema);
  const employees = await db<EmpLite[]>`SELECT id, nome, cognome, stato FROM hr_employee`;
  const plan = buildImportPlan(body.header, body.rows, employees);
  if (!plan.capi.length && !plan.gilet.length) throw new HTTPException(400, { message: 'Nessuna colonna di capi riconosciuta' });

  const existing = await db<{ id: number; nome: string; colore: string }[]>`SELECT id, nome, colore FROM hr_capo`;
  const idOf = new Map(existing.map(k => [`${normText(k.nome)}|${normText(k.colore)}`, k.id]));
  const capi = plan.capi.map(k => ({ ...k, nuovo: !idOf.has(`${normText(k.nome)}|${normText(k.colore)}`) }));
  const nPerCol = new Map<number, number>();
  for (const a of plan.assegnazioni) nPerCol.set(a.col, (nPerCol.get(a.col) ?? 0) + 1);

  const riepilogo = {
    capi: capi.map(k => ({ nome: k.nome, colore: k.colore, nuovo: k.nuovo, n_taglie: nPerCol.get(k.col) ?? 0 })),
    n_dipendenti: new Set(plan.assegnazioni.map(a => a.employee_id)).size,
    n_taglie: plan.assegnazioni.length,
    gilet_si: plan.gilet.filter(g => g.valore).length,
    gilet_no: plan.gilet.filter(g => !g.valore).length,
    non_trovati: plan.non_trovati,
    avvisi: plan.avvisi,
  };
  if (!body.apply) return c.json({ applicato: false, ...riepilogo });

  await db.begin(async (sql) => {
    const tx = sql as unknown as typeof db;
    const idByCol = new Map<number, number>();
    for (const k of capi) {
      const [row] = await tx`
        INSERT INTO hr_capo (nome, colore) VALUES (${k.nome}, ${k.colore})
        ON CONFLICT (nome, colore) DO UPDATE SET nome = EXCLUDED.nome
        RETURNING id
      `;
      idByCol.set(k.col, row.id);
    }
    for (const g of plan.gilet) {
      await tx`UPDATE hr_employee SET gilet = ${g.valore} WHERE id = ${g.employee_id}`;
    }
    for (const a of plan.assegnazioni) {
      await tx`
        INSERT INTO hr_capo_taglia (employee_id, capo_id, taglia)
        VALUES (${a.employee_id}, ${idByCol.get(a.col)!}, ${a.taglia})
        ON CONFLICT (employee_id, capo_id) DO UPDATE SET taglia = EXCLUDED.taglia, updated_at = NOW()
      `;
    }
  });
  const user = c.get('user');
  await auditLog({
    userId: user.id, username: user.username, action: 'hr.vestiario.import', entity: 'hr_capo', entityId: 0,
    details: { capi: capi.length, nuovi: capi.filter(k => k.nuovo).length, taglie: plan.assegnazioni.length, gilet: plan.gilet.length },
  });
  return c.json({ applicato: true, ...riepilogo });
});
