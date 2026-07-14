import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { authRoutes, requireIT, requireAdmin } from './auth.js';
import { requireAuth, getOptionalUser, type Env } from '../../lib/auth.js';
import { computeSLADeadlines, slaStatus } from './sla.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import { validateTicketFile } from '../../lib/mime-check.js';

export const ticketRoutes = new Hono<Env>();

// ─── Auth sub-routes (/api/tickets/auth/...) ──────────────────────────────
ticketRoutes.route('/auth', authRoutes);

// ─── Upload directory ─────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? join(process.env.UPLOAD_DIR, 'tickets')
  : join(process.cwd(), 'uploads', 'tickets');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function generateTicketNumber(year: number): Promise<{ number: string; seq: number }> {
  // Use a transaction to get a unique sequential number per year
  const [row] = await db`
    SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM tickets WHERE year = ${year}
  `;
  const seq = row.next_seq;
  const padded = String(seq).padStart(4, '0');
  return { number: `#TK-${year}-${padded}`, seq };
}

function withSLAStatus(ticket: any) {
  const now = new Date();
  return {
    ...ticket,
    sla_response_status:    slaStatus(ticket.sla_response_due    ? new Date(ticket.sla_response_due)    : null, ticket.first_response_at ? new Date(ticket.first_response_at) : null, now),
    sla_resolution_status:  slaStatus(ticket.sla_resolution_due  ? new Date(ticket.sla_resolution_due)  : null, ticket.resolved_at        ? new Date(ticket.resolved_at)        : null, now),
  };
}

// ─── Public: GET categories ───────────────────────────────────────────────

ticketRoutes.get('/categories', async (c) => {
  const rows = await db`SELECT category, subcategory FROM ticket_categories WHERE is_active = TRUE ORDER BY category, subcategory`;
  return c.json(rows);
});

ticketRoutes.get('/departments', async (c) => {
  const rows = await db`SELECT id, name FROM ticket_departments WHERE is_active = TRUE ORDER BY name`;
  return c.json(rows);
});

ticketRoutes.get('/priority-rules', async (c) => {
  try {
    const rows = await db`SELECT category, blocca_lavoro, priority FROM ticket_priority_rules`;
    return c.json(rows);
  } catch { return c.json([]); }
});

// ─── Public: CREATE ticket ────────────────────────────────────────────────

const createTicketSchema = z.object({
  caller_name:   z.string().min(1).max(100),
  caller_email:  z.string().email().optional(),
  caller_phone:  z.string().max(30).optional(),
  department_id: z.number().int().positive().optional(),
  title:         z.string().min(3).max(200),
  description:   z.string().min(10),
  category:      z.string().max(100).optional(),
  subcategory:   z.string().max(100).optional(),
  blocca_lavoro: z.boolean().default(false),
});

