'use client';

import Link from 'next/link';
import { daysFromToday, fmtShort, isoPlusDays, type PhaseRow, type ProjectRow, type PTask } from '@/lib/progetti';

// Linea del tempo semplice: una barra per fase, marca «oggi», rombi sulle scadenze delle attività.
// Tutto si posiziona con un'unica scala (giorni da oggi → percentuale della larghezza).

type Tone = 'ok' | 'bad' | 'cur' | 'fut';
const TRACK: Record<Tone, string> = { ok: 'bg-success-soft', bad: 'bg-danger-soft', cur: 'bg-accent-soft', fut: 'bg-stone-200' };
const FILL: Record<Tone, string> = { ok: 'bg-green-600', bad: 'bg-red-600', cur: 'bg-accent-ink', fut: 'bg-stone-400' };

function phaseDays(ph: PhaseRow) {
  const due = ph.due_date ? daysFromToday(ph.due_date) : null;
  const start = daysFromToday(ph.start);
  return { start: due !== null ? Math.min(start, due) : start, due };
}
function tone(ph: PhaseRow): Tone {
  const { start, due } = phaseDays(ph);
  if (ph.tasks_total > 0 && ph.tasks_done === ph.tasks_total) return 'ok';
  if (due !== null && due < 0) return 'bad';
  if (start <= 0 && (due === null || due >= 0)) return 'cur';
  return 'fut';
}

function Scale({ min, max, children }: { min: number; max: number; children: (pos: (n: number) => number) => React.ReactNode }) {
  return <>{children(n => ((n - min) / (max - min)) * 100)}</>;
}

function Axis({ min, max }: { min: number; max: number }) {
  const ticks: number[] = [];
  for (let n = Math.ceil(min / 7) * 7; n <= max; n += 7) ticks.push(n);
  const pos = (n: number) => ((n - min) / (max - min)) * 100;
  return (
    <>
      {ticks.map(n => <i key={n} className="absolute inset-y-0 border-l border-stone-100" style={{ left: `${pos(n)}%` }} />)}
      <i className="absolute inset-y-0 z-[3] w-0.5 bg-accent-ink/70" style={{ left: `${pos(0)}%` }} />
    </>
  );
}

function Header({ min, max }: { min: number; max: number }) {
  const ticks: number[] = [];
  for (let n = Math.ceil(min / 7) * 7; n <= max; n += 7) ticks.push(n);
  const pos = (n: number) => ((n - min) / (max - min)) * 100;
  return (
    <div className="relative h-7">
      {ticks.map(n => <span key={n} className="absolute top-1.5 -translate-x-1/2 text-[11px] text-stone-400" style={{ left: `${pos(n)}%` }}>{fmtShort(isoPlusDays(n))}</span>)}
      <span className="absolute top-0 z-[4] -translate-x-1/2 rounded-full bg-accent-ink px-2 text-[11px] font-semibold text-white" style={{ left: `${pos(0)}%` }}>oggi</span>
    </div>
  );
}

function Legend() {
  const dot = (cls: string) => <i className={`inline-block h-2 w-3 rounded-full ${cls}`} />;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">{dot('bg-accent-ink')}Fase in corso</span>
      <span className="inline-flex items-center gap-1.5">{dot('bg-green-600')}Completata</span>
      <span className="inline-flex items-center gap-1.5">{dot('bg-red-600')}Scaduta</span>
      <span className="inline-flex items-center gap-1.5">{dot('bg-stone-400')}Futura</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rotate-45 rounded-[2px] bg-ink-700" />Scadenza di un&apos;attività</span>
    </div>
  );
}

