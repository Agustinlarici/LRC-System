'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PHASE_FILL, PHASE_TRACK, PortfolioGantt, phaseTone } from './Gantt';
import { daysAgo, daysFromToday, dueLabel, fmtShort, type PendingTicket, type ProjectRow } from '@/lib/progetti';

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-card bg-white px-5 py-4 shadow-card">
      <div className={`text-3xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink-900'}`}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

// Scheda a tutta larghezza: a sinistra nome e semaforo, al centro le fasi come tappe
// (nome, scadenza e avanzamento), a destra i numeri. Sotto 1024 px le tre zone si impilano.
function ProjectCard({ p }: { p: ProjectRow }) {
  const total = p.tasks_total, pct = total ? Math.round((100 * p.tasks_done) / total) : 0;
  const ago = daysAgo(p.last_activity);
  const stale = p.status === 'attivo' && ago != null && ago >= 7;
  const dueDays = p.effective_due ? daysFromToday(p.effective_due) : null;
  return (
    <Link href={`/progetti/${p.id}`}
      className="grid gap-x-8 gap-y-5 rounded-card bg-white p-6 shadow-card transition-shadow hover:shadow-float lg:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)_minmax(210px,1fr)] lg:items-center">
      {/* Identità */}
      <div className="min-w-0 space-y-2">
        <h3 className="break-words text-lg font-semibold leading-snug text-ink-900">{p.name}</h3>
        <p className="text-xs text-muted">{p.first_ticket ?? 'Nessun ticket'}{p.tickets_count > 1 ? ` +${p.tickets_count - 1}` : ''}</p>
        <StatusBadge tone={p.health.tone}>{p.health.label}</StatusBadge>
      </div>

      {/* Fasi come tappe */}
      {p.phases.length > 0 ? (
        <div className="flex gap-3">
          {p.phases.map(f => {
            const t = phaseTone(f);
            const fp = f.tasks_total ? Math.round((100 * f.tasks_done) / f.tasks_total) : 0;
            return (
              <div key={f.id} className="min-w-0 flex-1" title={`${f.name} · ${f.tasks_done}/${f.tasks_total}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm font-medium ${t === 'fut' ? 'text-muted' : 'text-ink-900'}`}>{f.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{f.tasks_done}/{f.tasks_total}</span>
                </div>
                <div className={`mt-1.5 h-3 overflow-hidden rounded-full ${PHASE_TRACK[t]}`}>
                  <div className={`h-full rounded-full ${PHASE_FILL[t]}`} style={{ width: `${fp}%` }} />
                </div>
                <div className={`mt-1 truncate text-xs ${t === 'bad' ? 'font-semibold text-danger' : 'text-muted'}`}>
                  {t === 'ok' ? 'Completata' : f.due_date ? `${t === 'bad' ? 'scaduta il' : 'scade'} ${fmtShort(f.due_date)}` : 'senza scadenza'}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-accent-ink" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1.5 text-xs text-muted">
            {total === 0 ? 'Nessuna attività' : `${p.tasks_done} di ${total} attività fatte`}
            {p.next_title ? ` · prossima: ${p.next_title} (${dueLabel(p.next_days)})` : ''}
          </p>
        </div>
      )}

      {/* Numeri */}
      <div className="flex flex-col gap-2 lg:border-l lg:border-line lg:pl-6">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-ink-900">{pct}%</span>
          <span className="text-xs text-muted">{p.tasks_done}/{total} attività</span>
        </div>
        <p className="text-xs text-muted">
          Scadenza: <b className="font-medium text-ink-900">{p.effective_due ? fmtShort(p.effective_due) : '—'}</b>
          {dueDays !== null && <span className={dueDays < 0 ? 'font-semibold text-danger' : ''}> · {dueDays < 0 ? `scaduto da ${-dueDays} g` : dueDays === 0 ? 'oggi' : `tra ${dueDays} g`}</span>}
        </p>
        {(p.tasks_blocked > 0 || p.tasks_waiting > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {p.tasks_blocked > 0 && <StatusBadge tone="danger">{p.tasks_blocked} {p.tasks_blocked > 1 ? 'bloccate' : 'bloccata'}</StatusBadge>}
            {p.tasks_waiting > 0 && <StatusBadge tone="warning">{p.tasks_waiting} in attesa</StatusBadge>}
          </div>
        )}
        <p className={`text-xs ${stale ? 'font-semibold text-warning' : 'text-muted'}`}>
          Ultimo movimento: {ago == null ? '—' : ago === 0 ? 'oggi' : `${ago} giorni fa`}{stale ? ' · fermo' : ''}
        </p>
      </div>
    </Link>
  );
}

// Selettore di vista, grande: è la scelta principale della pagina
function ViewToggle({ value, onChange }: { value: 'schede' | 'tempo'; onChange: (v: 'schede' | 'tempo') => void }) {
  const icon = (d: string) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><path d={d} /></svg>
  );
  const opts: { id: 'schede' | 'tempo'; label: string; d: string }[] = [
    { id: 'schede', label: 'Schede', d: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'tempo', label: 'Linea del tempo', d: 'M4 7h9M9 12h11M6 17h8' },
  ];
  return (
    <div role="group" aria-label="Vista" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-white p-1.5 shadow-card">
      {opts.map(o => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-6 sm:py-2.5 sm:text-base ${
            value === o.id ? 'bg-ink-800 text-white' : 'text-muted hover:bg-stone-100 hover:text-ink-900'}`}>
          {icon(o.d)}{o.label}
        </button>
      ))}
    </div>
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {projects.length > 0 ? <ViewToggle value={view} onChange={setView} /> : <span />}
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
        view === 'tempo'
          ? <section className="card"><h2 className="mb-3 text-base font-semibold text-ink-900">Linea del tempo dei progetti</h2><PortfolioGantt projects={projects.filter(p => p.status !== 'chiuso')} /></section>
          : <div className="space-y-4">{projects.map(p => <ProjectCard key={p.id} p={p} />)}</div>
      )}
    </div>
  );
}
