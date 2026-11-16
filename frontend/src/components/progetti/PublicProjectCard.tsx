'use client';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { TASK_LABEL, TASK_TONE, fmtShort, initials, type PublicProject } from '@/lib/progetti';

// Scheda del progetto nella pagina di stato del ticket. È la stessa per il richiedente e per l'IT
// («Vedi come richiedente»): tutti vedono nome, scadenza, avanzamento e novità visibili; chi è
// collaboratore o IT vede anche le fasi e le attività segnate come visibili.
export function PublicProjectCard({ project, fmt }: { project: PublicProject; fmt: (iso: string) => string }) {
  return (
    <div className="bg-white rounded-card shadow-card p-6 space-y-5">
      <h2 className="font-semibold text-ink-900">Progetto</h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Nome</dt><dd className="text-ink-900">{project.name}</dd>
        {project.due_date && (
          <>
            <dt className="text-muted">Scadenza prevista</dt>
            <dd className="text-ink-900">{new Date(`${project.due_date}T12:00:00Z`).toLocaleDateString('it-IT', { dateStyle: 'medium' })}</dd>
          </>
        )}
        <dt className="text-muted">Avanzamento</dt>
        <dd className="flex items-center gap-3">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
            <span className="block h-full rounded-full bg-accent-ink" style={{ width: `${project.progress_pct}%` }} />
          </span>
          <span className="text-xs tabular-nums text-muted">{project.progress_pct}%</span>
        </dd>
      </dl>

      {project.shared && project.phases.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-ink-900">Fasi</p>
          <ul className="space-y-2.5">
            {project.phases.map(f => {
              const pct = f.tasks_total ? Math.round((100 * f.tasks_done) / f.tasks_total) : 0;
              const done = f.tasks_total > 0 && f.tasks_done === f.tasks_total;
              return (
                <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,2fr)_auto] items-center gap-x-3 text-sm">
                  <span className="truncate text-ink-900">{f.name}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-stone-100">
                    <span className={`block h-full rounded-full ${done ? 'bg-green-600' : 'bg-accent-ink'}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                    {done ? 'Completata' : f.due_date ? `scade ${fmtShort(f.due_date)}` : 'senza scadenza'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {project.shared && (
        <div>
          <p className="mb-2 text-sm font-medium text-ink-900">Attività condivise</p>
          {project.tasks.length === 0 ? (
            <p className="text-sm text-muted">Nessuna attività condivisa per ora.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {project.tasks.map(t => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className={`min-w-0 flex-1 basis-48 break-words ${t.status === 'fatta' ? 'text-stone-400 line-through' : 'text-ink-900'}`}>{t.title}</span>
                  <StatusBadge tone={TASK_TONE[t.status]}>{TASK_LABEL[t.status]}</StatusBadge>
                  {t.phase_name && <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600">{t.phase_name}</span>}
                  {t.due_date && t.status !== 'fatta' && <span className="text-xs tabular-nums text-muted">{fmtShort(t.due_date)}</span>}
                  {t.assigned_name && (
                    <span title={t.assigned_name} className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">
                      {initials(t.assigned_name)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {project.news.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium text-ink-900">Novità</p>
          <ol className="relative ml-2 space-y-4 border-l border-line">
            {project.news.map((n, i) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-accent" />
                <p className="text-xs text-stone-400">{fmt(n.created_at)}</p>
                <p className="whitespace-pre-wrap text-sm text-ink-800">{n.body}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
