import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requireModule, requireManage, type Env, type AuthUser } from '../../lib/auth.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';
import { hrAnalyticsRoutes } from './analytics.js';

export const hrRoutes = new Hono<Env>();
hrRoutes.route('/analytics', hrAnalyticsRoutes);

// Eventi che un capo può registrare per il proprio team diretto, senza permesso
// di gestione HR completo — tutto ciò che è strutturale/sensibile (promozioni,
// cambio livello, cambio capo, cessazione, assunzione) resta esclusivo di HR.
const CAPO_ALLOWED_EVENT_TYPES = new Set([
  'malattia', 'maternita_paternita', 'infortunio', 'congedo', 'rientro', 'trasferimento', 'altro',
]);

async function isDirectCapoOf(user: AuthUser, employeeId: number): Promise<boolean> {
  const [row] = await db<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM hr_employee target
      JOIN hr_employee capo ON capo.id = target.capo_id
      WHERE target.id = ${employeeId} AND capo.user_id = ${user.id}
    ) AS ok
  `;
  return row?.ok ?? false;
}

function hasHrManage(user: AuthUser): boolean {
  if (user.role === 'admin') return true;
  return user.permissions.some(p => p.module_key === 'hr' && p.can_manage);
}

function hasSalaryView(user: AuthUser, manage = false): boolean {
  if (user.role === 'admin') return true;
  const perm = user.permissions.find(p => p.module_key === 'hr_salary');
  return manage ? !!perm?.can_manage : !!(perm?.can_view || perm?.can_manage);
}

// ─── Cataloghi (reparto, plant, società contratto) — stessa forma per tutti ───

function mountCatalog(table: 'hr_department' | 'hr_plant' | 'hr_contract_company', label: string) {
  hrRoutes.get(`/${label}`, requireModule('hr'), async (c) => {
    const rows = await db`SELECT id, name, is_active FROM ${db(table)} ORDER BY name`;
    return c.json(rows);
  });

  hrRoutes.post(`/${label}`, requireManage('hr'), async (c) => {
    const body = await parseBody(c, z.object({ name: z.string().min(1).max(150) }));
    try {
      const [row] = await db`
        INSERT INTO ${db(table)} (name) VALUES (${body.name.trim()})
        RETURNING id, name, is_active
      `;
      return c.json(row, 201);
    } catch (err: any) {
      if (err?.code === '23505') throw new HTTPException(409, { message: `Esiste già una voce chiamata "${body.name.trim()}"` });
      throw err;
    }
  });

  hrRoutes.patch(`/${label}/:id`, requireManage('hr'), async (c) => {
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
    const body = await parseBody(c, z.object({
      name: z.string().min(1).max(150).optional(),
      is_active: z.boolean().optional(),
    }));
    if (!Object.keys(body).length) throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });
    const [row] = await db`
      UPDATE ${db(table)} SET ${db(body)} WHERE id = ${id}
      RETURNING id, name, is_active
    `;
    if (!row) throw new HTTPException(404, { message: 'Voce non trovata' });
    return c.json(row);
  });
}

mountCatalog('hr_department', 'departments');
mountCatalog('hr_plant', 'plants');
mountCatalog('hr_contract_company', 'contract-companies');

// ─── Dipendenti — lista + ficha ───────────────────────────────────────────────

const employeeSelect = db`
  SELECT
    e.id, e.matricola, e.nome, e.cognome, e.sesso, e.data_nascita, e.codice_fiscale,
    e.nazionalita, e.email, e.telefono, e.indirizzo,
    e.l68, e.mansione, e.livello, e.categoria, e.tipo_contratto, e.funzione_aziendale,
    e.reparto_id, d.name AS reparto_name,
    e.plant_id, e.plant_ids,
    (SELECT string_agg(pl.name, ', ' ORDER BY pl.name) FROM hr_plant pl WHERE pl.id = ANY(e.plant_ids)) AS plant_name,
    e.contract_company_id, cc.name AS contract_company_name,
    e.capo_id, (capo.nome || ' ' || capo.cognome) AS capo_nome,
    e.user_id, e.data_assunzione, e.data_cessazione, e.stato, e.note,
    e.created_at, e.updated_at,
    ROUND(EXTRACT(EPOCH FROM AGE(COALESCE(e.data_cessazione, now()), e.data_assunzione)) / (365.25*86400))::int AS anzianita_anni,
    CASE WHEN e.data_nascita IS NOT NULL
      THEN EXTRACT(YEAR FROM AGE(COALESCE(e.data_cessazione, now()), e.data_nascita))::int
      ELSE NULL END AS eta,
    (SELECT COUNT(*)::int FROM hr_employee r WHERE r.capo_id = e.id AND r.stato != 'cessato') AS n_riporti
  FROM hr_employee e
  LEFT JOIN hr_department d ON d.id = e.reparto_id
  LEFT JOIN hr_contract_company cc ON cc.id = e.contract_company_id
  LEFT JOIN hr_employee capo ON capo.id = e.capo_id
