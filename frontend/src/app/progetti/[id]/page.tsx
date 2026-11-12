'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PhaseList } from '@/components/progetti/PhaseList';
import { Board } from '@/components/progetti/Board';
import { ProjectGantt } from '@/components/progetti/Gantt';
import {
  KIND_LABEL, LOG_KINDS, PROJECT_LABEL, TICKET_ACTION_LABEL, daysFromToday, fmtDate, fmtDateTime, fmtShort,
  type LogKind, type Person, type ProjectDetail, type ProjectStatus, type TicketHit, type TimelineRow,
} from '@/lib/progetti';

const DOT: Record<string, string> = {
  avanzamento: 'bg-green-600', problema: 'bg-red-600', decisione: 'bg-accent', nota: 'bg-stone-400',
};

function ticketLine(r: TimelineRow): string {
  const action = TICKET_ACTION_LABEL[r.ticket_action ?? ''] ?? r.ticket_action ?? '';
  if (r.ticket_action === 'assegnato' && r.new_value) return `${r.ticket_number} · assegnato a ${r.new_value}`;
  if (r.old_value && r.new_value) return `${r.ticket_number} · ${action}: ${r.old_value} → ${r.new_value}`;
  return `${r.ticket_number} · ${action}${r.body ? `: ${r.body}` : ''}`;
}

function Timeline({ rows, onlyVisible }: { rows: TimelineRow[]; onlyVisible?: boolean }) {
  const list = onlyVisible ? rows.filter(r => r.source === 'log' && r.visible) : rows;
  if (list.length === 0) return <p className="py-1 text-sm text-muted">{onlyVisible ? 'Ancora nessuna novità.' : 'Ancora nessun movimento.'}</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {list.map(r => {
        const sys = r.kind === 'sistema' || r.source === 'ticket';
        return (
          <li key={`${r.source}-${r.id}`} className="relative mb-4 ml-4 last:mb-0">
            <span className={`absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${DOT[r.kind] ?? 'bg-stone-300'}`} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-400">
              {!onlyVisible && <span className="font-semibold text-ink-800">{KIND_LABEL[r.kind] ?? r.kind}</span>}
              <span>{fmtDateTime(r.created_at)}</span>
              {r.visible && !onlyVisible && <StatusBadge tone="info">Visibile al richiedente</StatusBadge>}
            </div>
            <p className={`mt-0.5 break-words text-sm ${sys ? 'text-muted' : 'text-ink-800'}`}>
              {r.source === 'ticket' ? ticketLine(r) : r.body}
            </p>
            {r.who && !sys && !onlyVisible && <p className="text-xs text-stone-400">— {r.who}</p>}
          </li>
        );
      })}
    </ol>
  );
}