ticketRoutes.post('/', async (c) => {
  const contentType = c.req.header('content-type') ?? '';

  let fields: z.infer<typeof createTicketSchema>;
  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const raw: Record<string, any> = {};
    for (const [k, v] of form.entries()) {
      if (k === 'attachment') continue;
      raw[k] = typeof v === 'string' && (v === 'true' || v === 'false') ? v === 'true' : v;
      if (k === 'department_id' && raw[k]) raw[k] = parseInt(raw[k], 10);
    }
    const parsed = createTicketSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') });
    }
    fields = parsed.data;

    const file = form.get('attachment') as File | null;
    if (file && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) throw new HTTPException(400, { message: 'File troppo grande (max 10MB)' });
      const bytes = await file.arrayBuffer();
      const buf   = Buffer.from(bytes);
      validateTicketFile(buf, file.name);
      await mkdir(UPLOAD_DIR, { recursive: true });
      const ext = extname(file.name) || '';
      const filename = `${randomBytes(16).toString('hex')}${ext}`;
      await writeFile(join(UPLOAD_DIR, filename), buf);
      attachmentPath = filename;
      attachmentName = file.name;
    }
  } else {
    const parsed = await parseBody(c, createTicketSchema);
    fields = { ...parsed, blocca_lavoro: parsed.blocca_lavoro ?? false };
  }

  // Determine priority from rules
  let priority = 'media';
  if (fields.category) {
    try {
      const [rule] = await db`
        SELECT priority FROM ticket_priority_rules
        WHERE category = ${fields.category} AND blocca_lavoro = ${fields.blocca_lavoro}
      `;
      if (rule) priority = rule.priority;
    } catch { /* table may not exist in older DB versions, use default */ }
  }

  // Determine if this category/subcategory requires approval before work can start
  let requiresApproval = false;
  if (fields.category) {
    try {
      const [rule] = await db`
        SELECT requires_approval FROM ticket_approval_rules
        WHERE category = ${fields.category} AND subcategory IS NOT DISTINCT FROM ${fields.subcategory ?? null}
      `;
      requiresApproval = rule?.requires_approval ?? false;
    } catch { /* table may not exist in older DB versions, no approval required */ }
  }

  const year = new Date().getFullYear();
  const { number, seq } = await generateTicketNumber(year);

  const createdAt = new Date();
  // While a ticket awaits approval, IT can't work it yet — SLA clock starts at approval instead
  const status = requiresApproval ? 'in_attesa_approvazione' : 'aperto';
  const sla = requiresApproval
    ? { response_due: null, resolution_due: null }
    : await computeSLADeadlines(db, priority, createdAt);

  // Link the ticket to the logged-in account (if any) so they can find it under "I miei ticket"
  const submitter = await getOptionalUser(c);
  const createdByUserId = submitter && submitter.role !== 'guest' ? submitter.id : null;

  const [ticket] = await db`
    INSERT INTO tickets (
      ticket_number, year, seq,
      caller_name, caller_email, caller_phone, department_id,
      title, description, category, subcategory, blocca_lavoro,
      attachment_path, attachment_name,
      priority, status, requires_approval, sla_response_due, sla_resolution_due,
      created_by_user_id
    ) VALUES (
      ${number}, ${year}, ${seq},
      ${fields.caller_name}, ${fields.caller_email ?? null}, ${fields.caller_phone ?? null}, ${fields.department_id ?? null},
      ${fields.title}, ${fields.description}, ${fields.category ?? null}, ${fields.subcategory ?? null}, ${fields.blocca_lavoro},
      ${attachmentPath}, ${attachmentName},
      ${priority}, ${status}, ${requiresApproval}, ${sla.response_due?.toISOString() ?? null}, ${sla.resolution_due?.toISOString() ?? null},
      ${createdByUserId}
    )
    RETURNING *
  `;

  // Log creation in history
  await db`
    INSERT INTO ticket_history (ticket_id, changed_by_name, action, note)
    VALUES (${ticket.id}, ${fields.caller_name}, 'creato', ${fields.title})
  `;

  return c.json({ ticket_number: ticket.ticket_number, id: ticket.id }, 201);
});

// ─── Public: GET ticket by number (status page) ───────────────────────────

ticketRoutes.get('/numero/:number', async (c) => {
  const raw = c.req.param('number');
  // Accept both "TK-2026-0001" and "#TK-2026-0001"
  const number = raw.startsWith('#') ? raw : `#${raw}`;
  const [ticket] = await db`
    SELECT t.*, d.name AS department_name, u.display_name AS assigned_to_name
    FROM tickets t
    LEFT JOIN ticket_departments d ON d.id = t.department_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.ticket_number = ${number}
  `;
  if (!ticket) throw new HTTPException(404, { message: 'Ticket non trovato' });

  const history = await db`
    SELECT action, changed_by_name, old_value, new_value, note, created_at
    FROM ticket_history WHERE ticket_id = ${ticket.id} ORDER BY created_at ASC
  `;

  return c.json({ ...withSLAStatus(ticket), history });
});

// ─── Authenticated: tickets opened by the current user ─────────────────────

