// Parte del progetto che vede chi ha aperto il ticket (pagina di stato pubblica):
// nome, scadenza, avanzamento generale e SOLO le novità segnate come visibili.
// Mai attività, problemi, note interne o altri ticket.
import { db } from '../../db/client.js';

export type PublicProject = {
  name: string;
  status: string;
  due_date: string | null;
  progress_pct: number;
  news: { body: string; created_at: string }[];
};

export async function publicProjectInfo(projectId: number): Promise<PublicProject | null> {
  const [p] = await db`
    SELECT name, status, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM projects WHERE id = ${projectId}
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
  return {
    name: p.name, status: p.status, due_date: p.due_date,
    progress_pct: s.total ? Math.round((100 * s.done) / s.total) : 0,
    news: news.map((n: any) => ({ body: n.body, created_at: n.created_at })),
  };
}
