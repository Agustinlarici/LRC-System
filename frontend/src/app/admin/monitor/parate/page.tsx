'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { StopEvent, MonitorLinea } from '@/types';

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(sec: number | null) {
  if (sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export default function ParateAdminPage() {
  const [stops,    setStops]    = useState<StopEvent[]>([]);
  const [linee,    setLinee]    = useState<MonitorLinea[]>([]);
  const [loading,  setLoading]  = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const [from,      setFrom]      = useState(today);
  const [to,        setTo]        = useState(today);
  const [lineaId,   setLineaId]   = useState('');
  const [noMotivo,  setNoMotivo]  = useState(false);

  useEffect(() => { document.title = 'Storico fermate — STR'; }, []);

  useEffect(() => {
    api.get<MonitorLinea[]>('/api/monitor/linee').then(setLinee).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (from)    q.set('from',     from);
      if (to)      q.set('to',       to);
      if (lineaId) q.set('linea_id', lineaId);
      if (noMotivo) q.set('no_motivo', 'true');
      const data = await api.get<StopEvent[]>(`/api/monitor/parate?${q}`);
      setStops(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function exportExcel() {
    const q = new URLSearchParams();
    if (from)    q.set('from',     from);
    if (to)      q.set('to',       to);
    if (lineaId) q.set('linea_id', lineaId);
    window.open(`/api/monitor/parate/export?${q}`, '_blank');
  }

  // Stats
  const totalSec    = stops.reduce((a, e) => a + (e.duration_sec ?? 0), 0);
  const senzaMotivo = stops.filter(e => !e.reason_id).length;
  const aperte      = stops.filter(e => !e.ended_at).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Storico fermate</h1>
        <button onClick={exportExcel} className="btn-secondary text-sm">Esporta Excel</button>
      </div>

      {/* Filtri */}
      <div className="card mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Dal</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Al</label>
            <input type="date" value={to}   onChange={e => setTo(e.target.value)}   className="input" />
          </div>
          <div>
            <label className="label">Linea</label>
            <select value={lineaId} onChange={e => setLineaId(e.target.value)} className="input">
              <option value="">Tutte</option>
              {linee.filter(l => l.attivo).map(l => (
                <option key={l.id} value={l.id}>{l.nome}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" checked={noMotivo} onChange={e => setNoMotivo(e.target.checked)}
              className="w-4 h-4 rounded" />
            Solo senza motivo
          </label>
          <button onClick={load} className="btn-primary text-sm">Filtra</button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Fermate',        value: stops.length },
          { label: 'Tempo totale',   value: fmtDuration(totalSec) },
          { label: 'Senza motivo',   value: senzaMotivo, warn: senzaMotivo > 0 },
          { label: 'In corso',       value: aperte,      warn: aperte > 0 },
        ].map(k => (
          <div key={k.label} className={`card text-center ${k.warn ? 'border-yellow-300 bg-yellow-50' : ''}`}>
            <p className={`text-2xl font-bold ${k.warn ? 'text-yellow-700' : 'text-gray-800'}`}>{k.value}</p>
            <p className="text-xs text-gray-500 mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabella */}
      {loading ? (
        <div className="card text-center py-12 text-gray-400">Caricamento...</div>
      ) : stops.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">Nessuna fermata nel periodo selezionato</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Linea','Inizio','Fine','Durata','Categoria','Motivo','Note','Operatore'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stops.map(e => (
                  <tr key={e.id} className={`hover:bg-gray-50 ${!e.reason_id ? 'bg-yellow-50/50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{e.linea_nome}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDatetime(e.started_at)}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {e.ended_at
                        ? fmtDatetime(e.ended_at)
                        : <span className="text-red-500 font-medium">In corso</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono whitespace-nowrap">{fmtDuration(e.duration_sec)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {e.categoria_nome
                        ? <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: e.categoria_colore ?? '#ccc' }} />
                            {e.categoria_nome}
                          </span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {e.reason_descrizione ?? <span className="text-yellow-600 font-medium text-xs">Senza motivo</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{e.note ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{e.operatore ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