ticketRoutes.get('/mine', requireAuth, async (c) => {
  const user = c.get('user');

  const tickets = await db`
    SELECT t.*, d.name AS department_name, u.display_name AS assigned_to_name
    FROM tickets t
    LEFT JOIN ticket_departments d ON d.id = t.department_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.created_by_user_id = ${user.id}
    ORDER BY t.created_at DESC
  `;

  return c.json(tickets.map(withSLAStatus));
});

// ─── IT: daily trend (created vs resolved) ─────────────────────────────────

ticketRoutes.get('/stats/trend', requireIT, async (c) => {
  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '14', 10)));

  const rows = await db`
    SELECT
      day::date AS date,
      COALESCE(created.n, 0)  AS created,
      COALESCE(resolved.n, 0) AS resolved
    FROM generate_series(CURRENT_DATE - (${days - 1} || ' days')::interval, CURRENT_DATE, '1 day') AS day
    LEFT JOIN (
      SELECT created_at::date AS d, COUNT(*) AS n
      FROM tickets
      WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::interval
      GROUP BY 1
    ) created ON created.d = day::date
    LEFT JOIN (
      SELECT resolved_at::date AS d, COUNT(*) AS n
      FROM tickets
      WHERE resolved_at IS NOT NULL AND resolved_at >= CURRENT_DATE - (${days - 1} || ' days')::interval
      GROUP BY 1
    ) resolved ON resolved.d = day::date
    ORDER BY day
  `;

  return c.json(rows.map((r: any) => ({
    date:     r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    created:  Number(r.created),
    resolved: Number(r.resolved),
  })));
});

// ─── IT: list tickets ──────────────────────────────────────────────────────

ticketRoutes.get('/', requireIT, async (c) => {
  const { status, priority, assigned_to, q, page = '1', per_page = '25' } = c.req.query();
  const pageNum    = Math.max(1, parseInt(page, 10));
  const perPageNum = Math.min(100, Math.max(1, parseInt(per_page, 10)));
  const offset     = (pageNum - 1) * perPageNum;

  const statuses = status ? status.split(',').map(s => s.trim()).filter(Boolean) : [];

  const statusFilter =
    statuses.length === 1 ? db`AND t.status = ${statuses[0]}` :
    statuses.length  >  1 ? db`AND t.status = ANY(${statuses})` :
    db``;

  const priorityFilter = priority ? db`AND t.priority = ${priority}` : db``;

  const assignedFilter =
    assigned_to === 'null' ? db`AND t.assigned_to IS NULL` :
    assigned_to            ? db`AND t.assigned_to = ${parseInt(assigned_to, 10)}` :
    db``;

  const searchFilter = q
    ? db`AND (t.title ILIKE ${'%' + q + '%'} OR t.ticket_number ILIKE ${'%' + q + '%'} OR t.caller_name ILIKE ${'%' + q + '%'})`
    : db``;

  const tickets = await db`
    SELECT t.*, d.name AS department_name, u.display_name AS assigned_to_name
    FROM tickets t
    LEFT JOIN ticket_departments d ON d.id = t.department_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE 1=1 ${statusFilter} ${priorityFilter} ${assignedFilter} ${searchFilter}
    ORDER BY t.created_at DESC
    LIMIT ${perPageNum} OFFSET ${offset}
  `;

  const [{ count }] = await db`
    SELECT COUNT(*) AS count FROM tickets t
    WHERE 1=1 ${statusFilter} ${priorityFilter} ${assignedFilter} ${searchFilter}
  `;

  return c.json({ tickets: tickets.map(withSLAStatus), total: parseInt(count, 10), page: pageNum, per_page: perPageNum });
});

// ─── IT: GET single ticket ─────────────────────────────────────────────────