const TABS = ['lista', 'tabellone', 'tempo'] as const;
type Tab = typeof TABS[number];

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-card bg-white px-5 py-3.5 shadow-card">
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold leading-tight tabular-nums text-ink-900">{children}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function ProgettoPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [asRequester, setAsRequester] = useState(false);
  const [tab, setTab] = useState<Tab>('lista');
  const [kind, setKind] = useState<LogKind>('avanzamento');
  const [logBody, setLogBody] = useState('');
  const [visible, setVisible] = useState(true);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TicketHit[]>([]);

  const load = useCallback(() => {
    api.get<ProjectDetail>(`/api/progetti/${id}`).then(setP).catch(() => setNotFound(true));
    api.get<TimelineRow[]>(`/api/progetti/${id}/timeline`).then(setTimeline).catch(() => setTimeline([]));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Person[]>('/api/tickets/assignable-users').then(setPeople).catch(() => setPeople([])); }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api.get<TicketHit[]>(`/api/progetti/ticket-search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    try { await fn(); if (ok) toast.success(ok); load(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Operazione non riuscita'); return false; }
  };

  if (notFound) return <div className="card"><EmptyState title="Progetto non trovato" action={<Link href="/progetti" className="btn-secondary">← Progetti</Link>} /></div>;
  if (!p) return <SkeletonTable rows={5} cols={3} />;

  const ticketIds = new Set(p.tickets.map(t => t.id));
  const shownHits = q.trim().length >= 2 ? hits.filter(h => !ticketIds.has(h.id)) : [];
  const first = p.tickets[0];
  const blocked = p.tasks.filter(t => t.status === 'bloccata').length;
  const waiting = p.tasks.filter(t => t.status === 'in_attesa').length;
  const dueDays = p.effective_due ? daysFromToday(p.effective_due) : null;

  const header = (
    <PageHeader
      title={p.name}
      back={{ label: 'Progetti', href: '/progetti' }}
      badge={<StatusBadge tone={p.health.tone}>{p.health.label}</StatusBadge>}
      description={`${p.tickets.map(t => t.ticket_number).join(' · ') || 'Nessun ticket collegato'}${p.owner_name ? ` · responsabile ${p.owner_name}` : ''}`}
      actions={
        <>
          <select aria-label="Stato del progetto" className="input !w-auto" value={p.status}
            onChange={e => run(() => api.patch(`/api/progetti/${p.id}`, { status: e.target.value as ProjectStatus }))}>
            {(Object.keys(PROJECT_LABEL) as ProjectStatus[]).map(s => <option key={s} value={s}>{PROJECT_LABEL[s]}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={() => setAsRequester(v => !v)}>
            {asRequester ? '← Vista interna' : 'Vedi come richiedente'}
          </button>
        </>
      }
    />
  );

  // ── Anteprima: cosa vede chi ha aperto il ticket nella pagina di stato ───────
  if (asRequester) {
    return (
      <div>
        {header}
        <div className="mx-auto mb-5 max-w-2xl rounded-card bg-accent-soft px-5 py-3 text-sm font-medium text-accent-ink">
          Così lo vede chi ha aperto il ticket quando controlla lo stato. Vede solo l’avanzamento generale e le novità segnate come visibili. Non vede attività, problemi, note né altri ticket.
        </div>
        <div className="mx-auto max-w-2xl space-y-6">
          {first && (
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-mono text-xl font-bold text-ink-900">{first.ticket_number}</h2>
              </div>
              <p className="mt-2 text-lg text-ink-900">{first.title}</p>
              <p className="mt-1 text-xs text-stone-400">Aperto il {fmtDate(first.created_at)} da {first.caller_name}</p>
            </div>
          )}
          <section className="card">
            <h2 className="mb-3 text-base font-semibold text-ink-900">Progetto</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Nome</dt><dd className="text-ink-900">{p.name}</dd>
              <dt className="text-muted">Scadenza prevista</dt><dd className="text-ink-900">{fmtDate(p.effective_due)}</dd>
              <dt className="text-muted">Avanzamento</dt>
              <dd className="flex items-center gap-3">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full bg-accent-ink" style={{ width: `${p.progress_pct}%` }} /></span>
                <span className="text-xs tabular-nums text-muted">{p.progress_pct}%</span>
              </dd>
            </dl>
          </section>
          <section className="card">
            <h2 className="mb-3 text-base font-semibold text-ink-900">Novità</h2>
            <Timeline rows={timeline} onlyVisible />
          </section>
        </div>
      </div>
    );
  }

  const ticketsCard = (
    <section className="card min-w-0">
      <h2 className="mb-2 text-base font-semibold text-ink-900">Ticket del progetto</h2>
      <ul className="space-y-1.5">
        {p.tickets.map(t => (
          <li key={t.id} className="flex items-center gap-2 text-sm">
            <Link href={`/tickets/stato/${t.ticket_number.replace(/^#/, '')}`} className="min-w-0 flex-1 truncate rounded-full bg-stone-100 px-3 py-1 text-xs text-ink-800 hover:bg-stone-200">
              <span className="font-mono">{t.ticket_number}</span> {t.title}
            </Link>
            <button type="button" aria-label={`Scollega ${t.ticket_number}`} title="Scollega dal progetto"
              className="rounded-full px-2 text-muted hover:bg-stone-100 hover:text-ink-900"
              onClick={() => run(() => api.delete(`/api/progetti/${p.id}/tickets/${t.id}`))}>×</button>
          </li>
        ))}
      </ul>
      <input className="input mt-2" aria-label="Cerca un ticket da aggiungere" placeholder="Aggiungi ticket: numero o titolo…" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
      {shownHits.map(h => (
        <button key={h.id} type="button" className="mt-1 flex w-full items-center gap-2 rounded-ctl px-3 py-1.5 text-left text-sm hover:bg-stone-100"
          onClick={() => run(() => api.post(`/api/progetti/${p.id}/tickets`, { ticket_id: h.id }), 'Ticket aggiunto').then(ok => { if (ok) { setQ(''); setHits([]); } })}>
          <span className="font-mono text-xs text-muted">{h.ticket_number}</span>
          <span className="min-w-0 flex-1 truncate">{h.title}</span>
          {h.project_name && <span className="text-xs text-warning">ora in «{h.project_name}»</span>}
        </button>
      ))}
    </section>
  );

  const logCard = (
    <section className="card min-w-0">
      <h2 className="mb-3 text-base font-semibold text-ink-900">Cronologia</h2>
      <div role="group" aria-label="Tipo di nota" className="mb-2.5 flex flex-wrap gap-1.5">
        {LOG_KINDS.map(k => (
          <button key={k} type="button" aria-pressed={kind === k}
            onClick={() => { setKind(k); setVisible(k === 'avanzamento'); }}
            className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
              kind === k ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-800 hover:bg-stone-50'}`}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <form onSubmit={e => {
        e.preventDefault();
        const body = logBody.trim();
        if (!body) return;
        setLogBody('');
        run(() => api.post(`/api/progetti/${p.id}/log`, { kind, body, visible_to_requester: visible })).then(ok => { if (!ok) setLogBody(body); });
      }}>
        <div className="flex gap-2">
          <input className="input" aria-label="Registro" placeholder="Scrivi cosa è successo in una riga…" maxLength={2000}
            value={logBody} onChange={e => setLogBody(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={!logBody.trim()} className="btn-primary">Salva</button>
        </div>
        <label className="mt-2.5 flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={visible} onChange={e => setVisible(e.target.checked)} />
          Visibile al richiedente
        </label>
      </form>
      <div className="mt-5"><Timeline rows={timeline} /></div>
    </section>
  );

  return (
    <div>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Avanzamento" hint={<span className="flex items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full bg-accent-ink" style={{ width: `${p.progress_pct}%` }} /></span>{p.tasks_done}/{p.tasks_total}</span>}>
          {p.progress_pct}%
        </Stat>
        <Stat label="Scadenza progetto"
          hint={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <input type="date" aria-label="Scadenza del progetto" className="input !w-auto !px-2 !py-0.5 text-xs" value={p.due_date ?? ''}
                onChange={e => run(() => api.patch(`/api/progetti/${p.id}`, { due_date: e.target.value || null }))} />
              {p.due_is_manual
                ? <button type="button" className="text-accent-ink hover:underline" onClick={() => run(() => api.patch(`/api/progetti/${p.id}`, { due_date: null }))}>Torna automatica</button>
                : <span>dall’ultima fase</span>}
            </span>
          }>
          {p.effective_due ? fmtShort(p.effective_due) : '—'}
          {dueDays !== null && <span className="ml-2 text-xs font-normal text-muted">{dueDays < 0 ? `scaduto da ${-dueDays} g` : dueDays === 0 ? 'oggi' : `tra ${dueDays} g`}</span>}
        </Stat>
        <Stat label="Bloccate"><span className={blocked ? 'text-danger' : ''}>{blocked}</span></Stat>
        <Stat label="In attesa di risposta"><span className={waiting ? 'text-warning' : ''}>{waiting}</span></Stat>
      </div>

      {p.health.reasons.length > 0 && (
        <section className="card mb-4 !px-5 !py-3.5">
          <div className="flex items-center gap-2.5 font-semibold text-ink-900"><StatusBadge tone={p.health.tone}>{p.health.label}</StatusBadge>Cosa richiede attenzione</div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink-800">
            {p.health.reasons.map(r => <li key={r}>{r}</li>)}
          </ul>
        </section>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ lista: 'Lista', tabellone: 'Tabellone', tempo: 'Linea del tempo' }} />

      {tab === 'lista' && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
          <PhaseList project={p} people={people} reload={load} />
          <div className="space-y-4">{ticketsCard}{logCard}</div>
        </div>
      )}
      {tab === 'tabellone' && <section className="card"><Board tasks={p.tasks} phases={p.phases} reload={load} /></section>}
      {tab === 'tempo' && <section className="card"><h2 className="mb-3 text-base font-semibold text-ink-900">Linea del tempo</h2><ProjectGantt phases={p.phases} tasks={p.tasks} deadline={p.effective_due} /></section>}
    </div>
  );
}
