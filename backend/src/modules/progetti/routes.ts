// Progetti: livello di gestione progetti sopra i ticket (vedi db/migrations/0082_progetti.sql).
// Un progetto raggruppa ticket esistenti (tickets.project_id) e ha attività e un diario.
// Permesso: lo stesso del team IT (tickets_it) — nessun modulo nuovo.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { requireIT } from '../tickets/auth.js';
import type { Env, AuthUser } from '../../lib/auth.js';

export const progettiRoutes = new Hono<Env>();
progettiRoutes.use('*', requireIT);

type Q = typeof db;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida (AAAA-MM-GG)');
const TASK_STATUS = ['da_fare', 'in_corso', 'in_attesa', 'bloccata', 'fatta'] as const;
const STATUS_LABEL: Record<string, string> = {
  da_fare: 'da fare', in_corso: 'in corso', in_attesa: 'in attesa', bloccata: 'bloccata', fatta: 'fatta',
};
const PROJECT_STATUS_LABEL: Record<string, string> = { attivo: 'attivo', in_pausa: 'in pausa', chiuso: 'chiuso' };

// Colonne attività con la data come stringa AAAA-MM-GG (evita fusi orari lato client)
const TASK_COLS = db`
  t.id, t.project_id, t.ticket_id, t.title, t.status, t.status_note, t.waiting_since, t.assigned_to,
  to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.done_at, t.created_at
`;

function intParam(raw: string | undefined, label = 'ID'): number {
  const n = parseInt(raw ?? '', 10);
  if (isNaN(n)) throw new HTTPException(400, { message: `${label} non valido` });
  return n;
}

async function writeLog(
  q: Q, projectId: number, kind: string, body: string, user: AuthUser | null,
  opts: { taskId?: number | null; visible?: boolean } = {},
) {
  const [row] = await q`
    INSERT INTO project_log (project_id, task_id, kind, body, visible_to_requester, user_id, user_name)
    VALUES (${projectId}, ${opts.taskId ?? null}, ${kind}, ${body}, ${opts.visible ?? false},
            ${user?.id ?? null}, ${user?.display_name ?? null})
    RETURNING id, project_id, task_id, kind, body, visible_to_requester, user_name, created_at
  `;
  await q`UPDATE projects SET updated_at = NOW() WHERE id = ${projectId}`;
  return row;
}

async function loadProject(q: Q, id: number) {
  const [p] = await q`
    SELECT p.id, p.name, p.description, p.status, p.owner_id, u.display_name AS owner_name,
           to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.created_at, p.updated_at, p.closed_at
    FROM projects p LEFT JOIN users u ON u.id = p.owner_id
    WHERE p.id = ${id}
  `;
  if (!p) throw new HTTPException(404, { message: 'Progetto non trovato' });
  return p;
}

// Collega ticket a un progetto (un ticket sta in un solo progetto: se era in un altro, lo sposta
// e lo scrive nel diario di entrambi). I ticket eliminati vengono ignorati.
async function attachTickets(q: Q, projectId: number, ticketIds: number[], user: AuthUser) {
  if (ticketIds.length === 0) return [];
  const found = await q`
    SELECT id, ticket_number, project_id FROM tickets
    WHERE id IN ${q(ticketIds)} AND deleted_at IS NULL
  `;
  for (const t of found) {
    if (t.project_id === projectId) continue;
    if (t.project_id) {
      await writeLog(q, t.project_id, 'sistema', `Ticket ${t.ticket_number} spostato in un altro progetto`, user);
    }
    await q`UPDATE tickets SET project_id = ${projectId} WHERE id = ${t.id}`;
    await writeLog(q, projectId, 'sistema', `Ticket ${t.ticket_number} collegato al progetto`, user);
  }
  return found;
}

// ─── Oggi: attività dell'utente (o di tutti con ?scope=tutte) ───────────────

progettiRoutes.get('/oggi', async (c) => {
  const user = c.get('user');
  const all = c.req.query('scope') === 'tutte';
  const rows = await db`
    SELECT ${TASK_COLS}, p.name AS project_name,
           (t.due_date - CURRENT_DATE)::int AS days_to_due,
           CASE WHEN t.status = 'in_attesa' AND t.waiting_since IS NOT NULL
                THEN (CURRENT_DATE - t.waiting_since::date)::int END AS waiting_days
    FROM project_tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status <> 'fatta'
      AND (p.id IS NULL OR p.status <> 'chiuso')
      ${all ? db`` : db`AND t.assigned_to = ${user.id}`}
    ORDER BY t.due_date NULLS LAST, t.created_at
  `;
  return c.json(rows);
});