ticketRoutes.get('/:id', requireIT, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [ticket] = await db`
    SELECT t.*, d.name AS department_name, u.display_name AS assigned_to_name
    FROM tickets t
    LEFT JOIN ticket_departments d ON d.id = t.department_id
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.id = ${id}
  `;
  if (!ticket) throw new HTTPException(404, { message: 'Ticket non trovato' });

  const history = await db`
    SELECT h.*, u.display_name AS user_display_name
    FROM ticket_history h
    LEFT JOIN users u ON u.id = h.changed_by_user_id
    WHERE h.ticket_id = ${id} ORDER BY h.created_at ASC
  `;

  return c.json({ ...withSLAStatus(ticket), history });
});

// ─── IT: update ticket (assign, change status/priority, resolve) ──────────

const updateTicketSchema = z.object({
  status:          z.enum(['aperto','in_lavorazione','in_attesa','in_attesa_approvazione','risolto','chiuso','riaperto']).optional(),
  priority:        z.enum(['bassa','media','alta','critica']).optional(),
  assigned_to:     z.number().int().positive().nullable().optional(),
  category:        z.string().max(100).nullable().optional(),
  subcategory:     z.string().max(100).nullable().optional(),
  resolution_note: z.string().optional(),
  note:            z.string().optional(),
});

function categoryLabel(category: string | null, subcategory: string | null): string {
  if (!category) return '—';
  return subcategory ? `${category} / ${subcategory}` : category;
}

ticketRoutes.patch('/:id', requireIT, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, updateTicketSchema);
  const itUser = c.get('user');

  const [ticket] = await db`SELECT * FROM tickets WHERE id = ${id}`;
  if (!ticket) throw new HTTPException(404, { message: 'Ticket non trovato' });

  const updates: Record<string, any> = {};
  const historyEntries: Array<{ action: string; old_value?: string; new_value?: string; note?: string }> = [];

  if (body.status !== undefined && body.status !== ticket.status) {
    const now = new Date().toISOString();
    if (body.status === 'risolto'   && !ticket.resolved_at)      updates.resolved_at      = now;
    if (body.status === 'chiuso'    && !ticket.closed_at)         updates.closed_at        = now;
    if (body.status === 'riaperto') updates.reopen_count = (ticket.reopen_count ?? 0) + 1;
    updates.status = body.status;
    historyEntries.push({ action: 'stato_cambiato', old_value: ticket.status, new_value: body.status });
  }

  if (body.priority !== undefined && body.priority !== ticket.priority) {
    updates.priority = body.priority;
    // Recompute SLA from now
    const sla = await computeSLADeadlines(db, body.priority, new Date());
    updates.sla_response_due   = sla.response_due?.toISOString()   ?? null;
    updates.sla_resolution_due = sla.resolution_due?.toISOString() ?? null;
    historyEntries.push({ action: 'priorita_cambiata', old_value: ticket.priority, new_value: body.priority });
  }

  if (body.assigned_to !== undefined) {
    updates.assigned_to = body.assigned_to;
    historyEntries.push({ action: 'assegnato', new_value: body.assigned_to?.toString() ?? 'nessuno' });
  }

  if (
    (body.category    !== undefined && body.category    !== ticket.category) ||
    (body.subcategory !== undefined && body.subcategory !== ticket.subcategory)
  ) {
    const newCategory    = body.category    !== undefined ? body.category    : ticket.category;
    const newSubcategory = body.subcategory !== undefined ? body.subcategory : ticket.subcategory;
    updates.category    = newCategory;
    updates.subcategory = newSubcategory;
    historyEntries.push({
      action:    'categoria_cambiata',
      old_value: categoryLabel(ticket.category, ticket.subcategory),
      new_value: categoryLabel(newCategory, newSubcategory),
    });
  }

  if (body.resolution_note !== undefined) {
    updates.resolution_note = body.resolution_note;
  }

  // Record first response
  if (!ticket.first_response_at) {
    updates.first_response_at = new Date().toISOString();
  }

  if (body.note) {
    historyEntries.push({ action: 'commentato', note: body.note });
  }

  if (Object.keys(updates).length > 0) {
    await db`UPDATE tickets SET ${db(updates)} WHERE id = ${id}`;
  }

  for (const entry of historyEntries) {
    await db`
      INSERT INTO ticket_history (ticket_id, changed_by_user_id, changed_by_name, action, old_value, new_value, note)
      VALUES (${id}, ${itUser.id}, ${itUser.display_name}, ${entry.action}, ${entry.old_value ?? null}, ${entry.new_value ?? null}, ${entry.note ?? null})
    `;
  }

  const [updated] = await db`SELECT * FROM tickets WHERE id = ${id}`;
  return c.json(withSLAStatus(updated));
});

