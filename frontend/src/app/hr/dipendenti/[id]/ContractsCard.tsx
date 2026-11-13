'use client';

import { useEffect, useState } from 'react';
import type { HrEmployeeContract } from '@/types';
import { StatusBadge } from '@/components/ui/StatusBadge';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const DAY = 86_400_000;

function fmtDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Giorni di calendario del contratto, primo e ultimo giorno inclusi
function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / DAY) + 1;
}

export function ContractsCard({ employeeId }: { employeeId: number }) {
  const [items, setItems] = useState<HrEmployeeContract[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BACKEND}/api/hr/employees/${employeeId}/contracts`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (alive) setItems(d); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [employeeId]);

  // Senza contratti registrati (personale diretto) la card non serve
  if (!items || items.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const total = items.reduce((sum, c) => sum + (c.data_fine ? days(c.data_inizio, c.data_fine) : days(c.data_inizio, today)), 0);

  return (
    <div className="card">
      <p className="text-sm font-medium text-muted mb-2">Contratti</p>
      <div className="flex gap-8 mb-4">
        <div>
          <p className="text-3xl font-semibold tabular-nums leading-none">{items.length}</p>
          <p className="text-xs text-muted mt-1">{items.length === 1 ? 'contratto' : 'contratti'}</p>
        </div>
        <div>
          <p className="text-3xl font-semibold tabular-nums leading-none">{total}</p>
          <p className="text-xs text-muted mt-1">giorni in totale</p>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-muted uppercase tracking-wide">
            <th className="font-medium py-1">Inizio</th><th className="font-medium py-1">Fine</th>
            <th className="font-medium py-1 pr-6 text-right">Giorni</th><th className="font-medium py-1 px-6 border-l border-stone-100">Matricola</th><th className="font-medium py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map(c => {
            const ongoing = !c.data_fine || c.data_fine > today;
            return (
              <tr key={c.id} className="border-t border-stone-100">
                <td className="py-1.5">{fmtDate(c.data_inizio)}</td>
                <td className="py-1.5">{c.data_fine ? fmtDate(c.data_fine) : '—'}</td>
                <td className="py-1.5 pr-6 text-right tabular-nums">{c.data_fine ? days(c.data_inizio, c.data_fine) : `${days(c.data_inizio, today)}+`}</td>
                <td className="py-1.5 px-6 border-l border-stone-100">{c.matricola ?? ''}</td>
                <td className="py-1.5 text-right">{ongoing && <StatusBadge tone="success">In corso</StatusBadge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
