'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { SpmaLine, SpmaCalendarEntry } from '@/types';

function isoWeekRange(offsetWeeks = 0): { from: string; to: string } {
  const now   = new Date();
  const day   = now.getDay() || 7;
  const mon   = new Date(now);
  mon.setDate(now.getDate() - day + 1 + offsetWeeks * 7);
  const sun   = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(mon), to: fmt(sun) };
}

function formatTime(t: string) {
  return t ? t.slice(0, 5) : '–';
}

export default function SpmaCalendarioPage() {
  const [lines,      setLines]      = useState<SpmaLine[]>([]);
  const [lineId,     setLineId]     = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries,    setEntries]    = useState<SpmaCalendarEntry[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [editId,     setEditId]     = useState<number | null>(null);
  const [editStart,  setEditStart]  = useState('');
  const [editEnd,    setEditEnd]    = useState('');
  const [addDate,    setAddDate]    = useState('');
  const [addStart,   setAddStart]   = useState('');
  const [addEnd,     setAddEnd]     = useState('');
  const [busy,       setBusy]       = useState(false);

  useEffect(() => {
    api.get<SpmaLine[]>('/api/spma/lines').then(r => {
      setLines(r);
      if (r.length > 0) setLineId(String(r[0].id));
    });
  }, []);

  const { from, to } = isoWeekRange(weekOffset);

  const load = useCallback(async () => {
    if (!lineId) return;
    setLoading(true);
    try {
      const data = await api.get<SpmaCalendarEntry[]>(
        `/api/spma/calendar?line_id=${lineId}&from=${from}&to=${to}`
      );
      setEntries(data);
    } finally { setLoading(false); }
  }, [lineId, from, to]);

  useEffect(() => { load(); }, [load]);

  function startEdit(entry: SpmaCalendarEntry) {
    setEditId(entry.id);
    setEditStart(formatTime(entry.start_time));
    setEditEnd(formatTime(entry.end_time));
  }

  async function saveEdit(id: number) {
    setBusy(true);
    try {
      const updated = await api.put<SpmaCalendarEntry>(`/api/spma/calendar/${id}`, {
        startTime: editStart,
        endTime:   editEnd,
      });
      setEntries(prev => prev.map(e => e.id === id ? updated : e));
      setEditId(null);
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questa voce?')) return;
    await api.delete(`/api/spma/calendar/${id}`);
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function addEntry() {
    if (!lineId || !addDate || !addStart || !addEnd) return;
    setBusy(true);
    try {
      const entry = await api.post<SpmaCalendarEntry>('/api/spma/calendar', {
        lineId:    parseInt(lineId),
        workDate:  addDate,
        startTime: addStart,
        endTime:   addEnd,
      });
      setEntries(prev => {
        const without = prev.filter(e => e.work_date !== entry.work_date);
        return [...without, entry].sort((a, b) => a.work_date.localeCompare(b.work_date));
      });
      setAddDate(''); setAddStart(''); setAddEnd('');
    } finally { setBusy(false); }
  }

  // Build a full week of dates to show (including days without entries)
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(from + 'T12:00:00');
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const entryByDate = new Map(entries.map(e => [e.work_date, e]));

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  function dayName(dateStr: string) {
    return dayNames[new Date(dateStr + 'T12:00:00').getDay()];
  }
  function fmtDate(dateStr: string) {
    const d = new Date(dateStr + 'T12:00:00');
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/spma/impostazioni" className="text-sm text-gray-500 hover:text-gray-700">← Impostazioni</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Calendario Avanzamento Prod</h1>
        <p className="mt-1 text-gray-500">Orari di lavoro giornalieri per linea. Le voci generate automaticamente dall'import non vengono sovrascritte.</p>
      </div>

      {/* Controls */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <select value={lineId} onChange={e => setLineId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Seleziona linea</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekOffset(w => w - 1)}
            className="border border-gray-200 rounded px-2 py-1 text-sm hover:bg-gray-50">‹</button>
          <span className="text-sm text-gray-600 px-2">
            {from} — {to}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)}
            className="border border-gray-200 rounded px-2 py-1 text-sm hover:bg-gray-50">›</button>
          <button onClick={() => setWeekOffset(0)}
            className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 ml-1">Oggi</button>
        </div>
      </div>

      {/* Week grid */}
      {lineId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-2.5 px-4 text-left font-medium">Data</th>
                <th className="py-2.5 px-4 text-left font-medium">Inizio</th>
                <th className="py-2.5 px-4 text-left font-medium">Fine</th>
                <th className="py-2.5 px-4 text-left font-medium">Fonte</th>
                <th className="py-2.5 px-4" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">Caricamento...</td></tr>
              ) : weekDates.map(date => {
                const entry  = entryByDate.get(date);
                const isEdit = editId === entry?.id;
                const dn     = dayName(date);
                const isWknd = dn === 'Sab' || dn === 'Dom';

                return (
                  <tr key={date} className={`border-b border-gray-100 ${isWknd ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                    <td className="py-2 px-4 font-medium">
                      <span className={`${isWknd ? 'text-gray-400' : 'text-gray-700'}`}>
                        {dn} {fmtDate(date)}
                      </span>
                    </td>
                    {entry ? (
                      isEdit ? (
                        <>
                          <td className="py-1.5 px-4">
                            <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)}
                              className="border border-gray-200 rounded px-2 py-1 text-sm" />
                          </td>
                          <td className="py-1.5 px-4">
                            <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                              className="border border-gray-200 rounded px-2 py-1 text-sm" />
                          </td>
                          <td className="py-1.5 px-4" />
                          <td className="py-1.5 px-4 text-right">
                            <button onClick={() => saveEdit(entry.id)} disabled={busy}
                              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50 mr-1">
                              Salva
                            </button>
                            <button onClick={() => setEditId(null)}
                              className="text-xs text-gray-500 hover:text-gray-700">
                              Annulla
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 px-4 text-gray-700">{formatTime(entry.start_time)}</td>
                          <td className="py-2 px-4 text-gray-700">{formatTime(entry.end_time)}</td>
                          <td className="py-2 px-4">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${entry.auto_generated ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}>
                              {entry.auto_generated ? 'Auto' : 'Manuale'}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-right flex gap-2 justify-end">
                            <button onClick={() => startEdit(entry)}
                              className="text-xs text-blue-600 hover:text-blue-800 transition-colors">
                              Modifica
                            </button>
                            <button onClick={() => del(entry.id)}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors">
                              Elimina
                            </button>
                          </td>
                        </>
                      )
                    ) : (
                      <>
                        <td className="py-2 px-4 text-gray-300">–</td>
                        <td className="py-2 px-4 text-gray-300">–</td>
                        <td className="py-2 px-4 text-gray-300 text-xs">Non lavorativo</td>
                        <td className="py-2 px-4" />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add manual entry */}
      {lineId && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Aggiungi giorno manualmente</h2>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Data</label>
              <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Inizio</label>
              <input type="time" value={addStart} onChange={e => setAddStart(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Fine</label>
              <input type="time" value={addEnd} onChange={e => setAddEnd(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={addEntry} disabled={busy || !addDate || !addStart || !addEnd}
              className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Aggiungi
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Se il giorno esiste già, verrà sovrascritto e marcato come manuale.</p>
        </div>
      )}
    </div>
  );
}
