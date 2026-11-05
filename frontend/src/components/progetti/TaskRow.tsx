'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TASK_LABEL, TASK_TONE, dueLabel, type PTask, type TaskStatus } from '@/lib/progetti';

const EDITABLE: TaskStatus[] = ['da_fare', 'in_corso', 'in_attesa', 'bloccata'];

interface Props {
  task: PTask;
  /** Mostra il nome del progetto (vista Oggi) */
  showProject?: boolean;
  onChanged: () => void;
}

// Riga di attività: un clic sul quadrato la segna come fatta; un clic sul titolo apre
// il cambio di stato (in attesa / bloccata chiedono «di chi» o «perché»).
export function TaskRow({ task, showProject, onChanged }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(task.status_note ?? '');
  const [busy, setBusy] = useState(false);
  const done = task.status === 'fatta';
  const late = !done && task.days_to_due != null && task.days_to_due < 0;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/api/progetti/tasks/${task.id}`, body);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di salvataggio');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/api/progetti/tasks/${task.id}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di eliminazione');
      setBusy(false);
    }
  }

  const needsNote = task.status === 'in_attesa' || task.status === 'bloccata';
  const noteLabel = task.status === 'in_attesa' ? 'da' : 'perché';

  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-stone-100 py-2.5 first:border-t-0">
      <button
        type="button" disabled={busy} aria-label={done ? 'Segna come da fare' : 'Segna come fatta'}
        onClick={() => patch({ status: done ? 'da_fare' : 'fatta' })}
        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] transition-colors ${
          done ? 'border-ink-800 bg-ink-800 text-white' : 'border-stone-300 bg-white hover:border-ink-800'}`}
      >
        {done && (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
            <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        )}
      </button>

      <div className="min-w-0">
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`break-words text-left text-sm font-medium hover:underline underline-offset-2 ${done ? 'text-stone-400 line-through' : 'text-ink-900'}`}>
          {task.title}
        </button>
        {(!done && task.status !== 'da_fare' || showProject || (task.status_note && needsNote)) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {!done && task.status !== 'da_fare' && <StatusBadge tone={TASK_TONE[task.status]}>{TASK_LABEL[task.status]}</StatusBadge>}
            {needsNote && task.status_note && <span>{noteLabel} {task.status_note}</span>}
            {task.status === 'in_attesa' && task.waiting_days != null && (
              <span className={task.waiting_days >= 3 ? 'font-semibold text-warning' : ''}>{task.waiting_days === 0 ? 'da oggi' : `da ${task.waiting_days} g`}</span>
            )}
            {showProject && (
              task.project_id
                ? <Link href={`/progetti/${task.project_id}`} className="max-w-full truncate rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent-ink hover:underline">{task.project_name}</Link>
                : <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">Senza progetto</span>
            )}
          </div>
        )}
      </div>

      <div className="whitespace-nowrap pt-0.5 text-xs tabular-nums text-muted">
        {late ? <StatusBadge tone="danger">{dueLabel(task.days_to_due)}</StatusBadge> : !done && dueLabel(task.days_to_due)}
      </div>

      {open && (
        <div className="col-span-2 col-start-2 flex flex-col gap-2 rounded-ctl bg-stone-100 p-2.5">
          <div role="group" aria-label="Stato" className="flex flex-wrap gap-1.5">
            {EDITABLE.map(s => (
              <button key={s} type="button" disabled={busy} aria-pressed={task.status === s}
                onClick={() => patch({ status: s })}
                className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                  task.status === s ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-800 hover:bg-stone-50'}`}>
                {TASK_LABEL[s]}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={remove}
              className="ml-auto rounded-full border border-line bg-white px-3 py-0.5 text-xs font-medium text-danger hover:bg-danger-soft">
              Elimina
            </button>
          </div>
          {needsNote && (
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); patch({ status_note: note }).then(() => setOpen(false)); }}>
              <input className="input" aria-label="Dettaglio" value={note} onChange={e => setNote(e.target.value)} maxLength={300}
                placeholder={task.status === 'in_attesa' ? 'In attesa di chi…' : 'Bloccata perché…'} />
              <button type="submit" disabled={busy} className="btn-primary">Salva</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
