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

interface DeptEvolutionRow { month: string; reparto_name: string; count: number; }

function fmtMonth(m: string): string {
  return new Date(`${m.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
}

export default function EvoluzioneAziendalePage() {
  const [months, setMonths] = useState(24);
  const [data, setData] = useState<HrEvolutionPoint[]>([]);
  const [deptData, setDeptData] = useState<DeptEvolutionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: number) => {
    setLoading(true);
    const [res, deptRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/analytics/evolution?months=${m}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/analytics/evolution/departments?months=${m}`, { credentials: 'include' }),
    ]);
    if (res.ok) setData(await res.json());
    if (deptRes.ok) setDeptData(await deptRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(months); }, [load, months]);

  const chartData = useMemo(() => data.map(d => ({
    month: fmtMonth(d.month),
    'Totale dipendenti': d.total_employees,
    'Assunzioni': d.hires,
    'Cessazioni': -d.terminations,
    'Età media': d.avg_age,
    'Anzianità media': d.avg_seniority_years,
  })), [data]);

  const deptNames = useMemo(() => Array.from(new Set(deptData.map(r => r.reparto_name))).sort(), [deptData]);
  const deptChartData = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const row of deptData) {
      if (!byMonth.has(row.month)) byMonth.set(row.month, { month: fmtMonth(row.month) });
      byMonth.get(row.month)![row.reparto_name] = row.count;
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Periodo:</span>
          {PERIOD_OPTIONS.map(n => (
            <button key={n} onClick={() => setMonths(n)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${months === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >{n} mesi</button>
          ))}
        </div>
      </div>

      {loading && data.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-16">Caricamento…</p>
      ) : (
        <>
          {netChange != null && (
            <div className="card p-0 overflow-hidden">
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-gray-100 lg:divide-y-0 lg:divide-x">
                <div className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Organico oggi</p>
                  <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">{last?.total_employees ?? '—'}</p>
                </div>
                <div className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Variazione nel periodo</p>
                  <p className={`text-4xl font-semibold leading-none mt-2 ${netChange > 0 ? 'text-green-600' : netChange < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                    {netChange > 0 ? '+' : ''}{netChange}
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Età media oggi</p>
                  <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">{last?.avg_age ?? '—'}</p>
                </div>
                <div className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Anzianità media oggi</p>
                  <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">{last?.avg_seniority_years ?? '—'}</p>
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
            <p className="text-xs text-gray-400 mb-2">Come si è evoluta la distribuzione dell&apos;organico tra i reparti.</p>
            {deptChartData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={deptChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#374151' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
                  <Tooltip />
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
