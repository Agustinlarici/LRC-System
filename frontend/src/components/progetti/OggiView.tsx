'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { TaskRow } from './TaskRow';
import { todayISO, type PTask } from '@/lib/progetti';

function Group({ title, tone, tasks, reload }: { title: string; tone?: 'danger' | 'warning'; tasks: PTask[]; reload: () => void }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted';
  return (
    <section className="card">
      <h2 className={`mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider ${color}`}>
        {title}
        <span className="rounded-full bg-stone-100 px-2 text-xs normal-case tracking-normal text-stone-600 tabular-nums">{tasks.length}</span>
      </h2>
      {tasks.length === 0
        ? <p className="py-1.5 text-sm text-muted">Niente qui.</p>
        : tasks.map(t => <TaskRow key={t.id} task={t} showProject onChanged={reload} />)}
    </section>
  );
}

// Oggi: cosa devo fare e cosa è fermo. Ogni attività sta in un solo gruppo
// (bloccate → in attesa → in ritardo → oggi → prossime).
export function OggiView({ onCount }: { onCount?: (late: number) => void }) {
  const toast = useToast();
  const [tasks, setTasks] = useState<PTask[] | null>(null);
  const [scope, setScope] = useState<'mie' | 'tutte'>('mie');
  const [title, setTitle] = useState('');

  const load = useCallback(() => {
    api.get<PTask[]>(`/api/progetti/oggi?scope=${scope}`)
      .then(rows => {
        setTasks(rows);
        onCount?.(rows.filter(t => t.status !== 'bloccata' && t.status !== 'in_attesa' && (t.days_to_due ?? 0) < 0 && t.days_to_due != null).length);
      })
      .catch(e => toast.error(e instanceof Error ? e.message : 'Errore di caricamento'));
  }, [scope, toast, onCount]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle('');   // subito: si può scrivere la successiva mentre questa si salva
    try {
      await api.post('/api/progetti/tasks', { title: t, due_date: todayISO() });
      load();
    } catch (err) {
      setTitle(t);
      toast.error(err instanceof Error ? err.message : 'Errore di salvataggio');
    }
  }

  if (!tasks) return <SkeletonTable rows={5} cols={3} />;

  const blocked = tasks.filter(t => t.status === 'bloccata');
  const waiting = tasks.filter(t => t.status === 'in_attesa').sort((a, b) => (b.waiting_days ?? 0) - (a.waiting_days ?? 0));
  const rest = tasks.filter(t => t.status !== 'bloccata' && t.status !== 'in_attesa');
  const late = rest.filter(t => t.days_to_due != null && t.days_to_due < 0);
  const today = rest.filter(t => t.days_to_due === 0);
  const next = rest.filter(t => t.days_to_due == null || t.days_to_due > 0).slice(0, 8);

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card flex gap-2 !p-4">
        <input className="input" aria-label="Nuova attività" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Nuova attività per oggi… (Invio per aggiungere)" maxLength={300} autoComplete="off" />
        <button type="submit" disabled={!title.trim()} className="btn-primary">Aggiungi</button>
      </form>

      <div className="flex items-center gap-2 text-sm text-muted">
        <span>Mostra:</span>
        {(['mie', 'tutte'] as const).map(s => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
            className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
              scope === s ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-800 hover:bg-stone-50'}`}>
            {s === 'mie' ? 'Le mie' : 'Di tutti'}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="card"><EmptyState title="Nessuna attività aperta" hint="Aggiungi la prima qui sopra, oppure aprila da un progetto." /></div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Group title="In ritardo" tone="danger" tasks={late} reload={load} />
            <Group title="Oggi" tasks={today} reload={load} />
            <Group title="Prossime" tasks={next} reload={load} />
          </div>
          <div className="space-y-4">
            <Group title="In attesa di risposta" tone="warning" tasks={waiting} reload={load} />
            <Group title="Bloccate" tone="danger" tasks={blocked} reload={load} />
          </div>
        </div>
      )}
    </div>
  );
}