// ─── IT: approve a ticket pending approval ──────────────────────────────────

ticketRoutes.patch('/:id/approve', requireIT, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const itUser = c.get('user');
  const [ticket] = await db`SELECT * FROM tickets WHERE id = ${id}`;
  if (!ticket) throw new HTTPException(404, { message: 'Ticket non trovato' });
  if (!ticket.requires_approval || ticket.status !== 'in_attesa_approvazione') {
    throw new HTTPException(400, { message: 'Il ticket non è in attesa di approvazione' });
  }

  // Work starts now — SLA clock begins at approval, not at creation
  const approvedAt = new Date();
  const sla = await computeSLADeadlines(db, ticket.priority, approvedAt);

  const [updated] = await db`
    UPDATE tickets SET
      status             = 'aperto',
      approved_by        = ${itUser.id},
      approved_by_name   = ${itUser.display_name},
      approved_at        = ${approvedAt.toISOString()},
      sla_response_due   = ${sla.response_due?.toISOString() ?? null},
      sla_resolution_due = ${sla.resolution_due?.toISOString() ?? null}
    WHERE id = ${id}
    RETURNING *
  `;

  await db`
    INSERT INTO ticket_history (ticket_id, changed_by_user_id, changed_by_name, action, note)
    VALUES (${id}, ${itUser.id}, ${itUser.display_name}, 'approvato', ${'Ticket approvato'})
  `;

  return c.json(withSLAStatus(updated));
});

// ─── IT: serve attachment ──────────────────────────────────────────────────

ticketRoutes.get('/:id/attachment', requireIT, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [ticket] = await db`SELECT attachment_path, attachment_name FROM tickets WHERE id = ${id}`;
  if (!ticket?.attachment_path) throw new HTTPException(404, { message: 'Nessun allegato' });

  const { readFile } = await import('fs/promises');
  const data = await readFile(join(UPLOAD_DIR, ticket.attachment_path));

  c.header('Content-Disposition', `attachment; filename="${ticket.attachment_name ?? 'allegato'}"`);
  return c.body(data);
});

// ─── Admin: categories / departments management ────────────────────────────

ticketRoutes.post('/admin/categories', requireAdmin, async (c) => {
  const body = await parseBody(c, z.object({
    category:            z.string().min(1),
    subcategory:         z.string().optional(),
    // Priorità da assegnare alla categoria se non esiste già una regola (non sovrascrive quella esistente)
    priority_blocca:     z.enum(['bassa', 'media', 'alta', 'critica']).default('alta'),
    priority_non_blocca: z.enum(['bassa', 'media', 'alta', 'critica']).default('media'),
    requires_approval:   z.boolean().default(false),
  }));
  const [row] = await db`
    INSERT INTO ticket_categories (category, subcategory)
    VALUES (${body.category}, ${body.subcategory ?? null})
    ON CONFLICT (category, subcategory) DO UPDATE SET is_active = TRUE
    RETURNING *
  `;
  // Ogni categoria deve sempre avere una regola di priorità (bloccante/non bloccante),
  // altrimenti i ticket in quella categoria ricadono silenziosamente su 'media'. Se la
  // categoria esiste già (es. aggiunta di una sottocategoria), la priorità scelta qui
  // viene ignorata — non sovrascrive quella già configurata.
  const priorityBlocca    = body.priority_blocca    ?? 'alta';
  const priorityNonBlocca = body.priority_non_blocca ?? 'media';
  const requiresApproval  = body.requires_approval   ?? false;
  await db`
    INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority)
    VALUES (${body.category}, TRUE, ${priorityBlocca}), (${body.category}, FALSE, ${priorityNonBlocca})
    ON CONFLICT (category, blocca_lavoro) DO NOTHING
  `;
  // L'approvazione è specifica per la coppia categoria+sottocategoria appena creata/riattivata
  await db`
    INSERT INTO ticket_approval_rules (category, subcategory, requires_approval)
    VALUES (${body.category}, ${body.subcategory ?? null}, ${requiresApproval})
    ON CONFLICT (category, subcategory) DO UPDATE SET requires_approval = ${requiresApproval}
  `;
  return c.json(row, 201);
});