`;

hrRoutes.get('/employees', requireModule('hr'), async (c) => {
  const { search, reparto_id, stato, capo_id } = c.req.query();

  const searchFilter = search
    ? db`AND (e.nome ILIKE ${'%' + search + '%'} OR e.cognome ILIKE ${'%' + search + '%'} OR e.matricola ILIKE ${'%' + search + '%'})`
    : db``;
  const repartoFilter = reparto_id ? db`AND e.reparto_id = ${parseInt(reparto_id, 10)}` : db``;
  const statoFilter   = stato      ? db`AND e.stato = ${stato}` : db``;
  const capoFilter    = capo_id    ? db`AND e.capo_id = ${parseInt(capo_id, 10)}` : db``;

  const rows = await db`
    ${employeeSelect}
    WHERE 1=1 ${searchFilter} ${repartoFilter} ${statoFilter} ${capoFilter}
    ORDER BY e.cognome, e.nome
  `;
  return c.json(rows);
});

hrRoutes.get('/employees/:id', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [employee] = await db`${employeeSelect} WHERE e.id = ${id}`;
  if (!employee) throw new HTTPException(404, { message: 'Dipendente non trovato' });
  return c.json(employee);
});

// Nomi e cognomi sempre con l'iniziale maiuscola e il resto minuscolo ("DE LUCA" → "De Luca", "D'ANGELO" → "D'Angelo")
const titleCase = (s: string) => s.trim().toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

const employeeFieldsSchema = z.object({
  matricola:            z.string().max(30).optional().nullable(),
  nome:                 z.string().min(1).max(100).transform(titleCase),
  cognome:              z.string().min(1).max(100).transform(titleCase),
  sesso:                z.string().max(10).optional().nullable(),
  data_nascita:         z.string().optional().nullable(),
  codice_fiscale:       z.string().max(20).optional().nullable(),
  nazionalita:          z.string().max(100).optional().nullable(),
  email:                z.string().email().max(150).optional().nullable().or(z.literal('')),
  telefono:             z.string().max(30).optional().nullable(),
  indirizzo:            z.string().max(255).optional().nullable(),
  mansione:             z.string().max(150).optional().nullable(),
  livello:              z.string().max(30).optional().nullable(),
  l68:                  z.boolean().optional(),
  categoria:            z.string().max(50).optional().nullable(),
  tipo_contratto:       z.string().max(50).optional().nullable(),
  funzione_aziendale:   z.string().max(150).optional().nullable(),
  reparto_id:           z.number().int().positive().optional().nullable(),
  plant_ids:            z.array(z.number().int().positive()).max(20).optional(),
  contract_company_id:  z.number().int().positive().optional().nullable(),
  capo_id:              z.number().int().positive().optional().nullable(),
  user_id:              z.number().int().positive().optional().nullable(),
  data_assunzione:      z.string(),
  data_cessazione:      z.string().optional().nullable(),
  stato:                z.enum(['attivo', 'aspettativa', 'malattia', 'maternita_paternita', 'cessato']).optional(),
  note:                 z.string().optional().nullable(),
});

hrRoutes.post('/employees', requireManage('hr'), async (c) => {
  const body = await parseBody(c, employeeFieldsSchema);
  const user = c.get('user');
  const plantFields = body.plant_ids ? { plant_id: body.plant_ids[0] ?? null } : {};

  const [employee] = await db`
    INSERT INTO hr_employee ${db({ ...body, ...plantFields, email: body.email || null })}
    RETURNING id
  `;

  await db`
    INSERT INTO hr_employee_event ${db({
      employee_id: employee.id,
      event_type: 'assunzione',
      event_date: body.data_assunzione,
      to_value: body.mansione ?? null,
      created_by_user_id: user.id,
      created_by_name: user.display_name,
    })}
  `;

  await auditLog({ userId: user.id, username: user.username, action: 'hr.employee.create', entity: 'hr_employee', entityId: employee.id });

  const [full] = await db`${employeeSelect} WHERE e.id = ${employee.id}`;
  return c.json(full, 201);
});

const employeePatchSchema = employeeFieldsSchema.partial();

hrRoutes.patch('/employees/:id', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const user = c.get('user');
  const manage = hasHrManage(user);
  if (!manage && !(await isDirectCapoOf(user, id))) {
    throw new HTTPException(403, { message: 'Permessi insufficienti per modificare questo dipendente' });
  }

  const [existing] = await db`SELECT * FROM hr_employee WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Dipendente non trovato' });

  const body = await parseBody(c, employeePatchSchema);

  // Un capo (senza gestione HR completa) può solo aggiornare note di contatto,
  // non dati strutturali/sensibili — quelli restano esclusivi di HR.
  const CAPO_EDITABLE_FIELDS = new Set(['telefono', 'email', 'indirizzo', 'note']);
  const REQUIRED_FIELDS = new Set(['nome', 'cognome', 'data_assunzione']);
  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!manage && !CAPO_EDITABLE_FIELDS.has(k)) continue;
    // Campo di testo opzionale svuotato dall'utente → NULL, non stringa vuota
    // (altrimenti la ficha mostrerebbe un vuoto invece di "—").
    updates[k] = v === '' && !REQUIRED_FIELDS.has(k) ? null : v;
  }
  if (updates.plant_ids) updates.plant_id = updates.plant_ids[0] ?? null;
  if (!Object.keys(updates).length) throw new HTTPException(400, { message: 'Nessun campo modificabile fornito' });
  if (updates.capo_id === id) throw new HTTPException(400, { message: 'Una persona non può essere capo di se stessa' });
  if (updates.capo_id) {
    // Il nuovo responsabile non può essere un subordinato (diretto o indiretto) di questa persona
    const [cycle] = await db`
      WITH RECURSIVE chain AS (
        SELECT id, capo_id FROM hr_employee WHERE id = ${updates.capo_id}
        UNION
        SELECT e.id, e.capo_id FROM hr_employee e JOIN chain c ON e.id = c.capo_id
      )
      SELECT 1 AS found FROM chain WHERE id = ${id} LIMIT 1
    `;
    if (cycle) throw new HTTPException(400, { message: "Il responsabile scelto dipende già da questa persona: creerebbe un ciclo nell'organigramma" });
  }

  // Traccia nella timeline i cambi strutturali rilevanti prima di applicarli — con
  // nomi leggibili (non gli id grezzi) così la timeline ha senso per chi la legge.
  const events: { event_type: string; from_value: string | null; to_value: string | null }[] = [];
  if (manage) {
    if (updates.reparto_id !== undefined && updates.reparto_id !== existing.reparto_id) {
      const ids = [existing.reparto_id, updates.reparto_id].filter((v): v is number => v != null);
      const names = ids.length
        ? new Map((await db`SELECT id, name FROM hr_department WHERE id = ANY(${ids})`).map((d: any) => [d.id, d.name]))
        : new Map();
      events.push({
        event_type: 'cambio_reparto',
        from_value: existing.reparto_id != null ? names.get(existing.reparto_id) ?? null : null,
        to_value: updates.reparto_id != null ? names.get(updates.reparto_id) ?? null : null,
      });
    }
    if (updates.mansione !== undefined && updates.mansione !== existing.mansione) {
      events.push({ event_type: 'cambio_mansione', from_value: existing.mansione, to_value: updates.mansione });
    }
    if (updates.livello !== undefined && updates.livello !== existing.livello) {
      events.push({ event_type: 'cambio_livello', from_value: existing.livello, to_value: updates.livello });
    }
    if (updates.capo_id !== undefined && updates.capo_id !== existing.capo_id) {
      const ids = [existing.capo_id, updates.capo_id].filter((v): v is number => v != null);
      const names = ids.length
        ? new Map((await db`SELECT id, (nome || ' ' || cognome) AS nome FROM hr_employee WHERE id = ANY(${ids})`).map((e: any) => [e.id, e.nome]))
        : new Map();
      events.push({
        event_type: 'cambio_capo',
        from_value: existing.capo_id != null ? names.get(existing.capo_id) ?? null : null,
        to_value: updates.capo_id != null ? names.get(updates.capo_id) ?? null : null,
      });
    }
    if (updates.stato === 'cessato' && existing.stato !== 'cessato') {
      updates.data_cessazione = updates.data_cessazione || new Date().toISOString().slice(0, 10);
      events.push({ event_type: 'cessazione', from_value: existing.stato, to_value: 'cessato' });
    }
    // Riattivazione: un dipendente che torna da 'cessato' non può restare con una
    // data di cessazione appesa, altrimenti resterebbe uno stato inconsistente.
    if (updates.stato !== undefined && updates.stato !== 'cessato' && existing.stato === 'cessato'
        && !(updates.data_cessazione && updates.data_cessazione > new Date().toISOString().slice(0, 10))) {
      updates.data_cessazione = null;
    }
  }

  updates.updated_at = new Date();
  await db`UPDATE hr_employee SET ${db(updates)} WHERE id = ${id}`;

  for (const ev of events) {
    const eventDate = ev.event_type === 'cessazione' && updates.data_cessazione
      ? updates.data_cessazione
      : new Date().toISOString().slice(0, 10);
    await db`
      INSERT INTO hr_employee_event ${db({
        employee_id: id,
        event_type: ev.event_type,
        event_date: eventDate,
        from_value: ev.from_value,
        to_value: ev.to_value,
        created_by_user_id: user.id,
        created_by_name: user.display_name,
      })}
    `;
  }

  await auditLog({ userId: user.id, username: user.username, action: 'hr.employee.update', entity: 'hr_employee', entityId: id, details: updates });

  const [full] = await db`${employeeSelect} WHERE e.id = ${id}`;
  return c.json(full);
});

