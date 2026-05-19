'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';
import { SkeletonTable } from '@/components/ui/Skeleton';
import type { SpmaOverviewRow, SpmaCategory, SpmaLine, SpmaDelayItem } from '@/types';

// ─── Delay banner ─────────────────────────────────────────────────────────────

function DelayBanner() {
  const [items,   setItems]   = useState<SpmaDelayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(false);

  useEffect(() => {
    api.get<SpmaDelayItem[]>('/api/spma/delay-status')
      .then(data => {
        setItems(data.filter(d => d.severity !== 'ok').sort((a, b) => b.delay_pct - a.delay_pct));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || items.length === 0) return null;

  const criticals = items.filter(i => i.severity === 'critical').length;
  const warnings  = items.filter(i => i.severity === 'warning').length;

  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
          criticals > 0
            ? 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
            : 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100'
        }`}
      >
        <span>
          {criticals > 0 && `🔴 ${criticals} ritardo${criticals > 1 ? 'i' : ''} critic${criticals > 1 ? 'i' : 'o'}  `}
          {warnings  > 0 && `🟡 ${warnings} avviso${warnings > 1 ? 'i' : ''}  `}
        </span>
        <span className="text-xs">{open ? '▲ Nascondi' : '▼ Dettagli'}</span>
      </button>

      {open && (
        <div className="mt-1 bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-2.5 px-4 text-left font-medium">Commessa</th>
                <th className="py-2.5 px-4 text-left font-medium">Categoria</th>
                <th className="py-2.5 px-4 text-left font-medium">Fase attuale</th>
                <th className="py-2.5 px-4 text-right font-medium">Ritardo</th>
                <th className="py-2.5 px-4 text-left font-medium">Montaggio</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-4 font-mono font-medium">{item.commessa_code}</td>
                  <td className="py-2 px-4 text-gray-600">{item.category_name}</td>
                  <td className="py-2 px-4 text-gray-500">{item.current_fase ?? '–'}</td>
                  <td className="py-2 px-4 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      item.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {item.delay_pct}%
                    </span>
                  </td>
                  <td className="py-2 px-4 text-gray-500 whitespace-nowrap text-xs">
                    {new Date(item.planned_ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-gray-100 text-gray-500',
  PICKED:    'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  SENT:      'bg-green-100 text-green-700',
  SKIPPED:   'bg-red-100 text-red-600',
  NA:        '',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:   '–',
  PICKED:    'Preso',
  CONFIRMED: 'Conf.',
  SENT:      'Inviato',
  SKIPPED:   'Skip',
  NA:        '',
};

function StatusCell({ status, plannedTs }: { status: string; plannedTs: string | null }) {
  if (status === 'NA') return <td className="py-2 px-3 text-center text-gray-200">–</td>;
  const color = STATUS_COLORS[status] ?? 'bg-gray-100';
  return (
    <td className="py-2 px-3 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
        {plannedTs && (
          <span className="text-[10px] text-gray-400">{fmtDatetime(plannedTs)}</span>
        )}
      </div>
    </td>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SpmaPage() {
  const [lines,      setLines]      = useState<SpmaLine[]>([]);
  const [categories, setCategories] = useState<SpmaCategory[]>([]);
  const [rows,       setRows]       = useState<SpmaOverviewRow[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [lineId,     setLineId]     = useState('');
  const [date,       setDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    api.get<SpmaLine[]>('/api/spma/lines').then(setLines).catch(console.error);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (lineId) params.set('line_id', lineId);
      if (date)   params.set('date', date);
      const data = await api.get<{ categories: SpmaCategory[]; rows: SpmaOverviewRow[] }>(
        `/api/spma/overview?${params}`
      );
      setCategories(data.categories);
      setRows(data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [lineId, date]);

  // Auto-load when filters change
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">SPMA — Sequenza Piano</h1>
          <p className="mt-1 text-gray-500">Pianificazione componenti per sequenza di linea</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/spma/import"
            className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            ⬆ Importa Excel
          </Link>
          <Link href="/spma/calendario"
            className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            Calendario
          </Link>
          <Link href="/spma/impostazioni"
            className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            ⚙ Impostazioni
          </Link>
        </div>
      </div>

      <DelayBanner />

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select
          value={lineId}
          onChange={e => setLineId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tutte le linee</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={load}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
          Aggiorna
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <SkeletonTable rows={8} cols={(categories.length || 4) + 3} />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          {lineId || date
            ? 'Nessun dato per i filtri selezionati'
            : 'Seleziona una linea o una data, oppure importa un file Excel'}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-3 px-4 text-left font-medium">Commessa</th>
                <th className="py-3 px-4 text-left font-medium">Modello</th>
                <th className="py-3 px-4 text-left font-medium">Ingresso</th>
                {categories.map(cat => (
                  <th key={cat.id} className="py-3 px-3 text-center font-medium whitespace-nowrap">
                    {cat.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.commessa_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-4 font-mono font-medium">{row.commessa_code}</td>
                  <td className="py-2 px-4 text-gray-600">{row.model_code || '–'}</td>
                  <td className="py-2 px-4 text-gray-500 whitespace-nowrap">
                    {row.line_entry_ts ? fmtDatetime(row.line_entry_ts) : '–'}
                  </td>
                  {row.cells.map(cell => (
                    <StatusCell
                      key={cell.component_category_id}
                      status={cell.status}
                      plannedTs={cell.planned_ts}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="mt-4 flex gap-3 text-xs text-gray-500 flex-wrap">
          {Object.entries(STATUS_LABEL).filter(([k]) => k !== 'NA').map(([k, v]) => (
            <span key={k} className={`px-2 py-0.5 rounded ${STATUS_COLORS[k]}`}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