/** Linea del tempo di un progetto: una riga per fase, più una riga con la scadenza del progetto. */
export function ProjectGantt({ phases, tasks, deadline }: { phases: PhaseRow[]; tasks: PTask[]; deadline: string | null }) {
  const dated = phases.filter(p => p.due_date);
  if (dated.length === 0) {
    return <p className="py-2 text-sm text-muted">Aggiungi almeno una fase con una scadenza per vedere la linea del tempo.</p>;
  }
  const d = dated.map(phaseDays);
  const dl = deadline ? daysFromToday(deadline) : null;
  const min = Math.min(...d.map(x => x.start), -3) - 2;
  const max = Math.max(...d.map(x => x.due ?? 0), dl ?? 0, 3) + 6;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[190px_1fr]"><div /><Header min={min} max={max} /></div>
          <Scale min={min} max={max}>{pos => (
            <>
              {dated.map(ph => {
                const { start, due } = phaseDays(ph);
                const t = tone(ph);
                const pct = ph.tasks_total ? Math.round((100 * ph.tasks_done) / ph.tasks_total) : 0;
                const mine = tasks.filter(x => x.phase_id === ph.id && x.due_date);
                return (
                  <div key={ph.id} className="grid grid-cols-[190px_1fr] items-center border-t border-stone-100">
                    <div className="min-w-0 py-1.5 pr-3">
                      <b className="block truncate font-medium text-ink-900">{ph.name}</b>
                      <span className="text-xs text-muted">{ph.tasks_done}/{ph.tasks_total} · scade {fmtShort(ph.due_date)}</span>
                    </div>
                    <div className="relative h-[54px]">
                      <Axis min={min} max={max} />
                      <div className={`absolute top-2.5 z-[2] h-5 overflow-hidden rounded-full ${TRACK[t]}`} style={{ left: `${pos(start)}%`, width: `${Math.max(pos(due!) - pos(start), 0.8)}%` }}>
                        <i className={`block h-full ${FILL[t]}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="absolute top-3 z-[2] whitespace-nowrap text-xs tabular-nums text-muted" style={{ left: `calc(${pos(due!)}% + 8px)` }}>{fmtShort(ph.due_date)}</span>
                      {mine.map(x => {
                        const dd = daysFromToday(x.due_date!);
                        return <i key={x.id} title={`${x.title} · ${fmtShort(x.due_date)}`}
                          className={`absolute top-9 z-[2] h-[9px] w-[9px] -translate-x-1/2 rotate-45 rounded-[2px] ${x.status === 'fatta' ? 'bg-green-600' : dd < 0 ? 'bg-red-600' : 'bg-ink-700'}`}
                          style={{ left: `${pos(dd)}%` }} />;
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-[190px_1fr] items-center border-t border-stone-100">
                <div className="py-1.5 pr-3"><b className="block font-medium text-ink-900">Scadenza progetto</b><span className="text-xs text-muted">{deadline ? 'dalle fasi o fissata a mano' : 'non definita'}</span></div>
                <div className="relative h-[54px]">
                  <Axis min={min} max={max} />
                  {dl !== null && (
                    <span className="absolute top-2 z-[2] flex -translate-x-full items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-ink-900" style={{ left: `${pos(dl)}%` }}>
                      {fmtShort(deadline)}<i className="block h-7 w-0.5 rounded bg-ink-900" />
                    </span>
                  )}
                </div>
              </div>
            </>
          )}</Scale>
        </div>
      </div>
      <Legend />
    </div>
  );
}

/** Linea del tempo di tutti i progetti attivi: una riga per progetto, una barra per fase. */
export function PortfolioGantt({ projects }: { projects: ProjectRow[] }) {
  const rows = projects.filter(p => p.phases.some(x => x.due_date));
  if (rows.length === 0) return <p className="py-2 text-sm text-muted">Nessun progetto ha ancora fasi con una scadenza.</p>;
  const all = rows.flatMap(p => p.phases.filter(x => x.due_date).map(phaseDays));
  const min = Math.min(...all.map(x => x.start), -3) - 2;
  const max = Math.max(...all.map(x => x.due ?? 0), 3) + 6;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[210px_1fr]"><div /><Header min={min} max={max} /></div>
          <Scale min={min} max={max}>{pos => (
            <>
              {rows.map(p => (
                <div key={p.id} className="grid grid-cols-[210px_1fr] items-center border-t border-stone-100">
                  <div className="min-w-0 py-1.5 pr-3">
                    <Link href={`/progetti/${p.id}`} className="flex items-center gap-2 hover:underline">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.health.tone === 'danger' ? 'bg-red-600' : p.health.tone === 'warning' ? 'bg-amber-500' : p.health.tone === 'success' ? 'bg-green-600' : 'bg-stone-400'}`} />
                      <b className="truncate font-medium text-ink-900">{p.name}</b>
                    </Link>
                    <span className="text-xs text-muted">scade {fmtShort(p.effective_due)} · {p.health.label}</span>
                  </div>
                  <div className="relative h-[54px]">
                    <Axis min={min} max={max} />
                    {p.phases.filter(x => x.due_date).map(ph => {
                      const { start, due } = phaseDays(ph);
                      const t = tone(ph);
                      const pct = ph.tasks_total ? Math.round((100 * ph.tasks_done) / ph.tasks_total) : 0;
                      return (
                        <div key={ph.id} title={`${ph.name} · ${ph.tasks_done}/${ph.tasks_total} · scade ${fmtShort(ph.due_date)}`}
                          className={`absolute top-[17px] z-[2] h-5 overflow-hidden rounded-full ${TRACK[t]}`} style={{ left: `${pos(start)}%`, width: `${Math.max(pos(due!) - pos(start), 0.8)}%` }}>
                          <i className={`block h-full ${FILL[t]}`} style={{ width: `${pct}%` }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}</Scale>
        </div>
      </div>
      <Legend />
      <p className="mt-2 text-xs text-muted">Ogni barra è una fase. Clicca sul nome di un progetto per aprirlo.</p>
    </div>
  );
}