// ─── Ticket «Progetto nuovo» ancora senza progetto ──────────────────────────

progettiRoutes.get('/pending-tickets', async (c) => {
  const rows = await db`
    SELECT id, ticket_number, title, category, status, created_at
    FROM tickets
    WHERE project_id IS NULL AND deleted_at IS NULL
      AND category ILIKE '%progett%'
      AND status NOT IN ('risolto', 'chiuso')
    ORDER BY created_at
  `;
  return c.json(rows);
});

// ─── Cerca ticket da collegare ───────────────────────────────────────────────

progettiRoutes.get('/ticket-search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  const rows = await db`
    SELECT t.id, t.ticket_number, t.title, t.status, t.project_id, p.name AS project_name
    FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND (t.ticket_number ILIKE ${like} OR t.title ILIKE ${like})
    ORDER BY t.created_at DESC
    LIMIT 15
  `;
  return c.json(rows);
});

// ─── Attività ─────────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  project_id:  z.number().int().positive().nullable().optional(),
  ticket_id:   z.number().int().positive().nullable().optional(),
  title:       z.string().trim().min(1).max(300),
  due_date:    DATE.nullable().optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
});

progettiRoutes.post('/tasks', async (c) => {
  const body = await parseBody(c, createTaskSchema);
  const user = c.get('user');
  const task = await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    if (body.project_id) await loadProject(q, body.project_id);
    const [created] = await q`
      INSERT INTO project_tasks (project_id, ticket_id, title, due_date, assigned_to, created_by)
      VALUES (${body.project_id ?? null}, ${body.ticket_id ?? null}, ${body.title}, ${body.due_date ?? null},
              ${body.assigned_to ?? user.id}, ${user.id})
      RETURNING id
    `;
    if (body.project_id) {
      await writeLog(q, body.project_id, 'sistema', `Attività «${body.title}» aggiunta`, user, { taskId: created.id });
    }
    const [row] = await q`SELECT ${TASK_COLS} FROM project_tasks t WHERE t.id = ${created.id}`;
    return row;
  });
  return c.json(task, 201);
});

const patchTaskSchema = z.object({
  title:       z.string().trim().min(1).max(300).optional(),
  status:      z.enum(TASK_STATUS).optional(),
  status_note: z.string().trim().max(300).nullable().optional(),
  due_date:    DATE.nullable().optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
});

progettiRoutes.patch('/tasks/:taskId', async (c) => {
  const taskId = intParam(c.req.param('taskId'));
  const body = await parseBody(c, patchTaskSchema);
  const user = c.get('user');

  const row = await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [task] = await q`SELECT * FROM project_tasks WHERE id = ${taskId} FOR UPDATE`;
    if (!task) throw new HTTPException(404, { message: 'Attività non trovata' });

    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
    if (body.status_note !== undefined) updates.status_note = body.status_note || null;

    const newStatus = body.status ?? task.status;
    const statusChanged = newStatus !== task.status;
    if (statusChanged) {
      updates.status = newStatus;
      updates.done_at = newStatus === 'fatta' ? new Date() : null;
      updates.waiting_since = newStatus === 'in_attesa' ? new Date() : null;
      // La nota ha senso solo mentre l'attività è in attesa o bloccata
      if (newStatus !== 'in_attesa' && newStatus !== 'bloccata' && body.status_note === undefined) {
        updates.status_note = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      await q`UPDATE project_tasks SET ${q(updates)} WHERE id = ${taskId}`;
    }

    if (statusChanged && task.project_id) {
      const note = (updates.status_note ?? (body.status_note === undefined ? task.status_note : null)) as string | null;
      const suffix = (newStatus === 'in_attesa' || newStatus === 'bloccata') && note ? ` (${note})` : '';
      await writeLog(q, task.project_id, 'sistema',
        `Attività «${body.title ?? task.title}» → ${STATUS_LABEL[newStatus]}${suffix}`, user, { taskId });
    }

    const [out] = await q`SELECT ${TASK_COLS} FROM project_tasks t WHERE t.id = ${taskId}`;
    return out;
  });
  return c.json(row);
});

progettiRoutes.delete('/tasks/:taskId', async (c) => {
  const taskId = intParam(c.req.param('taskId'));
  const user = c.get('user');
  await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [task] = await q`DELETE FROM project_tasks WHERE id = ${taskId} RETURNING project_id, title`;
    if (!task) throw new HTTPException(404, { message: 'Attività non trovata' });
    if (task.project_id) await writeLog(q, task.project_id, 'sistema', `Attività «${task.title}» eliminata`, user);
  });
  return c.body(null, 204);
});

// ─── Progetti: elenco ─────────────────────────────────────────────────────────

progettiRoutes.get('/', async (c) => {
  const includeClosed = c.req.query('include_closed') === '1';
  const rows = await db`
    SELECT p.id, p.name, p.status, to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.owner_id,
           u.display_name AS owner_name,
           COALESCE(ts.total, 0)::int AS tasks_total, COALESCE(ts.done, 0)::int AS tasks_done,
           COALESCE(ts.blocked, 0)::int AS tasks_blocked, COALESCE(ts.waiting, 0)::int AS tasks_waiting,
           lg.last_activity,
           nx.title AS next_title, to_char(nx.due_date, 'YYYY-MM-DD') AS next_due,
           (nx.due_date - CURRENT_DATE)::int AS next_days,
           COALESCE(tk.n, 0)::int AS tickets_count, tk.first_ticket
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'fatta')     AS done,
             COUNT(*) FILTER (WHERE status = 'bloccata')  AS blocked,
             COUNT(*) FILTER (WHERE status = 'in_attesa') AS waiting
      FROM project_tasks GROUP BY project_id
    ) ts ON ts.project_id = p.id
    LEFT JOIN (SELECT project_id, MAX(created_at) AS last_activity FROM project_log GROUP BY project_id) lg
           ON lg.project_id = p.id
    LEFT JOIN LATERAL (
      SELECT title, due_date FROM project_tasks t
      WHERE t.project_id = p.id AND t.status <> 'fatta' AND t.due_date IS NOT NULL
      ORDER BY t.due_date LIMIT 1
    ) nx ON TRUE
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS n, MIN(ticket_number) AS first_ticket
      FROM tickets WHERE deleted_at IS NULL AND project_id IS NOT NULL GROUP BY project_id
    ) tk ON tk.project_id = p.id
    WHERE ${includeClosed ? db`TRUE` : db`p.status <> 'chiuso'`}
    ORDER BY (p.status = 'attivo') DESC, COALESCE(lg.last_activity, p.created_at) DESC
  `;
  return c.json(rows);
});

const createProjectSchema = z.object({
  name:        z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  due_date:    DATE.nullable().optional(),
  ticket_ids:  z.array(z.number().int().positive()).max(20).optional(),
});

progettiRoutes.post('/', async (c) => {
  const body = await parseBody(c, createProjectSchema);
  const user = c.get('user');
  const id = await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [p] = await q`
      INSERT INTO projects (name, description, due_date, owner_id, created_by)
      VALUES (${body.name}, ${body.description ?? null}, ${body.due_date ?? null}, ${user.id}, ${user.id})
      RETURNING id
    `;
    await writeLog(q, p.id, 'sistema', 'Progetto creato', user);
    await attachTickets(q, p.id, body.ticket_ids ?? [], user);
    return p.id as number;
  });
  return c.json(await loadProject(db, id), 201);
});

// ─── Progetto: dettaglio ──────────────────────────────────────────────────────

progettiRoutes.get('/:id', async (c) => {
  const id = intParam(c.req.param('id'));
  const project = await loadProject(db, id);
  const [tasks, tickets] = await Promise.all([
    db`
      SELECT ${TASK_COLS},
             (t.due_date - CURRENT_DATE)::int AS days_to_due,
             CASE WHEN t.status = 'in_attesa' AND t.waiting_since IS NOT NULL
                  THEN (CURRENT_DATE - t.waiting_since::date)::int END AS waiting_days
      FROM project_tasks t
      WHERE t.project_id = ${id}
      ORDER BY (t.status = 'fatta'), t.due_date NULLS LAST, t.created_at
    `,
    db`
      SELECT id, ticket_number, title, status, priority, caller_name, created_at
      FROM tickets WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY created_at
    `,
  ]);
  const done = tasks.filter((t: any) => t.status === 'fatta').length;
  return c.json({
    ...project, tasks, tickets,
    tasks_total: tasks.length, tasks_done: done,
    progress_pct: tasks.length ? Math.round((100 * done) / tasks.length) : 0,
  });
});

const patchProjectSchema = z.object({
  name:        z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status:      z.enum(['attivo', 'in_pausa', 'chiuso']).optional(),
  due_date:    DATE.nullable().optional(),
  owner_id:    z.number().int().positive().nullable().optional(),
});

progettiRoutes.patch('/:id', async (c) => {
  const id = intParam(c.req.param('id'));
  const body = await parseBody(c, patchProjectSchema);
  const user = c.get('user');
  await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [cur] = await q`SELECT status FROM projects WHERE id = ${id} FOR UPDATE`;
    if (!cur) throw new HTTPException(404, { message: 'Progetto non trovato' });
    const updates: Record<string, unknown> = { ...body };
    if (body.status !== undefined && body.status !== cur.status) {
      updates.closed_at = body.status === 'chiuso' ? new Date() : null;
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date();
      await q`UPDATE projects SET ${q(updates)} WHERE id = ${id}`;
    }
    if (body.status !== undefined && body.status !== cur.status) {
      await writeLog(q, id, 'sistema', `Progetto → ${PROJECT_STATUS_LABEL[body.status]}`, user);
    }
  });
  return c.json(await loadProject(db, id));
});

// ─── Cronologia: diario del progetto + storico dei ticket collegati (letto, non copiato) ───

progettiRoutes.get('/:id/timeline', async (c) => {
  const id = intParam(c.req.param('id'));
  await loadProject(db, id);
  const rows = await db`
    SELECT * FROM (
      SELECT 'log'::text AS source, l.id, l.kind::text AS kind, l.body, l.visible_to_requester AS visible,
             l.user_name AS who, l.created_at,
             NULL::text AS ticket_number, NULL::text AS ticket_action, NULL::text AS old_value, NULL::text AS new_value
      FROM project_log l WHERE l.project_id = ${id}
      UNION ALL
      SELECT 'ticket'::text, h.id, 'ticket'::text, h.note, FALSE,
             h.changed_by_name, h.created_at,
             t.ticket_number::text, h.action::text, h.old_value, h.new_value
      FROM ticket_history h JOIN tickets t ON t.id = h.ticket_id
      WHERE t.project_id = ${id} AND t.deleted_at IS NULL
    ) x
    ORDER BY created_at DESC, source, id DESC
    LIMIT 500
  `;
  return c.json(rows);
});

const logSchema = z.object({
  kind:                 z.enum(['avanzamento', 'problema', 'decisione', 'nota']),
  body:                 z.string().trim().min(1).max(2000),
  visible_to_requester: z.boolean().optional(),
  task_id:              z.number().int().positive().nullable().optional(),
});

progettiRoutes.post('/:id/log', async (c) => {
  const id = intParam(c.req.param('id'));
  const body = await parseBody(c, logSchema);
  const user = c.get('user');
  await loadProject(db, id);
  const row = await writeLog(db, id, body.kind, body.body, user, {
    taskId: body.task_id ?? null, visible: body.visible_to_requester ?? false,
  });
  return c.json(row, 201);
});

// ─── Ticket del progetto ──────────────────────────────────────────────────────

progettiRoutes.post('/:id/tickets', async (c) => {
  const id = intParam(c.req.param('id'));
  const { ticket_id } = await parseBody(c, z.object({ ticket_id: z.number().int().positive() }));
  const user = c.get('user');
  await loadProject(db, id);
  const found = await db.begin(async (tx) => attachTickets(tx as unknown as Q, id, [ticket_id], user));
  if (found.length === 0) throw new HTTPException(404, { message: 'Ticket non trovato' });
  return c.json({ ok: true });
});

progettiRoutes.delete('/:id/tickets/:ticketId', async (c) => {
  const id = intParam(c.req.param('id'));
  const ticketId = intParam(c.req.param('ticketId'), 'ID ticket');
  const user = c.get('user');
  await db.begin(async (tx) => {
    const q = tx as unknown as Q;
    const [t] = await q`
      UPDATE tickets SET project_id = NULL WHERE id = ${ticketId} AND project_id = ${id}
      RETURNING ticket_number
    `;
    if (!t) throw new HTTPException(404, { message: 'Ticket non collegato a questo progetto' });
    await writeLog(q, id, 'sistema', `Ticket ${t.ticket_number} scollegato dal progetto`, user);
  });
  return c.body(null, 204);
});
