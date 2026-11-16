'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { SharedProject } from '@/lib/progetti';
import { fmtShort } from '@/lib/progetti';

// «Progetti condivisi con me»: i progetti di cui l'utente è collaboratore (sola lettura).
// Non compare se non ce n'è nessuno.
export function SharedProjects() {
  const [rows, setRows] = useState<SharedProject[]>([]);
  useEffect(() => { api.get<SharedProject[]>('/api/progetti/mine').then(setRows).catch(() => setRows([])); }, []);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-ink-900">Progetti condivisi con me</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(p => {
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-base font-semibold text-ink-900">{p.name}</h3>
                <span className="text-sm tabular-nums text-muted">{p.progress_pct}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-accent-ink" style={{ width: `${p.progress_pct}%` }} /></div>
              <p className="mt-2 text-xs text-muted">{p.due_date ? `Scadenza ${fmtShort(p.due_date)} · ` : ''}{p.tasks_done}/{p.tasks_total} attività</p>
            </>
          );
          return p.ticket_number
            ? <Link key={p.id} href={`/tickets/stato/${p.ticket_number.replace(/^#/, '')}`} className="block rounded-card bg-white p-5 shadow-card transition-shadow hover:shadow-float">{body}</Link>
            : <div key={p.id} className="rounded-card bg-white p-5 shadow-card">{body}</div>;
        })}
      </div>
    </section>
  );
}
