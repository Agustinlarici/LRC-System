'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { TASK_LABEL, dueLabel, fmtShort, initials, type PTask, type PhaseRow, type TaskStatus } from '@/lib/progetti';

const COLS: TaskStatus[] = ['da_fare', 'in_corso', 'in_attesa', 'bloccata', 'fatta'];

// Tabellone per stato: si trascinano le schede tra le colonne (o si usa ›) per cambiare stato.
export function Board({ tasks, phases, reload }: { tasks: PTask[]; phases: PhaseRow[]; reload: () => void }) {
  const toast = useToast();
  const [who, setWho] = useState<number | 'all'>('all');
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const people = Array.from(new Map(tasks.filter(t => t.assigned_to).map(t => [t.assigned_to!, t.assigned_name ?? `#${t.assigned_to}`])).entries());

  async function move(id: number, status: TaskStatus) {
    const t = tasks.find(x => x.id === id);
    if (!t || t.status === status) return;
    try { await api.patch(`/api/progetti/tasks/${id}`, { status }); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Errore di salvataggio'); }
  }

  const pill = (active: boolean) => `rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
    active ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-800 hover:bg-stone-50'}`;

  return (
    <div>
      {people.length > 1 && (
        <div role="group" aria-label="Persona" className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={who === 'all'} className={pill(who === 'all')} onClick={() => setWho('all')}>Tutti</button>
          {people.map(([id, name]) => (
            <button key={id} type="button" aria-pressed={who === id} className={pill(who === id)} onClick={() => setWho(id)}>{name}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[repeat(5,minmax(176px,1fr))] items-start gap-3 overflow-x-auto pb-1.5">
        {COLS.map((s, ci) => {
          const col = tasks.filter(t => t.status === s && (who === 'all' || t.assigned_to === who));
          return (
            <div key={s}
              onDragOver={e => { if (dragId !== null) { e.preventDefault(); setOver(s); } }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); if (dragId !== null) move(dragId, s); setDragId(null); }}
              className={`min-h-[160px] rounded-card p-3 transition-colors ${over === s ? 'bg-accent-soft outline-dashed outline-2 outline-accent' : 'bg-stone-200'}`}>
              <h3 className="mb-2.5 mx-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-stone-600">
                {TASK_LABEL[s]}
                <span className="rounded-full bg-white px-2 text-xs normal-case tracking-normal tabular-nums">{col.length}</span>
              </h3>
              {col.map(t => {
                const ph = phases.find(p => p.id === t.phase_id);
                const late = t.status !== 'fatta' && t.days_to_due != null && t.days_to_due < 0;
                return (
                  <div key={t.id} draggable onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); }}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    className={`mb-2 flex cursor-grab flex-col gap-1.5 rounded-2xl bg-white px-3 py-2.5 shadow-card active:cursor-grabbing ${dragId === t.id ? 'opacity-45' : ''}`}>
                    <div className="break-words text-sm font-medium text-ink-900">{t.title}</div>
                    {t.status_note && (s === 'in_attesa' || s === 'bloccata') && (
                      <div className="text-xs text-muted">{s === 'in_attesa' ? 'da' : 'perché'} {t.status_note}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {ph && <span className="max-w-full truncate rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">{ph.name}</span>}
                      {t.due_date && s !== 'fatta' && (
                        <span className={late ? 'font-semibold text-danger' : 'text-muted'}>{late ? dueLabel(t.days_to_due) : fmtShort(t.due_date)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      {t.assigned_name
                        ? <span title={t.assigned_name} className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">{initials(t.assigned_name)}</span>
                        : <span />}
                      {ci < COLS.length - 1 && (
                        <button type="button" title={`Sposta a «${TASK_LABEL[COLS[ci + 1]]}»`} aria-label={`Sposta a ${TASK_LABEL[COLS[ci + 1]]}`}
                          onClick={() => move(t.id, COLS[ci + 1])}
                          className="rounded-full border border-line bg-white px-2 text-xs text-muted hover:bg-stone-100 hover:text-ink-900">›</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Trascina le schede tra le colonne (o usa ›) per cambiare stato.</p>
    </div>
  );
}
