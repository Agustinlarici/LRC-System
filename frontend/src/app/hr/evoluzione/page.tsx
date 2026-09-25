'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { HrEvolutionPoint } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];
const PERIOD_OPTIONS = [12, 24, 36, 60];

interface DeptEvolutionRow { month: string; funzione_name: string; count: number; }

function fmtMonth(m: string): string {
  return new Date(`${m.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
}

// Tooltip compatto per il grafico a aree con molte funzioni: solo i valori > 0, dal più grande,
// massimo 8 righe. Il tooltip standard elenca tutte le serie, sborda dalla pagina e fa comparire
// e sparire la barra di scorrimento (la pagina «trema» passando il mouse sul grafico).
function StackTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value > 0).sort((a: any, b: any) => b.value - a.value);
  const total = rows.reduce((s: number, r: any) => s + r.value, 0);
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((s: number, r: any) => s + r.value, 0);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs w-56">
      <p className="font-medium text-gray-700 mb-1">{label} <span className="text-gray-400 font-normal">· totale {total}</span></p>
      {shown.map((r: any) => (
        <div key={r.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
          <span className="truncate flex-1 text-gray-600">{r.name}</span>
          <span className="tabular-nums text-gray-800">{r.value}</span>
        </div>
      ))}
      {rest > 0 && <p className="text-gray-400 mt-1">altre {rows.length - 8} funzioni · {rest}</p>}
    </div>
  );
}

export default function EvoluzioneAziendalePage() {
  const [months, setMonths] = useState(24);
  // Periodo personalizzato: date scelte dall'utente (il calcolo lato server è mensile)
  const [custom, setCustom] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const yearAgoIso = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(yearAgoIso);
  const [to, setTo] = useState(todayIso);
  const [data, setData] = useState<HrEvolutionPoint[]>([]);
  const [deptData, setDeptData] = useState<DeptEvolutionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const [res, deptRes] = await Promise.all([
        fetch(`${BACKEND}/api/hr/analytics/evolution?${query}`, { credentials: 'include' }),
        fetch(`${BACKEND}/api/hr/analytics/evolution/departments?${query}`, { credentials: 'include' }),
      ]);
      if (res.ok) setData(await res.json());
      if (deptRes.ok) setDeptData(await deptRes.json());
    } catch {
      // Server non raggiungibile (es. in riavvio): si mantengono i dati mostrati, si riprova cambiando periodo
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (custom) { if (from && to) load(`from=${from}&to=${to}`); }
    else load(`months=${months}`);
  }, [load, months, custom, from, to]);

  const chartData = useMemo(() => data.map(d => ({
    month: fmtMonth(d.month),
    'Totale dipendenti': d.total_employees,
    'Assunzioni': d.hires,
    'Cessazioni': -d.terminations,
    'Età media': d.avg_age,
    'Anzianità media': d.avg_seniority_years,
  })), [data]);

  const deptNames = useMemo(() => Array.from(new Set(deptData.map(r => r.funzione_name))).sort(), [deptData]);
  const deptChartData = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const row of deptData) {
      if (!byMonth.has(row.month)) byMonth.set(row.month, { month: fmtMonth(row.month) });
      byMonth.get(row.month)![row.funzione_name] = row.count;
    }
    return Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [deptData]);

  const first = data[0];
  const last = data[data.length - 1];
  const netChange = first && last ? last.total_employees - first.total_employees : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Evoluzione Aziendale</h1>
          <p className="text-xs text-gray-400 mt-0.5">Com&apos;è cambiata l&apos;azienda nel tempo</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Periodo:</span>
          {PERIOD_OPTIONS.map(n => (
            <button key={n} onClick={() => { setCustom(false); setMonths(n); }}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${!custom && months === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >{n} mesi</button>
          ))}
          <button onClick={() => setCustom(true)}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${custom ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >Personalizzato</button>
          {custom && (
            <>
              <label className="text-xs text-gray-500">Dal</label>
              <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="input text-sm w-auto py-1" />
              <label className="text-xs text-gray-500">Al</label>
              <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="input text-sm w-auto py-1" />
            </>
          )}
        </div>
      </div>

      {loading && data.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-16">Caricamento…</p>
      ) : (
        <>
          {netChange != null && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="card p-3">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Organico {custom ? 'a fine periodo' : 'oggi'}</p>
                  <p className="text-2xl font-semibold leading-none mt-1.5 text-gray-900">{last?.total_employees ?? '—'}</p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Variazione nel periodo</p>
                  <p className={`text-2xl font-semibold leading-none mt-1.5 ${netChange > 0 ? 'text-green-600' : netChange < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                    {netChange > 0 ? '+' : ''}{netChange}
                  </p>
                </div>
                <div className="card p-3">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Anzianità media {custom ? 'a fine periodo' : 'oggi'}</p>
                  <p className="text-2xl font-semibold leading-none mt-1.5 text-gray-900">{last?.avg_seniority_years ?? '—'}</p>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Organico nel tempo</p>
            <p className="text-xs text-gray-400 mb-2">Numero totale di dipendenti attivi, mese per mese.</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#374151' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
                <Tooltip />
                <Line type="monotone" dataKey="Totale dipendenti" stroke="#2563eb" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Assunzioni e cessazioni</p>
              <p className="text-xs text-gray-400 mb-2">Movimenti mensili di personale.</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#374151' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip />
                  <Bar dataKey="Assunzioni" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Cessazioni" fill="#ef4444" radius={[0, 0, 3, 3]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Età e anzianità medie</p>
              <p className="text-xs text-gray-400 mb-2">Evoluzione della composizione anagrafica dell&apos;organico.</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#374151' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Età media" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Anzianità media" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Struttura organizzativa nel tempo</p>
            <p className="text-xs text-gray-400 mb-2">Come si è evoluta la distribuzione dell&apos;organico tra le funzioni aziendali.</p>
            {deptChartData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={deptChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#374151' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip content={<StackTooltip />} wrapperStyle={{ pointerEvents: 'none', zIndex: 20 }} isAnimationActive={false} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {deptNames.map((name, i) => (
                    <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.6} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
