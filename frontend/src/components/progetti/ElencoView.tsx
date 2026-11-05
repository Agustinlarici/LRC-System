'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PROJECT_LABEL, PROJECT_TONE, daysAgo, dueLabel, fmtDate, type PendingTicket, type ProjectRow } from '@/lib/progetti';

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-card bg-white px-5 py-4 shadow-card">
      <div className="text-3xl font-semibold tabular-nums text-ink-900">{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectRow }) {
  const pct = p.tasks_total ? Math.round((100 * p.tasks_done) / p.tasks_total) : 0;
  const ago = daysAgo(p.last_activity);
  const stale = p.status === 'attivo' && ago != null && ago >= 7;
  return (
    <Link href={`/progetti/${p.id}`} className="flex flex-col gap-3 rounded-card bg-white p-6 shadow-card transition-shadow hover:shadow-float">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-ink-900">{p.name}</h3>
        <p className="text-xs text-muted">
          {p.first_ticket ?? 'Nessun ticket'}{p.tickets_count > 1 ? ` +${p.tickets_count - 1}` : ''}{p.due_date ? ` · scade ${fmtDate(p.due_date)}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-accent-ink" style={{ width: `${pct}%` }} /></div>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted">{p.tasks_done}/{p.tasks_total}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.status !== 'attivo' && <StatusBadge tone={PROJECT_TONE[p.status]}>{PROJECT_LABEL[p.status]}</StatusBadge>}
        {p.tasks_blocked > 0 && <StatusBadge tone="danger">{p.tasks_blocked} {p.tasks_blocked > 1 ? 'bloccate' : 'bloccata'}</StatusBadge>}
        {p.tasks_waiting > 0 && <StatusBadge tone="warning">{p.tasks_waiting} in attesa</StatusBadge>}
        {p.tasks_blocked === 0 && p.tasks_waiting === 0 && p.tasks_total > 0 && <StatusBadge tone="success">Nessun blocco</StatusBadge>}
      </div>
      <div className="text-sm">
        {p.next_title
          ? <>{p.next_title}<span className="block text-xs text-muted">{dueLabel(p.next_days)}</span></>
          : <span className="text-xs text-muted">Nessuna prossima azione con data</span>}
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

  const active = projects.filter(p => p.status === 'attivo').length;
  const blocked = projects.reduce((n, p) => n + p.tasks_blocked, 0);
  const waiting = projects.reduce((n, p) => n + p.tasks_waiting, 0);
  const first = pending[0];

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
        <Stat n={active} label="Progetti attivi" />
        <Stat n={blocked} label="Attività bloccate" />
        <Stat n={waiting} label="In attesa di risposta" />
        <Stat n={projects.filter(p => p.next_days != null && p.next_days >= 0 && p.next_days <= 7).length} label="Con scadenza entro 7 giorni" />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map(p => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
