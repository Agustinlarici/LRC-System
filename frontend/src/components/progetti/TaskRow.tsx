'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  TASK_LABEL, TASK_TONE, dueLabel, initials, fmtShort,
  type PTask, type PhaseRow, type Person, type TaskStatus,
} from '@/lib/progetti';

const EDITABLE: TaskStatus[] = ['da_fare', 'in_corso', 'in_attesa', 'bloccata'];

interface Props {
  task: PTask;
  /** Mostra il nome del progetto e della fase (vista Oggi) */
  showProject?: boolean;
  /** Fasi del progetto: abilita il selettore di fase e l'avviso «oltre la scadenza della fase» */
  phases?: PhaseRow[];
  /** Persone del team: abilita il selettore del responsabile */
  people?: Person[];
  /** Colonne strette: scadenza e responsabile vanno sotto il titolo invece che a destra */
  compact?: boolean;
  onChanged: () => void;
}

// Riga di attività: il quadrato la segna come fatta; il titolo apre l'editor
// (stato, responsabile, scadenza, fase e, in «in attesa»/«bloccata», di chi o perché).
export function TaskRow({ task, showProject, phases, people, compact, onChanged }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(task.status_note ?? '');
  const [title, setTitle] = useState(task.title);
  const [busy, setBusy] = useState(false);
  const done = task.status === 'fatta';
  const late = !done && task.days_to_due != null && task.days_to_due < 0;
  const phase = phases?.find(p => p.id === task.phase_id);
  const overPhase = !done && !!task.due_date && !!phase?.due_date && task.due_date > phase.due_date;

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await api.patch(`/api/progetti/tasks/${task.id}`, body);
      onChanged();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di salvataggio');
      return false;
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
  const dueText = late ? null : (!done && task.due_date ? (task.days_to_due != null && task.days_to_due <= 1 ? dueLabel(task.days_to_due) : fmtShort(task.due_date)) : null);
  const hasRight = !!task.assigned_name || late || !!dueText;
  const hasMeta = (!done && task.status !== 'da_fare') || showProject || (task.status_note && needsNote) || overPhase || (compact && hasRight);
  const field = 'input !w-auto !px-2.5 !py-1 text-[13px]';

  const right = (
    <div className="flex items-center gap-2 whitespace-nowrap pt-0.5 text-xs tabular-nums text-muted">
      {task.assigned_name && (
        <span title={task.assigned_name} className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">
          {initials(task.assigned_name)}
        </span>
      )}
      {late
        ? <StatusBadge tone="danger">{dueLabel(task.days_to_due)}</StatusBadge>
        : dueText && <span>{dueText}</span>}
    </div>
  );

  return (
    <div className={`grid ${compact ? 'grid-cols-[22px_minmax(0,1fr)]' : 'grid-cols-[22px_minmax(0,1fr)_auto]'} items-start gap-x-3 gap-y-1 border-t border-stone-100 py-2.5 first:border-t-0`}>
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
        {hasMeta && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {!done && task.status !== 'da_fare' && <StatusBadge tone={TASK_TONE[task.status]}>{TASK_LABEL[task.status]}</StatusBadge>}
            {needsNote && task.status_note && <span>{noteLabel} {task.status_note}</span>}
            {task.status === 'in_attesa' && task.waiting_days != null && (
              <span className={task.waiting_days >= 3 ? 'font-semibold text-warning' : ''}>{task.waiting_days === 0 ? 'da oggi' : `da ${task.waiting_days} g`}</span>
            )}
            {showProject && (
              task.project_id
                ? <>
                    <Link href={`/progetti/${task.project_id}`} className="max-w-full truncate rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent-ink hover:underline">{task.project_name}</Link>
                    {task.phase_name && <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">{task.phase_name}</span>}
                  </>
                : <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">Senza progetto</span>
            )}
            {overPhase && <span className="font-semibold text-warning">oltre la scadenza della fase ({fmtShort(phase!.due_date)})</span>}
            {compact && hasRight && <span className="ml-auto flex items-center">{right}</span>}
          </div>
        )}
      </div>

      {!compact && right}

      {open && (
        <div className={`${compact ? 'col-start-2' : 'col-span-2 col-start-2'} flex flex-col gap-2.5 rounded-ctl bg-stone-100 p-3`}>
          <input className="input" aria-label="Titolo" value={title} maxLength={300}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { const t = title.trim(); if (t && t !== task.title) patch({ title: t }); else setTitle(task.title); }} />
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            {people && (
              <label className="flex items-center gap-1.5">Responsabile
                <select className={field} value={task.assigned_to ?? ''} disabled={busy}
                  onChange={e => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5">Scadenza
              <input type="date" className={field} value={task.due_date ?? ''} disabled={busy}
                onChange={e => patch({ due_date: e.target.value || null })} />
            </label>
            {phases && phases.length > 0 && task.project_id && (
              <label className="flex items-center gap-1.5">Fase
                <select className={field} value={task.phase_id ?? ''} disabled={busy}
                  onChange={e => patch({ phase_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Senza fase</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {needsNote && (
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); patch({ status_note: note }).then(ok => ok && setOpen(false)); }}>
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
