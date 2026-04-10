'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';
import { SkeletonTable } from '@/components/ui/Skeleton';
import type { SpmaPlanItem } from '@/types';

const TAB_STATUSES: Record<string, string> = {
  'Da confermare': 'PICKED,CONFIRMED',
  'Tutte':         'PENDING,PICKED,CONFIRMED,SENT',
};

export default function SpmaConfirmPage() {
  const [tab,       setTab]       = useState('Da confermare');
  const [items,     setItems]     = useState<SpmaPlanItem[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [q,         setQ]         = useState('');
  const [selected,  setSelected]  = useState<Set<number>>(new Set());
  const [busy,      setBusy]      = useState(false);
  const [msg,       setMsg]       = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ status: TAB_STATUSES[tab] });
      if (q) params.set('q', q);
      const data = await api.get<SpmaPlanItem[]>(`/api/spma/confirm/items?${params}`);
      setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => { load(); }, [load]);

  function flash(text: string, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }

  async function markSelected(status: 'PENDING' | 'PICKED' | 'CONFIRMED' | 'SENT') {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.post('/api/spma/confirm/mark', { planIds: [...selected], status });
      flash(`${selected.size} elemento/i → ${status}`);
      load();
    } catch (e) {
      flash((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  async function sendAll() {
    setBusy(true);
    try {
      await api.post('/api/spma/confirm/send', {});
      flash('Tutti i CONFIRMED inviati come SENT');
      load();
    } catch (e) {
      flash((e as Error).message, false);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev =>
      prev.size === items.length ? new Set() : new Set(items.map(i => i.id))
    );
  }

  const statusBadge = (s: string) => {
    const cls: Record<string, string> = {
      PENDING:   'bg-gray-100 text-gray-500',
      PICKED:    'bg-yellow-100 text-yellow-700',
      CONFIRMED: 'bg-blue-100 text-blue-700',
      SENT:      'bg-green-100 text-green-700',
      SKIPPED:   'bg-red-100 text-red-600',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls[s] ?? 'bg-gray-100 text-gray-500'}`}>
        {s}
      </span>
    );
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/spma" className="text-sm text-gray-500 hover:text-gray-700">← SPMA</Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Conferma componenti</h1>
          <p className="mt-1 text-gray-500">Gestisci lo stato dei componenti del piano</p>
        </div>
        <button
          onClick={sendAll}
          disabled={busy}
          className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          Invia tutti CONFIRMED → SENT
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {Object.keys(TAB_STATUSES).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setQ(''); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search + bulk actions */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          type="search"
          placeholder="Cerca commessa o categoria..."
          value={q}
          onChange={e => setQ(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {selected.size > 0 && (
          <div className="flex gap-2">
            <button onClick={() => markSelected('PICKED')}    disabled={busy} className="text-xs px-3 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">→ PICKED</button>
            <button onClick={() => markSelected('CONFIRMED')} disabled={busy} className="text-xs px-3 py-2 border rounded-lg hover:bg-blue-50 text-blue-700 disabled:opacity-50">→ CONFIRMED</button>
            <button onClick={() => markSelected('SENT')}      disabled={busy} className="text-xs px-3 py-2 border rounded-lg hover:bg-green-50 text-green-700 disabled:opacity-50">→ SENT</button>
            <button onClick={() => markSelected('PENDING')}   disabled={busy} className="text-xs px-3 py-2 border rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-50">Reset</button>
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          Nessun elemento
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-3 px-4">
                  <input type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="py-3 px-4 text-left font-medium">Commessa</th>
                <th className="py-3 px-4 text-left font-medium">Categoria</th>
                <th className="py-3 px-4 text-left font-medium">Pianificato</th>
                <th className="py-3 px-4 text-center font-medium">Stato</th>
                <th className="py-3 px-4 text-left font-medium">Aggiornato</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}
                  onClick={() => toggleSelect(it.id)}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${selected.has(it.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="py-2.5 px-4" onClick={e => e.stopPropagation()}>
                    <input type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleSelect(it.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="py-2.5 px-4 font-mono font-medium">{it.commessa_code}</td>
                  <td className="py-2.5 px-4 text-gray-700">{it.category_name}</td>
                  <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">
                    {it.planned_ts ? fmtDatetime(it.planned_ts) : '–'}
                  </td>
                  <td className="py-2.5 px-4 text-center">{statusBadge(it.status)}</td>
                  <td className="py-2.5 px-4 text-gray-400 text-xs whitespace-nowrap">
                    {it.confirmed_at
                      ? fmtDatetime(it.confirmed_at)
                      : it.picked_at
                        ? fmtDatetime(it.picked_at)
                        : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        {items.length} elementi · {selected.size} selezionati
      </p>
    </div>
  );
}