// ─── Timeline eventi ──────────────────────────────────────────────────────────

hrRoutes.get('/employees/:id/events', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const rows = await db`
    SELECT id, employee_id, event_type, event_date, end_date, from_value, to_value, note, created_by_name, created_at
    FROM hr_employee_event
    WHERE employee_id = ${id}
    ORDER BY event_date DESC, created_at DESC
  `;
  return c.json(rows);
});

const eventFieldsSchema = z.object({
  event_type: z.enum([
    'assunzione', 'cambio_reparto', 'cambio_mansione', 'cambio_livello', 'cambio_capo',
    'trasferimento', 'promozione', 'cessazione', 'malattia', 'maternita_paternita',
    'infortunio', 'congedo', 'rientro', 'altro',
  ]),
  event_date: z.string(),
  end_date:   z.string().optional().nullable(),
  from_value: z.string().max(255).optional().nullable(),
  to_value:   z.string().max(255).optional().nullable(),
  note:       z.string().optional().nullable(),
});

hrRoutes.post('/employees/:id/events', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const user = c.get('user');
  const manage = hasHrManage(user);
  const body = await parseBody(c, eventFieldsSchema);

  if (!manage) {
    if (!CAPO_ALLOWED_EVENT_TYPES.has(body.event_type)) {
      throw new HTTPException(403, { message: 'Questo tipo di evento richiede i permessi di gestione HR' });
    }
    if (!(await isDirectCapoOf(user, id))) {
      throw new HTTPException(403, { message: 'Puoi registrare eventi solo per il tuo team diretto' });
    }
  }

  const [existing] = await db`SELECT id FROM hr_employee WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Dipendente non trovato' });

  const [event] = await db`
    INSERT INTO hr_employee_event ${db({
      employee_id: id,
      ...body,
      created_by_user_id: user.id,
      created_by_name: user.display_name,
    })}
    RETURNING id, employee_id, event_type, event_date, end_date, from_value, to_value, note, created_by_name, created_at
  `;

  await auditLog({ userId: user.id, username: user.username, action: 'hr.event.create', entity: 'hr_employee_event', entityId: event.id, details: { employee_id: id, event_type: body.event_type } });

  return c.json(event, 201);
});

// ─── Storico retributivo (permesso separato 'hr_salary') ─────────────────────

hrRoutes.get('/employees/:id/salary', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const user = c.get('user');
  if (!hasSalaryView(user)) throw new HTTPException(403, { message: "Accesso ai dati retributivi negato" });

  const rows = await db`
    SELECT id, employee_id, data_decorrenza, livello_retributivo,
           retribuzione_annua_lorda::float8 AS retribuzione_annua_lorda, note, created_at
    FROM hr_employee_salary
    WHERE employee_id = ${id}
    ORDER BY data_decorrenza DESC
  `;
  return c.json(rows);
});

const salaryFieldsSchema = z.object({
  data_decorrenza:           z.string(),
  livello_retributivo:       z.string().max(50).optional().nullable(),
  retribuzione_annua_lorda:  z.number().nonnegative().optional().nullable(),
  note:                      z.string().optional().nullable(),
});

hrRoutes.post('/employees/:id/salary', requireModule('hr'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  const user = c.get('user');
  if (!hasSalaryView(user, true)) throw new HTTPException(403, { message: "Permessi di gestione dati retributivi negati" });

  const [existing] = await db`SELECT id FROM hr_employee WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Dipendente non trovato' });

  const body = await parseBody(c, salaryFieldsSchema);
  const [entry] = await db`
    INSERT INTO hr_employee_salary ${db({ employee_id: id, ...body, created_by_user_id: user.id })}
    RETURNING id, employee_id, data_decorrenza, livello_retributivo,
              retribuzione_annua_lorda::float8 AS retribuzione_annua_lorda, note, created_at
  `;

  await auditLog({ userId: user.id, username: user.username, action: 'hr.salary.create', entity: 'hr_employee_salary', entityId: entry.id, details: { employee_id: id } });

  return c.json(entry, 201);
});

// ─── Organigramma ─────────────────────────────────────────────────────────────

hrRoutes.get('/org-chart', requireModule('hr'), async (c) => {

  const rows = await db`
    SELECT
      e.id, e.nome, e.cognome, e.mansione, NULLIF(TRIM(e.funzione_aziendale), '') AS funzione_aziendale, e.stato, e.capo_id,
      (SELECT COUNT(*)::int FROM hr_employee r WHERE r.capo_id = e.id AND r.stato != 'cessato') AS n_riporti
    FROM hr_employee e
    WHERE e.stato != 'cessato'
    ORDER BY e.cognome, e.nome
  `;
  return c.json(rows);
});