ticketRoutes.post('/admin/departments', requireAdmin, async (c) => {
  const body = await parseBody(c, z.object({ name: z.string().min(1).max(100) }));
  const [row] = await db`
    INSERT INTO ticket_departments (name)
    VALUES (${body.name})
    ON CONFLICT (name) DO UPDATE SET is_active = TRUE
    RETURNING id, name, is_active
  `;
  return c.json(row, 201);
});

ticketRoutes.get('/admin/priority-rules', requireAdmin, async (c) => {
  const rows = await db`SELECT category, blocca_lavoro, priority FROM ticket_priority_rules ORDER BY category, blocca_lavoro`;
  return c.json(rows);
});

ticketRoutes.patch('/admin/priority-rules', requireAdmin, async (c) => {
  const body = await parseBody(c, z.object({
    category:     z.string().min(1),
    blocca_lavoro: z.boolean(),
    priority:     z.enum(['bassa', 'media', 'alta', 'critica']),
  }));
  // Upsert: alcune categorie esistenti da prima di questa funzionalità potrebbero
  // non avere ancora una riga qui — salvare deve funzionare comunque.
  const [row] = await db`
    INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority)
    VALUES (${body.category}, ${body.blocca_lavoro}, ${body.priority})
    ON CONFLICT (category, blocca_lavoro) DO UPDATE SET priority = ${body.priority}
    RETURNING *
  `;
  return c.json(row);
});

// ─── Admin: approval rules (per categoria/sottocategoria) ──────────────────

ticketRoutes.get('/admin/approval-rules', requireAdmin, async (c) => {
  const rows = await db`SELECT category, subcategory, requires_approval FROM ticket_approval_rules ORDER BY category, subcategory NULLS FIRST`;
  return c.json(rows);
});

ticketRoutes.patch('/admin/approval-rules', requireAdmin, async (c) => {
  const body = await parseBody(c, z.object({
    category:          z.string().min(1),
    subcategory:       z.string().nullable(),
    requires_approval: z.boolean(),
  }));
  const [row] = await db`
    INSERT INTO ticket_approval_rules (category, subcategory, requires_approval)
    VALUES (${body.category}, ${body.subcategory}, ${body.requires_approval})
    ON CONFLICT (category, subcategory) DO UPDATE SET requires_approval = ${body.requires_approval}
    RETURNING *
  `;
  return c.json(row);
});

ticketRoutes.get('/admin/sla', requireAdmin, async (c) => {
  const rows = await db`SELECT priority, response_hours, resolution_hours FROM ticket_sla ORDER BY response_hours`;
  return c.json(rows);
});

