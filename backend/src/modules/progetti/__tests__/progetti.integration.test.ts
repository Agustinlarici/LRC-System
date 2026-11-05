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
  let ids: { admin: number; other: number; guest: number };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    process.env.JWT_SECRET = 'test-secret';
    db = (await import('../../../db/client.js')).db;
    pub = await import('../public.js');
    const { progettiRoutes } = await import('../routes.js');
    const { errorHandler } = await import('../../../middleware/error-handler.js');
    const { signToken, COOKIE_NAME } = await import('../../../lib/auth.js');
    app = new Hono();
    app.route('/api/progetti', progettiRoutes);
    app.onError(errorHandler);

    await db`TRUNCATE project_log, project_tasks, ticket_history, tickets, projects RESTART IDENTITY CASCADE`;
    await db`DELETE FROM users WHERE username LIKE 'prog_%'`;
    const mk = async (username: string, role: string) =>
      (await db`INSERT INTO users (username, password_hash, display_name, role) VALUES (${username}, 'x', ${username}, ${role}::user_role_enum) RETURNING id`)[0].id as number;
    ids = { admin: await mk('prog_admin', 'admin'), other: await mk('prog_it2', 'admin'), guest: await mk('prog_guest', 'guest') };
    for (const [k, v] of Object.entries(ids)) {
      const role = k === 'guest' ? 'guest' : 'admin';
      cookie[k] = `${COOKIE_NAME}=${signToken({ id: v, username: `prog_${k}`, display_name: `prog_${k}`, role: role as 'admin' | 'guest' })}`;
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
  async function ticket(n: number, title = 'Telecamere magazzino', category = 'Progetto nuovo') {
    const [t] = await db`
      INSERT INTO tickets (ticket_number, year, seq, caller_name, title, description, category)
      VALUES (${`#TK-2026-${String(n).padStart(4, '0')}`}, 2026, ${n}, 'Marco', ${title}, 'descrizione lunga abbastanza', ${category})
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
});
