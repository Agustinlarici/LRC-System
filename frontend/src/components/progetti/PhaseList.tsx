'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TaskRow } from './TaskRow';
import { isPlausibleDate, todayISO, type PhaseRow, type Person, type ProjectDetail, type PTask } from '@/lib/progetti';

const field = 'input !w-auto !px-2.5 !py-1 text-[13px]';

function sortTasks(ts: PTask[]): PTask[] {
  // aperte prima; con scadenza prima di quelle senza; senza scadenza: la più recente in alto (il backend le manda già così)
  return [...ts].sort((a, b) =>
    Number(a.status === 'fatta') - Number(b.status === 'fatta') ||
    Number(a.due_date === null) - Number(b.due_date === null) ||
    (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}

interface BlockProps {
  title: string;
  phase?: PhaseRow;
  tasks: PTask[];
  project: ProjectDetail;
  people: Person[];
  reload: () => void;
}

function PhaseBlock({ title, phase, tasks, project, people, reload }: BlockProps) {
  const toast = useToast();
  const [closed, setClosed] = useState(false);
  const [name, setName] = useState(title);
  const [newTask, setNewTask] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const total = tasks.length, done = tasks.filter(t => t.status === 'fatta').length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  const complete = total > 0 && done === total;
  const overdue = !!phase && phase.due_days !== null && phase.due_days < 0 && !complete;

  async function run(fn: () => Promise<unknown>) {
    try { await fn(); reload(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Operazione non riuscita'); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = newTask.trim();
    if (!t) return;
    setNewTask('');   // subito: si può scrivere la successiva mentre questa si salva
    try {
      await api.post('/api/progetti/tasks', { project_id: project.id, phase_id: phase?.id ?? null, title: t });
      reload();
    } catch (err) {
      setNewTask(t);
      toast.error(err instanceof Error ? err.message : 'Errore di salvataggio');
    }
  }

  return (
    <section className="card !px-5 !py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={() => setClosed(c => !c)} aria-label={closed ? 'Apri la fase' : 'Chiudi la fase'} aria-expanded={!closed}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-stone-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className={`h-3.5 w-3.5 transition-transform ${closed ? '-rotate-90' : ''}`} aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {phase ? (
          <input className="min-w-0 flex-1 basis-36 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold text-ink-900 hover:bg-stone-100 focus:border-accent focus:bg-white focus:outline-none"
            aria-label="Nome della fase" value={name} maxLength={200}
            onChange={e => setName(e.target.value)}
            onBlur={() => { const n = name.trim(); if (n && n !== phase.name) run(() => api.patch(`/api/progetti/phases/${phase.id}`, { name: n })); else setName(phase.name); }} />
        ) : (
          <h3 className="min-w-0 flex-1 basis-36 px-1.5 text-base font-semibold text-ink-900">{title}</h3>
        )}
        {complete && <StatusBadge tone="success">Completata</StatusBadge>}
        {overdue && <StatusBadge tone="danger">Scaduta</StatusBadge>}
        <div className="flex min-w-[120px] flex-1 basis-40 items-center gap-2.5">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
            <div className={`h-full rounded-full ${complete ? 'bg-green-600' : 'bg-accent-ink'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted">{done}/{total}</span>
        </div>
        {phase && (
          <label className="flex items-center gap-1.5 text-xs text-muted">Scade
            <input type="date" className={field} value={phase.due_date ?? ''}
              title="Le attività aperte senza data, o con una data successiva, passano a questa scadenza"
              onChange={e => {
                const v = e.target.value;
                if (v && !isPlausibleDate(v)) return;   // data a metà digitazione
                run(async () => {
                  const r = await api.patch<{ tasks_updated?: number }>(`/api/progetti/phases/${phase.id}`, { due_date: v || null });
                  if (r.tasks_updated) toast.success(`${r.tasks_updated} ${r.tasks_updated === 1 ? 'attività allineata' : 'attività allineate'} alla scadenza della fase`);
                });
              }} />
          </label>
        )}
        {phase && (confirmDel
          ? <span className="flex items-center gap-1.5 text-xs">
              <button type="button" className="font-medium text-danger hover:underline" onClick={() => run(() => api.delete(`/api/progetti/phases/${phase.id}`))}>Elimina la fase (le attività restano)</button>
              <button type="button" className="text-muted hover:underline" onClick={() => setConfirmDel(false)}>Annulla</button>
            </span>
          : <button type="button" aria-label="Elimina la fase" title="Elimina la fase" className="rounded-md px-1.5 text-muted hover:bg-stone-100 hover:text-ink-900" onClick={() => setConfirmDel(true)}>×</button>)}
      </div>

      {!closed && (
        <div className="mt-2.5">
          {tasks.length === 0
            ? <p className="py-1.5 text-sm text-muted">Nessuna attività in questa fase.</p>
            : sortTasks(tasks).map(t => <TaskRow key={t.id} task={t} phases={project.phases} people={people} onChanged={reload} />)}
          <form onSubmit={add} className="mt-1.5">
            <input className="input" aria-label={`Aggiungi attività a ${title}`} placeholder={`Aggiungi attività a «${title}»… (Invio)`}
              value={newTask} maxLength={300} onChange={e => setNewTask(e.target.value)} autoComplete="off" />
          </form>
        </div>
      )}
    </section>
  );
}

/** Lista delle attività raggruppate per fase. Un progetto senza fasi si vede come una lista semplice («Attività»). */
export function PhaseList({ project, people, reload }: { project: ProjectDetail; people: Person[]; reload: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [due, setDue] = useState('');

  const loose = project.tasks.filter(t => t.phase_id === null);
  const hasPhases = project.phases.length > 0;

  async function addPhase(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await api.post(`/api/progetti/${project.id}/phases`, { name: n, due_date: due || null });
      setName(''); setDue(''); setAdding(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore di salvataggio');
    }
  }

  return (
    <div className="space-y-4">
      {project.phases.map(ph => (
        <PhaseBlock key={`${ph.id}-${ph.name}-${ph.due_date}`} title={ph.name} phase={ph}
          tasks={project.tasks.filter(t => t.phase_id === ph.id)} project={project} people={people} reload={reload} />
      ))}
      {(!hasPhases || loose.length > 0) && (
        <PhaseBlock title={hasPhases ? 'Senza fase' : 'Attività'} tasks={loose} project={project} people={people} reload={reload} />
      )}
      {adding ? (
        <form onSubmit={addPhase} className="card flex flex-wrap items-center gap-2 !p-4">
          <input className="input !w-auto min-w-[200px] flex-1" autoFocus aria-label="Nome della nuova fase" placeholder="Nome della fase (es. Installazione)"
            value={name} maxLength={200} onChange={e => setName(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-muted">Scade
            <input type="date" className={field} value={due} onChange={e => setDue(e.target.value)} min={todayISO()} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setName(''); setDue(''); }}>Annulla</button>
          <button type="submit" disabled={!name.trim()} className="btn-primary">Aggiungi fase</button>
        </form>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>+ Nuova fase</button>
      )}
    </div>
  );
}
