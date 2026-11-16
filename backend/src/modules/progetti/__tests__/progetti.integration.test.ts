// Progetti: percorso completo (progetto → ticket → attività → diario → cronologia → pagina di stato).
// Serve PROGETTI_TEST_DATABASE_URL: un DB con TUTTE le migrazioni applicate (come le altre prove di
// integrazione: senza la variabile il file viene saltato). Svuota le tabelle di progetti e di ticket.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';

const URL = process.env.PROGETTI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Progetti (integrazione)', () => {
  let app: Hono;
  let db: typeof import('../../../db/client.js').db;
  let pub: typeof import('../public.js');
  let cookie: Record<string, string> = {};
  let ids: { admin: number; other: number; guest: number; member: number; outsider: number; it: number };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret';
    db = (await import('../../../db/client.js')).db;
    pub = await import('../public.js');
    const { progettiRoutes } = await import('../routes.js');
    const { ticketRoutes } = await import('../../tickets/routes.js');
    const { errorHandler } = await import('../../../middleware/error-handler.js');
    const { signToken, COOKIE_NAME } = await import('../../../lib/auth.js');
    app = new Hono();
    app.route('/api/progetti', progettiRoutes);
    app.route('/api/tickets', ticketRoutes);
    app.onError(errorHandler);

    await db`TRUNCATE project_log, project_tasks, ticket_history, tickets, projects RESTART IDENTITY CASCADE`;
    await db`DELETE FROM users WHERE username LIKE 'prog_%'`;
    const mk = async (username: string, role: string) =>
      (await db`INSERT INTO users (username, password_hash, display_name, role) VALUES (${username}, 'x', ${username}, ${role}::user_role_enum) RETURNING id`)[0].id as number;
    ids = {
      admin: await mk('prog_admin', 'admin'), other: await mk('prog_it2', 'admin'), guest: await mk('prog_guest', 'guest'),
      member: await mk('prog_member', 'operator'), outsider: await mk('prog_outsider', 'operator'), it: await mk('prog_it', 'it'),
    };
    // «it»: IT senza ruolo admin, con il permesso del modulo ticket IT (solo vista)
    await db`INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage) VALUES (${ids.it}, 'tickets_it', TRUE, FALSE)`;
    const roles: Record<string, 'admin' | 'guest' | 'operator' | 'it'> = { guest: 'guest', member: 'operator', outsider: 'operator', it: 'it' };
    for (const [k, v] of Object.entries(ids)) {
      cookie[k] = `${COOKIE_NAME}=${signToken({ id: v, username: `prog_${k}`, display_name: `prog_${k}`, role: roles[k] ?? 'admin' })}`;
    }
  });
  afterAll(async () => {
    await db`TRUNCATE project_log, project_tasks, ticket_history, tickets, projects RESTART IDENTITY CASCADE`;
    await db`DELETE FROM users WHERE username LIKE 'prog_%'`;
    await db?.end();
  });
  beforeEach(async () => {
    await db`TRUNCATE project_log, project_tasks, ticket_history, tickets, projects RESTART IDENTITY CASCADE`;
  });

  const call = (who: keyof typeof ids, method: string, path: string, body?: unknown) =>
    app.request(`/api/progetti${path === '/' ? '' : path.startsWith('/?') ? path.slice(1) : path}`, {
      method,
      headers: { cookie: cookie[who]!, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const json = async (r: Response) => r.json() as Promise<any>;
  async function ticket(n: number, title = 'Telecamere magazzino', category = 'Progetto nuovo', createdBy: number | null = null) {
    const [t] = await db`
      INSERT INTO tickets (ticket_number, year, seq, caller_name, title, description, category, created_by_user_id)
      VALUES (${`#TK-2026-${String(n).padStart(4, '0')}`}, 2026, ${n}, 'Marco', ${title}, 'descrizione lunga abbastanza', ${category}, ${createdBy})
      RETURNING id, ticket_number`;
    await db`INSERT INTO ticket_history (ticket_id, changed_by_name, action, note) VALUES (${t.id}, 'Marco', 'creato', ${title})`;
    return t as { id: number; ticket_number: string };
  }

  it('senza permesso tickets_it risponde 403', async () => {
    expect((await call('guest', 'GET', '/')).status).toBe(403);
  });

  it('crea un progetto da un ticket, lo collega e lo mostra nell\'elenco', async () => {
    const t = await ticket(1);
    const pending = await json(await call('admin', 'GET', '/pending-tickets'));
    expect(pending.map((x: any) => x.id)).toEqual([t.id]);

    const res = await call('admin', 'POST', '/', { name: 'Telecamere', ticket_ids: [t.id] });
    expect(res.status).toBe(201);
    const p = await json(res);

    expect(await json(await call('admin', 'GET', '/pending-tickets'))).toEqual([]);
    const list = await json(await call('admin', 'GET', '/'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.id, tickets_count: 1, tasks_total: 0, first_ticket: t.ticket_number });
    const det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.tickets.map((x: any) => x.id)).toEqual([t.id]);
  });

  it('un ticket sta in un solo progetto: collegarlo a un altro lo sposta e lo scrive nei due diari', async () => {
    const t = await ticket(1);
    const a = await json(await call('admin', 'POST', '/', { name: 'A', ticket_ids: [t.id] }));
    const b = await json(await call('admin', 'POST', '/', { name: 'B' }));
    expect((await call('admin', 'POST', `/${b.id}/tickets`, { ticket_id: t.id })).status).toBe(200);
    expect((await json(await call('admin', 'GET', `/${a.id}`))).tickets).toHaveLength(0);
    expect((await json(await call('admin', 'GET', `/${b.id}`))).tickets).toHaveLength(1);
    const tlA = await json(await call('admin', 'GET', `/${a.id}/timeline`));
    expect(tlA.some((r: any) => r.body?.includes('spostato'))).toBe(true);
    expect((await call('admin', 'POST', `/${b.id}/tickets`, { ticket_id: 99999 })).status).toBe(404);
  });

  it('attività: stato, in attesa con da quanti giorni, riga di sistema nel diario, progresso', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Rete' }));
    const t1 = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'Preventivo', due_date: '2020-01-01' }));
    const t2 = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'Cablaggio' }));
    expect(t1.assigned_to).toBe(ids.admin);                 // di default l'attività è di chi la crea

    const w = await json(await call('admin', 'PATCH', `/tasks/${t1.id}`, { status: 'in_attesa', status_note: 'fornitore X' }));
    expect(w).toMatchObject({ status: 'in_attesa', status_note: 'fornitore X' });
    expect(w.waiting_since).not.toBeNull();

    await call('admin', 'PATCH', `/tasks/${t2.id}`, { status: 'fatta' });
    const det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det).toMatchObject({ tasks_total: 2, tasks_done: 1, progress_pct: 50 });
    expect(det.tasks[0].status).not.toBe('fatta');           // le fatte vanno in fondo

    // uscendo da «in attesa» la nota e waiting_since si azzerano
    const back = await json(await call('admin', 'PATCH', `/tasks/${t1.id}`, { status: 'in_corso' }));
    expect(back).toMatchObject({ status: 'in_corso', status_note: null, waiting_since: null });

    const tl = await json(await call('admin', 'GET', `/${p.id}/timeline`));
    const bodies = tl.map((r: any) => r.body);
    expect(bodies).toContain('Attività «Preventivo» → in attesa (fornitore X)');
    expect(bodies).toContain('Attività «Cablaggio» → fatta');
    expect((await call('admin', 'PATCH', '/tasks/99999', { status: 'fatta' })).status).toBe(404);
  });

  it('Oggi: solo le mie attività (tutte con scope=tutte), senza fatte né progetti chiusi', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'P' }));
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'mia', due_date: '2020-01-01' });
    await call('admin', 'POST', '/tasks', { title: 'libera' });                           // senza progetto
    await call('other', 'POST', '/tasks', { project_id: p.id, title: 'dell\'altro' });
    const done = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'finita' }));
    await call('admin', 'PATCH', `/tasks/${done.id}`, { status: 'fatta' });

    const mine = await json(await call('admin', 'GET', '/oggi'));
    expect(mine.map((r: any) => r.title).sort()).toEqual(['libera', 'mia']);
    expect(mine.find((r: any) => r.title === 'mia').days_to_due).toBeLessThan(0);
    const all = await json(await call('admin', 'GET', '/oggi?scope=tutte'));
    expect(all.map((r: any) => r.title)).toContain('dell\'altro');

    await call('admin', 'PATCH', `/${p.id}`, { status: 'chiuso' });
    expect((await json(await call('admin', 'GET', '/oggi'))).map((r: any) => r.title)).toEqual(['libera']);
    expect(await json(await call('admin', 'GET', '/'))).toHaveLength(0);                   // chiusi nascosti
    expect(await json(await call('admin', 'GET', '/?include_closed=1'))).toHaveLength(1);
  });

  it('cronologia: unisce diario del progetto e storico dei ticket senza duplicarlo', async () => {
    const t = await ticket(1);
    const p = await json(await call('admin', 'POST', '/', { name: 'P', ticket_ids: [t.id] }));
    await db`INSERT INTO ticket_history (ticket_id, changed_by_name, action, old_value, new_value) VALUES (${t.id}, 'IT', 'stato_cambiato', 'aperto', 'in_lavorazione')`;
    await call('admin', 'POST', `/${p.id}/log`, { kind: 'decisione', body: 'Si compra il modello X' });

    const tl = await json(await call('admin', 'GET', `/${p.id}/timeline`));
    const ticketRows = tl.filter((r: any) => r.source === 'ticket');
    expect(ticketRows.map((r: any) => r.ticket_action).sort()).toEqual(['creato', 'stato_cambiato']);
    expect(ticketRows[0].ticket_number).toBe(t.ticket_number);
    expect(tl.find((r: any) => r.kind === 'decisione')).toMatchObject({ source: 'log', body: 'Si compra il modello X', visible: false });
    // lo storico del ticket resta una sola copia: nessuna riga in project_log lo duplica
    const [{ n }] = await db`SELECT COUNT(*)::int AS n FROM project_log WHERE body ILIKE '%in_lavorazione%'`;
    expect(n).toBe(0);
  });

  it('pagina di stato: il richiedente vede solo avanzamento e novità visibili', async () => {
    const t = await ticket(1);
    const p = await json(await call('admin', 'POST', '/', { name: 'Telecamere', due_date: '2026-12-20', ticket_ids: [t.id] }));
    const a = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'segreta interna' }));
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'altra' });
    await call('admin', 'PATCH', `/tasks/${a.id}`, { status: 'fatta' });
    await call('admin', 'POST', `/${p.id}/log`, { kind: 'avanzamento', body: 'Cablaggio verificato', visible_to_requester: true });
    await call('admin', 'POST', `/${p.id}/log`, { kind: 'problema', body: 'Fornitore non risponde' });
    await call('admin', 'POST', `/${p.id}/log`, { kind: 'nota', body: 'nota riservata', visible_to_requester: false });

    const info = await pub.publicProjectInfo(p.id);
    expect(info).toMatchObject({ name: 'Telecamere', due_date: '2026-12-20', progress_pct: 50 });
    expect(info!.news.map(n => n.body)).toEqual(['Cablaggio verificato']);
    expect(JSON.stringify(info)).not.toMatch(/segreta|Fornitore|riservata/);
  });

  it('scollegare un ticket e validazioni', async () => {
    const t = await ticket(1);
    const p = await json(await call('admin', 'POST', '/', { name: 'P', ticket_ids: [t.id] }));
    expect((await call('admin', 'DELETE', `/${p.id}/tickets/${t.id}`)).status).toBe(204);
    expect((await call('admin', 'DELETE', `/${p.id}/tickets/${t.id}`)).status).toBe(404);
    expect((await call('admin', 'POST', '/', { name: '   ' })).status).toBe(400);
    expect((await call('admin', 'POST', '/tasks', { title: 'x', due_date: '5 novembre' })).status).toBe(400);
    expect((await call('admin', 'POST', `/${p.id}/log`, { kind: 'sistema', body: 'x' })).status).toBe(400);
    expect((await call('admin', 'GET', '/99999')).status).toBe(404);
  });

  // ─── Fasi con scadenza (0092) ──────────────────────────────────────────────
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const phase = async (pid: number, name: string, due: number | null) =>
    json(await call('admin', 'POST', `/${pid}/phases`, { name, due_date: due === null ? null : day(due) }));

  it('fasi: ordine, inizio dalla scadenza della precedente, scadenza effettiva e scadenza fissata a mano', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Rete' }));
    const a = await phase(p.id, 'Rilevamento', 5);
    const b = await phase(p.id, 'Installazione', 20);
    expect(a.sort_order).toBe(0);
    expect(b.sort_order).toBe(1);

    let det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.phases.map((x: any) => x.name)).toEqual(['Rilevamento', 'Installazione']);
    expect(det.phases[1].start).toBe(day(5));              // parte quando scade la precedente
    expect(det.effective_due).toBe(day(20));               // dall'ultima fase
    expect(det.due_is_manual).toBe(false);

    await call('admin', 'PATCH', `/${p.id}`, { due_date: day(40) });   // fissata a mano
    det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det).toMatchObject({ effective_due: day(40), due_is_manual: true });
    await call('admin', 'PATCH', `/${p.id}`, { due_date: null });      // torna automatica
    expect((await json(await call('admin', 'GET', `/${p.id}`))).effective_due).toBe(day(20));

    await call('admin', 'PATCH', `/phases/${b.id}`, { due_date: day(30), start_date: day(8) });
    det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.phases[1]).toMatchObject({ due_date: day(30), start: day(8) });
    const tl = await json(await call('admin', 'GET', `/${p.id}/timeline`));
    expect(tl.some((r: any) => r.body?.includes('Fase «Installazione»: scadenza'))).toBe(true);
    expect((await call('admin', 'PATCH', '/phases/99999', { name: 'x' })).status).toBe(404);
    expect((await call('admin', 'POST', `/${p.id}/phases`, { name: ' ' })).status).toBe(400);
  });

  it('attività in una fase: avanzamento per fase, spostamento, fase di un altro progetto rifiutata, eliminare la fase le conserva', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'P1' }));
    const other = await json(await call('admin', 'POST', '/', { name: 'P2' }));
    const f1 = await phase(p.id, 'Fase 1', 5);
    const f2 = await phase(p.id, 'Fase 2', 10);
    const foreign = await phase(other.id, 'Altrove', 5);

    const t1 = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: f1.id, title: 'uno' }));
    const t2 = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: f1.id, title: 'due' }));
    await call('admin', 'PATCH', `/tasks/${t1.id}`, { status: 'fatta' });
    let det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.phases[0]).toMatchObject({ tasks_total: 2, tasks_done: 1 });
    expect(det.phases[1]).toMatchObject({ tasks_total: 0, tasks_done: 0 });

    expect((await call('admin', 'PATCH', `/tasks/${t2.id}`, { phase_id: f2.id })).status).toBe(200);
    det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.tasks.find((t: any) => t.id === t2.id).phase_id).toBe(f2.id);

    expect((await call('admin', 'PATCH', `/tasks/${t2.id}`, { phase_id: foreign.id })).status).toBe(400);
    expect((await call('admin', 'POST', '/tasks', { title: 'libera', phase_id: f1.id })).status).toBe(400);          // senza progetto
    expect((await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: foreign.id, title: 'x' })).status).toBe(400);

    expect((await call('admin', 'DELETE', `/phases/${f2.id}`)).status).toBe(204);
    det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.phases).toHaveLength(1);
    expect(det.tasks.find((t: any) => t.id === t2.id)).toMatchObject({ phase_id: null });   // l'attività resta
  });

  it('semaforo: rosso con attività scaduta o fase scaduta con attività aperte, verde se tutto è in linea', async () => {
    const ok = await json(await call('admin', 'POST', '/', { name: 'Verde' }));
    await call('admin', 'POST', '/tasks', { project_id: ok.id, title: 'ok', due_date: day(5) });
    const late = await json(await call('admin', 'POST', '/', { name: 'Rosso' }));
    await call('admin', 'POST', '/tasks', { project_id: late.id, title: 'tardi', due_date: day(-3) });
    const ph = await json(await call('admin', 'POST', '/', { name: 'Fase scaduta' }));
    const old = await phase(ph.id, 'Vecchia', -4);
    await call('admin', 'POST', '/tasks', { project_id: ph.id, phase_id: old.id, title: 'aperta' });

    const list = await json(await call('admin', 'GET', '/'));
    const by = (n: string) => list.find((x: any) => x.name === n);
    expect(by('Verde').health).toMatchObject({ tone: 'success', label: 'In linea' });
    expect(by('Rosso').health).toMatchObject({ tone: 'danger', label: 'In ritardo' });
    expect(by('Rosso').health.reasons[0]).toContain('«tardi» è in ritardo');
    expect(by('Fase scaduta').health.tone).toBe('danger');
    expect(by('Fase scaduta').phases[0]).toMatchObject({ name: 'Vecchia', tasks_total: 1, tasks_done: 0 });

    // completata la sua unica attività, la fase scaduta non da più segnale
    const t = (await json(await call('admin', 'GET', `/${ph.id}`))).tasks[0];
    await call('admin', 'PATCH', `/tasks/${t.id}`, { status: 'fatta' });
    expect((await json(await call('admin', 'GET', `/${ph.id}`))).health.tone).toBe('success');

    await call('admin', 'PATCH', `/${ok.id}`, { status: 'in_pausa' });
    expect((await json(await call('admin', 'GET', `/${ok.id}`))).health).toMatchObject({ tone: 'neutral', label: 'In pausa' });
  });

  it('ordine: prima le aperte con scadenza, poi quelle senza data (la più recente per prima), in fondo le fatte', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Ordine' }));
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'senza data vecchia' });
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'con data', due_date: day(3) });
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'senza data nuova' });
    const f = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'finita' }));
    await call('admin', 'PATCH', `/tasks/${f.id}`, { status: 'fatta' });
    const det = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det.tasks.map((t: any) => t.title)).toEqual(['con data', 'senza data nuova', 'senza data vecchia', 'finita']);
    expect(det.tasks[0].assigned_name).toBe('prog_admin');
  });

  it('fecha de una fase: las tareas abiertas sin fecha o con fecha posterior se alinean; el resto no se toca', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Alineo' }));
    const f1 = await phase(p.id, 'Fase 1', null);
    const f2 = await phase(p.id, 'Fase 2', null);
    const mk = async (phaseId: number, title: string, due?: number | null) =>
      json(await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: phaseId, title, ...(due === undefined ? {} : { due_date: due === null ? null : day(due) }) }));
    const vacia   = await mk(f1.id, 'vacia');
    const despues = await mk(f1.id, 'despues', 20);
    const antes   = await mk(f1.id, 'antes', 2);
    const igual   = await mk(f1.id, 'igual', 10);
    const hecha   = await mk(f1.id, 'hecha', 25);
    await call('admin', 'PATCH', `/tasks/${hecha.id}`, { status: 'fatta' });
    const otra    = await mk(f2.id, 'otra fase');

    const res = await call('admin', 'PATCH', `/phases/${f1.id}`, { due_date: day(10) });
    expect(res.status).toBe(200);
    expect((await json(res)).tasks_updated).toBe(2);                 // vacia + despues

    const det = await json(await call('admin', 'GET', `/${p.id}`));
    const due = (id: number) => det.tasks.find((t: any) => t.id === id).due_date;
    expect(due(vacia.id)).toBe(day(10));
    expect(due(despues.id)).toBe(day(10));
    expect(due(antes.id)).toBe(day(2));                              // anterior: se queda
    expect(due(igual.id)).toBe(day(10));
    expect(due(hecha.id)).toBe(day(25));                             // hecha: no se toca
    expect(due(otra.id)).toBeNull();                                 // otra fase: no se toca

    const tl = await json(await call('admin', 'GET', `/${p.id}/timeline`));
    expect(tl.some((r: any) => r.body?.includes('2 attività allineate alla stessa data'))).toBe(true);

    // volver a guardar la misma fecha re-alinea solo lo que quedó fuera (más tarde que la fase)
    await call('admin', 'PATCH', `/tasks/${antes.id}`, { due_date: day(15) });
    expect((await json(await call('admin', 'PATCH', `/phases/${f1.id}`, { due_date: day(10) }))).tasks_updated).toBe(1);
    // quitar la fecha o cambiar solo el nombre no mueve nada
    expect((await json(await call('admin', 'PATCH', `/phases/${f1.id}`, { name: 'Fase uno' }))).tasks_updated).toBe(0);
    expect((await json(await call('admin', 'PATCH', `/phases/${f1.id}`, { due_date: null }))).tasks_updated).toBe(0);
    const det2 = await json(await call('admin', 'GET', `/${p.id}`));
    expect(det2.tasks.find((t: any) => t.id === vacia.id).due_date).toBe(day(10));
  });

  it('tarea nueva en una fase con fecha: hereda la fecha, salvo que se indique otra o null', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Herencia' }));
    const f = await phase(p.id, 'Con fecha', 12);
    const sin = await phase(p.id, 'Sin fecha', null);
    const post = async (body: object) => json(await call('admin', 'POST', '/tasks', { project_id: p.id, ...body }));
    expect((await post({ phase_id: f.id, title: 'hereda' })).due_date).toBe(day(12));
    expect((await post({ phase_id: f.id, title: 'propia', due_date: day(3) })).due_date).toBe(day(3));
    expect((await post({ phase_id: f.id, title: 'explicita-null', due_date: null })).due_date).toBeNull();
    expect((await post({ phase_id: sin.id, title: 'fase sin fecha' })).due_date).toBeNull();
    expect((await post({ title: 'sin fase' })).due_date).toBeNull();
  });

  it('fecha de una fase que se mueve: las tareas que tenían la fecha anterior de la fase la acompañan', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Mover fase' }));
    const f = await phase(p.id, 'Fase', 5);
    const mk = async (title: string, due: number | null) =>
      json(await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: f.id, title, due_date: due === null ? null : day(due) }));
    const hereda = await mk('hereda', 5);        // misma fecha que la fase: la acompaña
    const propia = await mk('propia', 3);        // fecha propia anterior: se queda
    const vacia  = await mk('vacia', null);

    // la fase se estira de +5 a +30: solo acompañan la que tenía +5 y la vacía
    const r = await json(await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: day(30) }));
    expect(r.tasks_updated).toBe(2);
    let det = await json(await call('admin', 'GET', `/${p.id}`));
    const due = (id: number) => det.tasks.find((t: any) => t.id === id).due_date;
    expect([due(hereda.id), due(propia.id), due(vacia.id)]).toEqual([day(30), day(3), day(30)]);

    // se corrige a mano en pasos (+3 y después +20): el resultado final sigue la fecha de la fase
    await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: day(3) });
    await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: day(20) });
    det = await json(await call('admin', 'GET', `/${p.id}`));
    expect([due(hereda.id), due(vacia.id)]).toEqual([day(20), day(20)]);
  });

  it('fechas con año no plausible se rechazan (un campo de fecha escrito a mano pasa por 0002)', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Años' }));
    const f = await phase(p.id, 'F', 5);
    expect((await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: '0002-11-30' })).status).toBe(400);
    expect((await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: '2101-01-01' })).status).toBe(400);
    expect((await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'x', due_date: '0020-01-01' })).status).toBe(400);
    expect((await call('admin', 'PATCH', `/${p.id}`, { due_date: '1999-12-31' })).status).toBe(400);
    expect((await call('admin', 'PATCH', `/phases/${f.id}`, { due_date: '2030-06-01' })).status).toBe(200);
  });

  // ─── Collaboratori e attività condivise (0102) ─────────────────────────────
  // Pagina di stato del ticket come la vede chi guarda: anonimo, utente qualsiasi, collaboratore o IT.
  const stato = async (who: keyof typeof ids | null, number: string) => {
    const res = await app.request(`/api/tickets/numero/${number.replace('#', '')}`, { headers: who ? { cookie: cookie[who]! } : {} });
    expect(res.status).toBe(200);
    return json(res);
  };
  const members = async (pid: number) => json(await call('admin', 'GET', `/${pid}/members`));

  it('collaboratori: solo IT li gestisce; account guest non ammesso; si aggiungono, si elencano e si tolgono con audit', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Team' }));
    expect((await call('member', 'GET', `/${p.id}/members`)).status).toBe(403);
    expect((await call('member', 'POST', `/${p.id}/members`, { user_id: ids.member })).status).toBe(403);
    expect((await call('admin', 'POST', `/${p.id}/members`, { user_id: ids.guest })).status).toBe(404);   // account condiviso «guest»
    expect((await call('admin', 'POST', `/${p.id}/members`, { user_id: 999999 })).status).toBe(404);

    expect((await call('admin', 'POST', `/${p.id}/members`, { user_id: ids.member })).status).toBe(201);
    expect((await call('admin', 'POST', `/${p.id}/members`, { user_id: ids.member })).status).toBe(201);   // ripetere non duplica
    const list = await members(p.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ user_id: ids.member, display_name: 'prog_member', source: 'manual' });
    expect(JSON.stringify(list)).not.toContain('password');

    const people = await json(await call('admin', 'GET', '/people'));
    expect(people.some((u: any) => u.id === ids.member)).toBe(true);
    expect(people.some((u: any) => u.id === ids.guest)).toBe(false);                                     // mai l'account guest
    expect(Object.keys(people[0]).sort()).toEqual(['display_name', 'id']);                              // nessuna colonna sensibile

    expect((await call('admin', 'DELETE', `/${p.id}/members/${ids.member}`)).status).toBe(204);
    expect((await call('admin', 'DELETE', `/${p.id}/members/${ids.member}`)).status).toBe(404);
    expect(await members(p.id)).toHaveLength(0);
    const tl = await json(await call('admin', 'GET', `/${p.id}/timeline`));
    expect(tl.some((r: any) => r.body?.includes('aggiunto/a come collaboratore'))).toBe(true);
    expect(tl.some((r: any) => r.body?.includes('rimosso/a dai collaboratori'))).toBe(true);
    const audit = await db`SELECT action FROM audit_log WHERE entity = 'project' AND entity_id = ${String(p.id)} AND action LIKE 'progetti.collaboratore%' ORDER BY id`;
    expect(audit.map((r: any) => r.action)).toEqual(['progetti.collaboratore_aggiunto', 'progetti.collaboratore_aggiunto', 'progetti.collaboratore_rimosso']);
  });

  it('il richiedente di un ticket collegato entra da solo; esce se il ticket si scollega o si sposta; quelli a mano restano', async () => {
    const t = await ticket(1, 'Wi-Fi', 'Rete', ids.member);
    const a = await json(await call('admin', 'POST', '/', { name: 'A', ticket_ids: [t.id] }));
    expect(await members(a.id)).toEqual([expect.objectContaining({ user_id: ids.member, source: 'auto' })]);

    // aggiunto a mano diventa «manual»: non si perde scollegando il ticket
    await call('admin', 'POST', `/${a.id}/members`, { user_id: ids.member });
    await call('admin', 'DELETE', `/${a.id}/tickets/${t.id}`);
    expect(await members(a.id)).toEqual([expect.objectContaining({ user_id: ids.member, source: 'manual' })]);
    await call('admin', 'DELETE', `/${a.id}/members/${ids.member}`);

    // sposta il ticket: il vecchio progetto perde il collaboratore auto, il nuovo lo riceve
    await call('admin', 'POST', `/${a.id}/tickets`, { ticket_id: t.id });
    expect(await members(a.id)).toHaveLength(1);
    const b = await json(await call('admin', 'POST', '/', { name: 'B' }));
    await call('admin', 'POST', `/${b.id}/tickets`, { ticket_id: t.id });
    expect(await members(a.id)).toHaveLength(0);
    expect(await members(b.id)).toEqual([expect.objectContaining({ user_id: ids.member, source: 'auto' })]);

    // un ticket aperto senza account (created_by nullo) non crea collaboratori
    const anon = await ticket(2, 'Senza account', 'Rete', null);
    const c = await json(await call('admin', 'POST', '/', { name: 'C', ticket_ids: [anon.id] }));
    expect(await members(c.id)).toHaveLength(0);
  });

  it('«I miei progetti»: ogni collaboratore vede solo i suoi, senza dettagli interni', async () => {
    const p = await json(await call('admin', 'POST', '/', { name: 'Condiviso' }));
    const other = await json(await call('admin', 'POST', '/', { name: 'Riservato' }));
    await call('admin', 'POST', `/${p.id}/members`, { user_id: ids.member });
    const t = await json(await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'x' }));
    await call('admin', 'PATCH', `/tasks/${t.id}`, { status: 'fatta' });
    await call('admin', 'POST', '/tasks', { project_id: p.id, title: 'y' });

    const mine = await (await app.request('/api/progetti/mine', { headers: { cookie: cookie.member! } })).json() as any[];
    expect(mine.map(x => x.name)).toEqual(['Condiviso']);
    expect(mine[0]).toMatchObject({ progress_pct: 50, tasks_total: 2, tasks_done: 1 });
    expect(Object.keys(mine[0]).sort()).toEqual(['due_date', 'id', 'name', 'progress_pct', 'status', 'tasks_done', 'tasks_total', 'ticket_number']);
    expect(JSON.stringify(mine)).not.toContain('Riservato');
    expect(other.id).toBeGreaterThan(0);
    const outsider = await (await app.request('/api/progetti/mine', { headers: { cookie: cookie.outsider! } })).json();
    expect(outsider).toEqual([]);
    expect((await app.request('/api/progetti/mine')).status).toBe(401);                                  // senza login
    expect((await app.request('/api/progetti', { headers: { cookie: cookie.member! } })).status).toBe(403); // il resto resta solo IT
  });

  it('pagina di stato: fasi e attività visibili solo a IT e collaboratori, e solo quelle segnate; mai note interne', async () => {
    const t = await ticket(1, 'Rete', 'Rete', ids.member);
    const p = await json(await call('admin', 'POST', '/', { name: 'Rete', ticket_ids: [t.id] }));
    const ph = await phase(p.id, 'Installazione', 10);
    const mk = async (body: object) => json(await call('admin', 'POST', '/tasks', { project_id: p.id, phase_id: ph.id, ...body }));
    const shown = await mk({ title: 'Verifica cablaggio', visible_to_requester: true });
    const hidden = await mk({ title: 'SEGRETO interno', status_note: 'x' });
    const blocked = await mk({ title: 'Con motivo', visible_to_requester: true });
    await call('admin', 'PATCH', `/tasks/${blocked.id}`, { status: 'bloccata', status_note: 'MOTIVO riservato' });
    await call('admin', 'POST', `/${p.id}/log`, { kind: 'avanzamento', body: 'Novità visibile', visible_to_requester: true });
    expect(hidden.visible_to_requester).toBe(false);                                                     // default: nulla si espone da solo
    expect(shown.visible_to_requester).toBe(true);

    for (const viewer of [null, 'outsider'] as const) {                                                  // anonimo e utente qualsiasi
      const r = await stato(viewer, t.ticket_number);
      expect(r.project).toMatchObject({ name: 'Rete', shared: false, phases: [], tasks: [] });
      expect(r.project.news.map((n: any) => n.body)).toEqual(['Novità visibile']);
      expect(r.project.due_date).toBe(day(10));                                                          // scadenza dalle fasi
    }
    for (const viewer of ['member', 'admin', 'it'] as const) {                                           // collaboratore, admin, IT non admin
      const r = await stato(viewer, t.ticket_number);
      expect(r.project.shared).toBe(true);
      expect(r.project.phases).toEqual([expect.objectContaining({ name: 'Installazione', tasks_total: 3, tasks_done: 0 })]);
      expect(r.project.tasks.map((x: any) => x.title).sort()).toEqual(['Con motivo', 'Verifica cablaggio']);
      expect(r.project.tasks[0]).toHaveProperty('assigned_name');
      const text = JSON.stringify(r.project);
      expect(text).not.toContain('SEGRETO');
      expect(text).not.toContain('MOTIVO');                                                              // il motivo del blocco è interno
      expect(r.project.tasks.every((x: any) => !('status_note' in x))).toBe(true);
    }
    // segnare e togliere la visibilità si riflette subito
    await call('admin', 'PATCH', `/tasks/${hidden.id}`, { visible_to_requester: true });
    expect((await stato('member', t.ticket_number)).project.tasks).toHaveLength(3);
    await call('admin', 'PATCH', `/tasks/${shown.id}`, { visible_to_requester: false });
    expect((await stato('it', t.ticket_number)).project.tasks.map((x: any) => x.title)).not.toContain('Verifica cablaggio');
    // un ex collaboratore non vede più nulla
    await call('admin', 'DELETE', `/${p.id}/members/${ids.member}`);
    expect((await stato('member', t.ticket_number)).project.shared).toBe(false);
  });
});
