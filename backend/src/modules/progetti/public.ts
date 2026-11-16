// Parte del progetto che vede chi ha aperto il ticket (pagina di stato):
// - tutti: nome, scadenza, avanzamento generale e SOLO le novità segnate come visibili;
// - IT e collaboratori del progetto (utenti con account): anche le fasi e le attività segnate
//   come visibili (titolo, stato, scadenza, fase, responsabile). Mai note interne né i motivi
//   di blocco/attesa, né attività non segnate.
// L'IT vede esattamente ciò che vede il richiedente («Vedi come richiedente»).
import { db } from '../../db/client.js';
import type { AuthUser } from '../../lib/auth.js';

export interface PublicTask {
  id: number; title: string; status: string; due_date: string | null;
  phase_name: string | null; assigned_name: string | null;
}
export interface PublicPhase {
  id: number; name: string; due_date: string | null; tasks_total: number; tasks_done: number;
}
export type PublicProject = {
  name: string;
  status: string;
  due_date: string | null;
  progress_pct: number;
  news: { body: string; created_at: string }[];
  /** true se chi guarda è IT o collaboratore: solo allora ci sono fasi e attività */
  shared: boolean;
  phases: PublicPhase[];
  tasks: PublicTask[];
};

async function canSeeShared(projectId: number, viewer: AuthUser | null): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  if (viewer.permissions.some(p => p.module_key === 'tickets_it' && p.can_view)) return true;
  const [m] = await db`SELECT 1 AS ok FROM project_members WHERE project_id = ${projectId} AND user_id = ${viewer.id}`;
  return !!m;
}

export async function publicProjectInfo(projectId: number, viewer: AuthUser | null = null): Promise<PublicProject | null> {
  const [p] = await db`
    SELECT name, status,
           COALESCE(to_char(due_date, 'YYYY-MM-DD'),
                    (SELECT to_char(MAX(due_date), 'YYYY-MM-DD') FROM project_phases WHERE project_id = ${projectId})) AS due_date
    FROM projects WHERE id = ${projectId}
  `;
  if (!p) return null;
  const [s] = await db`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'fatta')::int AS done
    FROM project_tasks WHERE project_id = ${projectId}
  `;
  const news = await db`
    SELECT body, created_at FROM project_log
    WHERE project_id = ${projectId} AND visible_to_requester = TRUE AND kind <> 'sistema'
    ORDER BY created_at DESC LIMIT 20
  `;
  const shared = await canSeeShared(projectId, viewer);
  let phases: PublicPhase[] = [];
  let tasks: PublicTask[] = [];
  if (shared) {
    phases = (await db`
      SELECT ph.id, ph.name, to_char(ph.due_date, 'YYYY-MM-DD') AS due_date,
             COUNT(t.id)::int AS tasks_total, (COUNT(t.id) FILTER (WHERE t.status = 'fatta'))::int AS tasks_done
      FROM project_phases ph LEFT JOIN project_tasks t ON t.phase_id = ph.id
      WHERE ph.project_id = ${projectId} GROUP BY ph.id ORDER BY ph.sort_order, ph.id`) as unknown as PublicPhase[];
    tasks = (await db`
      SELECT t.id, t.title, t.status, to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
             ph.name AS phase_name, a.display_name AS assigned_name
      FROM project_tasks t
      LEFT JOIN project_phases ph ON ph.id = t.phase_id
      LEFT JOIN users a ON a.id = t.assigned_to
      WHERE t.project_id = ${projectId} AND t.visible_to_requester = TRUE
      ORDER BY (t.status = 'fatta'), t.due_date NULLS LAST, t.created_at DESC`) as unknown as PublicTask[];
  }
  return {
    name: p.name, status: p.status, due_date: p.due_date,
    progress_pct: s.total ? Math.round((100 * s.done) / s.total) : 0,
    news: news.map((n: any) => ({ body: n.body, created_at: n.created_at })),
    shared, phases, tasks,
  };
}
