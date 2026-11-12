'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PortfolioGantt } from './Gantt';
import { daysAgo, daysFromToday, dueLabel, fmtShort, type PendingTicket, type ProjectRow } from '@/lib/progetti';

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-card bg-white px-5 py-4 shadow-card">
      <div className={`text-3xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink-900'}`}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectRow }) {
  const total = p.tasks_total, pct = total ? Math.round((100 * p.tasks_done) / total) : 0;
  const ago = daysAgo(p.last_activity);
  const stale = p.status === 'attivo' && ago != null && ago >= 7;
  const next = p.phases.find(f => f.tasks_total === 0 || f.tasks_done < f.tasks_total);
  const dueDays = p.effective_due ? daysFromToday(p.effective_due) : null;
  return (
    <Link href={`/progetti/${p.id}`} className="flex flex-col gap-3 rounded-card bg-white p-6 shadow-card transition-shadow hover:shadow-float">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink-900">{p.name}</h3>
          <p className="text-xs text-muted">{p.first_ticket ?? 'Nessun ticket'}{p.tickets_count > 1 ? ` +${p.tickets_count - 1}` : ''}</p>
        </div>
        <StatusBadge tone={p.health.tone}>{p.health.label}</StatusBadge>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-accent-ink" style={{ width: `${pct}%` }} /></div>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted">{pct}%</span>
      </div>

      {p.phases.length > 0 && (
        <div>
          <div className="flex gap-[3px]">
            {p.phases.map(f => {
              const fp = f.tasks_total ? Math.round((100 * f.tasks_done) / f.tasks_total) : 0;
              const done = f.tasks_total > 0 && f.tasks_done === f.tasks_total;
              return (
                <i key={f.id} title={`${f.name} · ${f.tasks_done}/${f.tasks_total}`} className="relative block h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                  <b className={`absolute inset-y-0 left-0 ${done ? 'bg-green-600' : 'bg-accent-ink'}`} style={{ width: `${fp}%` }} />
                </i>
              );
            })}
          </div>
          <div className="mt-1 flex gap-[3px] text-[11px] text-muted">
            {p.phases.map(f => <span key={f.id} className="flex-1 truncate">{f.name}</span>)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {p.tasks_blocked > 0 && <StatusBadge tone="danger">{p.tasks_blocked} {p.tasks_blocked > 1 ? 'bloccate' : 'bloccata'}</StatusBadge>}
        {p.tasks_waiting > 0 && <StatusBadge tone="warning">{p.tasks_waiting} in attesa</StatusBadge>}
      </div>

      <div className="text-xs text-muted">
        {next
          ? <>Prossima fase: <b className="font-medium text-ink-900">{next.name}{next.due_date ? ` · ${fmtShort(next.due_date)}` : ''}</b></>
          : p.next_title ? <>Prossima azione: <b className="font-medium text-ink-900">{p.next_title}</b> · {dueLabel(p.next_days)}</> : 'Nessuna prossima azione con data'}
        <br />Scadenza progetto: {p.effective_due ? `${fmtShort(p.effective_due)}${dueDays !== null && dueDays < 0 ? ' (scaduto)' : ''}` : '—'}
      </div>
      <p className={`text-xs ${stale ? 'font-semibold text-warning' : 'text-muted'}`}>
        Ultimo movimento: {ago == null ? '—' : ago === 0 ? 'oggi' : `${ago} giorni fa`}{stale ? ' · fermo' : ''}
      </p>
    </Link>
  );
}

export function ElencoView() {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [pending, setPending] = useState<PendingTicket[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'schede' | 'tempo'>('schede');

  const load = useCallback(() => {
    api.get<ProjectRow[]>('/api/progetti').then(setProjects)
      .catch(e => toast.error(e instanceof Error ? e.message : 'Errore di caricamento'));
    api.get<PendingTicket[]>('/api/progetti/pending-tickets').then(setPending).catch(() => setPending([]));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function create(body: { name: string; ticket_ids?: number[] }) {
    setBusy(true);
    try {
      const p = await api.post<{ id: number }>('/api/progetti', body);
      router.push(`/progetti/${p.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di creazione');
      setBusy(false);
    }
  }

  if (!projects) return <SkeletonTable rows={4} cols={3} />;

  const active = projects.filter(p => p.status === 'attivo');
  const late = active.filter(p => p.health.tone === 'danger').length;
  const attention = active.filter(p => p.health.tone === 'warning').length;
  const stuck = projects.reduce((n, p) => n + p.tasks_blocked + p.tasks_waiting, 0);
  const first = pending[0];
  const pill = (on: boolean) => `rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${on ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-800 hover:bg-stone-50'}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {creating ? (
          <form className="flex w-full max-w-lg gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) create({ name: name.trim() }); }}>
            <input className="input" autoFocus aria-label="Nome del progetto" placeholder="Nome del progetto" value={name} maxLength={200} onChange={e => setName(e.target.value)} />
            <button type="button" className="btn-secondary" onClick={() => { setCreating(false); setName(''); }}>Annulla</button>
            <button type="submit" disabled={busy || !name.trim()} className="btn-primary">Crea</button>
          </form>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>Nuovo progetto</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat n={active.length} label="Progetti attivi" />
        <Stat n={late} label="In ritardo" tone={late ? 'danger' : undefined} />
        <Stat n={attention} label="Con segnali di attenzione" tone={attention ? 'warning' : undefined} />
        <Stat n={stuck} label="Attività bloccate o in attesa" />
      </div>

      {first && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-soft px-5 py-3.5 text-sm font-medium text-warning">
          <span>
            {pending.length} ticket «Progetto nuovo» senza progetto
            <span className="font-normal"> · {first.ticket_number} {first.title}</span>
          </span>
          <button type="button" disabled={busy} className="btn-secondary" onClick={() => create({ name: first.title, ticket_ids: [first.id] })}>
            Crea progetto dal primo
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="card"><EmptyState title="Ancora nessun progetto" hint="Crea un progetto da un ticket «Progetto nuovo», oppure da zero con il pulsante in alto." /></div>
      ) : (
        <>
          <div role="group" aria-label="Vista" className="flex gap-1.5">
            <button type="button" aria-pressed={view === 'schede'} className={pill(view === 'schede')} onClick={() => setView('schede')}>Schede</button>
            <button type="button" aria-pressed={view === 'tempo'} className={pill(view === 'tempo')} onClick={() => setView('tempo')}>Linea del tempo</button>
          </div>
          {view === 'tempo'
            ? <section className="card"><h2 className="mb-3 text-base font-semibold text-ink-900">Linea del tempo dei progetti</h2><PortfolioGantt projects={projects.filter(p => p.status !== 'chiuso')} /></section>
            : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{projects.map(p => <ProjectCard key={p.id} p={p} />)}</div>}
        </>
      )}
    </div>
  );
}