ticketRoutes.patch('/admin/sla/:priority', requireAdmin, async (c) => {
  const priority = c.req.param('priority') ?? '';
  const body = await parseBody(c, z.object({
    response_hours:   z.number().positive(),
    resolution_hours: z.number().positive(),
  }));
  const [row] = await db`
    UPDATE ticket_sla SET response_hours = ${body.response_hours}, resolution_hours = ${body.resolution_hours}
    WHERE priority = ${priority} RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Priorità non trovata' });
  return c.json(row);
});

ticketRoutes.get('/admin/categories', requireAdmin, async (c) => {
  const rows = await db`SELECT id, category, subcategory, is_active FROM ticket_categories ORDER BY category, subcategory NULLS FIRST`;
  return c.json(rows);
});

ticketRoutes.patch('/admin/categories/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const body = await parseBody(c, z.object({
    is_active:   z.boolean().optional(),
    category:    z.string().min(1).max(100).optional(),
    subcategory: z.string().min(1).max(100).optional(),
  }));
  const updates: Record<string, any> = {};
  if (body.is_active   !== undefined) updates.is_active   = body.is_active;
  if (body.category    !== undefined) updates.category    = body.category;
  if (body.subcategory !== undefined) updates.subcategory = body.subcategory;
  if (!Object.keys(updates).length) throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });

  const [existing] = await db`SELECT category, subcategory FROM ticket_categories WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Categoria non trovata' });

  const [row] = await db`UPDATE ticket_categories SET ${db(updates)} WHERE id = ${id} RETURNING *`;
  if (!row) throw new HTTPException(404, { message: 'Categoria non trovata' });

  // Rinominare categoria/sottocategoria non deve rompere il mapping con le regole di approvazione
  // (chiave esatta categoria+sottocategoria, una riga per riga di ticket_categories)
  if (
    (body.category    !== undefined && body.category    !== existing.category) ||
    (body.subcategory !== undefined && body.subcategory !== existing.subcategory)
  ) {
    await db`
      UPDATE ticket_approval_rules
      SET category = ${row.category}, subcategory = ${row.subcategory}
      WHERE category = ${existing.category} AND subcategory IS NOT DISTINCT FROM ${existing.subcategory}
    `;
  }

  // Rinominare la categoria non deve rompere il mapping con le regole di priorità automatica
  if (body.category !== undefined && body.category !== existing.category) {
    // Garantisce che il nuovo nome abbia sempre regole di priorità (default se non esistevano già)
    await db`
      INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority)
      VALUES (${body.category}, TRUE, 'alta'), (${body.category}, FALSE, 'media')
      ON CONFLICT (category, blocca_lavoro) DO NOTHING
    `;
    // Se nessun'altra sottocategoria usa ancora il nome vecchio, migra le priorità già
    // configurate (invece di lasciarle come regole orfane) e rimuove quelle vecchie
    const [{ count }] = await db`SELECT COUNT(*) AS count FROM ticket_categories WHERE category = ${existing.category}`;
    if (parseInt(count, 10) === 0) {
      const oldRules = await db`SELECT blocca_lavoro, priority FROM ticket_priority_rules WHERE category = ${existing.category}`;
      for (const r of oldRules) {
        await db`
          UPDATE ticket_priority_rules SET priority = ${r.priority}
          WHERE category = ${body.category} AND blocca_lavoro = ${r.blocca_lavoro}
        `;
      }
      await db`DELETE FROM ticket_priority_rules WHERE category = ${existing.category}`;
    }
  }

  return c.json(row);
});

ticketRoutes.delete('/admin/categories/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const [row] = await db`DELETE FROM ticket_categories WHERE id = ${id} RETURNING *`;
  if (!row) throw new HTTPException(404, { message: 'Categoria non trovata' });
  return c.json({ message: 'Categoria eliminata' });
});

ticketRoutes.get('/admin/departments', requireAdmin, async (c) => {
  const rows = await db`SELECT id, name, is_active FROM ticket_departments ORDER BY name`;
  return c.json(rows);
});

ticketRoutes.patch('/admin/departments/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const body = await parseBody(c, z.object({
    is_active: z.boolean().optional(),
    name:      z.string().min(1).max(100).optional(),
  }));
  const updates: Record<string, any> = {};
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.name      !== undefined) updates.name      = body.name;
  if (!Object.keys(updates).length) throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });
  const [row] = await db`UPDATE ticket_departments SET ${db(updates)} WHERE id = ${id} RETURNING id, name, is_active`;
  if (!row) throw new HTTPException(404, { message: 'Reparto non trovato' });
  return c.json(row);
});
