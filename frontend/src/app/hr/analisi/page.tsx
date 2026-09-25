'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { HrAnalyticsSummary, HrAgeBucket, HrDeptDistribution, HrEmployee, HrEventType } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Palette categorica, un colore stabile per reparto (ciclica se ce ne sono di più)
const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];

const EVENT_LABEL: Record<HrEventType, string> = {
  assunzione: 'Assunzioni', cambio_reparto: 'Cambi reparto', cambio_mansione: 'Cambi mansione',
  cambio_livello: 'Cambi livello', cambio_capo: 'Cambi responsabile', trasferimento: 'Trasferimenti',
  promozione: 'Promozioni', cessazione: 'Cessazioni', malattia: 'Malattie',
  maternita_paternita: 'Maternità/Paternità', infortunio: 'Infortuni', congedo: 'Congedi',
  rientro: 'Rientri', altro: 'Altro',
};

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-5">
      <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-2">{sub}</p>}
    </div>
  );
}

export default function AnalisiHRPage() {
  const [summary, setSummary]     = useState<HrAnalyticsSummary | null>(null);
  const [ageData, setAgeData]     = useState<HrAgeBucket[]>([]);
  const [deptDist, setDeptDist]   = useState<HrDeptDistribution[]>([]);
  const [mgrDist, setMgrDist]     = useState<{ capo_id: number | null; capo_nome: string; count: number }[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading]     = useState(true);
  const [drillDown, setDrillDown] = useState<{ eta: number; reparto_name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, aRes, dRes, mRes, eRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/analytics/summary`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/analytics/age-distribution`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/analytics/department-distribution`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/analytics/manager-distribution`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/employees?stato=attivo`, { credentials: 'include' }),
    ]);
    if (sRes.ok) setSummary(await sRes.json());
    if (aRes.ok) setAgeData(await aRes.json());
    if (dRes.ok) setDeptDist(await dRes.json());
    if (mRes.ok) setMgrDist(await mRes.json());
    if (eRes.ok) setEmployees(await eRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pivot: una riga per età, una colonna per reparto — per lo stacked bar chart
  const deptNames = useMemo(() => Array.from(new Set(ageData.map(r => r.reparto_name))).sort(), [ageData]);
  const chartData = useMemo(() => {
    const byAge = new Map<number, Record<string, number | string>>();
    for (const row of ageData) {
      if (!byAge.has(row.eta)) byAge.set(row.eta, { eta: row.eta });
      byAge.get(row.eta)![row.reparto_name] = row.count;
    }
    return Array.from(byAge.values()).sort((a, b) => (a.eta as number) - (b.eta as number));
  }, [ageData]);

  const maxDeptCount = deptDist.length > 0 ? Math.max(...deptDist.map(d => d.count)) : 1;
  const maxMgrCount  = mgrDist.length  > 0 ? Math.max(...mgrDist.map(d => d.count))  : 1;

  const nearRetirement = employees.filter(e => (e.eta ?? 0) >= 60);

  const drillEmployees = drillDown
    ? employees.filter(e => e.eta === drillDown.eta && (e.reparto_name ?? 'Senza reparto') === drillDown.reparto_name)
    : [];

  if (loading && !summary) return <p className="text-sm text-gray-400 text-center py-16">Caricamento…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-gray-900">Analisi HR</h1>
        <p className="text-xs text-gray-400 mt-0.5">Struttura dell&apos;organico, età, anzianità e movimenti del personale</p>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-5 divide-y divide-gray-100 lg:divide-y-0 lg:divide-x">
          <KpiCard label="Dipendenti attivi" value={summary?.total_attivi ?? '—'} />
          <KpiCard label="Età media" value={summary?.eta_media != null ? `${summary.eta_media}` : '—'} sub="anni" />
          <KpiCard label="Anzianità media" value={summary?.anzianita_media != null ? `${summary.anzianita_media}` : '—'} sub="anni" />
          <KpiCard label="Assunzioni (12 mesi)" value={summary?.assunzioni_ultimo_anno ?? '—'} />
          <KpiCard label="Cessazioni (12 mesi)" value={summary?.cessazioni_ultimo_anno ?? '—'} />
        </div>
      </div>

      {/* ── Distribuzione età per reparto ──────────────────────────────── */}
      <div className="card">
        <p className="text-base font-medium text-gray-700 mb-1">Struttura per età e reparto</p>
        <p className="text-xs text-gray-400 mb-3">Ogni barra è un'età; i colori mostrano da quale reparto arrivano i dipendenti. Clicca un segmento per vedere le persone di quel gruppo.</p>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dato di età disponibile</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="eta" tick={{ fontSize: 12, fill: '#374151' }} label={{ value: 'Età', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#9ca3af' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} label={{ value: 'N. dipendenti', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {deptNames.map((name, i) => (
                <Bar
                  key={name} dataKey={name} stackId="a" fill={PALETTE[i % PALETTE.length]}
                  onClick={(data: any) => setDrillDown({ eta: data.eta, reparto_name: name })}
                  cursor="pointer"
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
        {nearRetirement.length > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            ⚠ {nearRetirement.length} {nearRetirement.length === 1 ? 'persona ha' : 'persone hanno'} 60 anni o più — struttura dell&apos;età da monitorare per il turnover in vista della pensione.
          </p>
        )}
      </div>

      {drillDown && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">{drillDown.reparto_name} — {drillDown.eta} anni ({drillEmployees.length})</p>
            <button onClick={() => setDrillDown(null)} className="btn-secondary text-xs">Chiudi ×</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {drillEmployees.map(e => (
              <Link key={e.id} href={`/hr/dipendenti/${e.id}`} className="btn-secondary text-xs">{e.cognome} {e.nome} {e.mansione ? `— ${e.mansione}` : ''}</Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Eventi ultimo anno ─────────────────────────────────────────── */}
      {summary?.eventi_ultimo_anno && Object.keys(summary.eventi_ultimo_anno).length > 0 && (
        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-1">Eventi HR (ultimi 12 mesi)</p>
          <div className="flex flex-wrap gap-4 mt-3">
            {Object.entries(summary.eventi_ultimo_anno).map(([type, count]) => (
              <div key={type} className="min-w-[100px]">
                <p className="text-2xl font-semibold text-gray-800">{count}</p>
                <p className="text-xs text-gray-400">{EVENT_LABEL[type as HrEventType] ?? type}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Distribuzione per reparto / responsabile ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-3">Distribuzione per reparto</p>
          <div className="space-y-2.5">
            {deptDist.map(d => (
              <div key={d.reparto_id ?? 'none'} className="flex items-center gap-2">
                <span className="text-sm text-gray-700 truncate w-32 shrink-0">{d.reparto_name}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
                  <div className="h-2 rounded-full bg-blue-400" style={{ width: `${(d.count / maxDeptCount) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-500 shrink-0 w-8 text-right">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-3">Distribuzione per responsabile</p>
          <div className="space-y-2.5">
            {mgrDist.slice(0, 10).map(d => (
              <div key={d.capo_id ?? 'none'} className="flex items-center gap-2">
                <span className="text-sm text-gray-700 truncate w-32 shrink-0">{d.capo_nome}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
                  <div className="h-2 rounded-full bg-purple-400" style={{ width: `${(d.count / maxMgrCount) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-500 shrink-0 w-8 text-right">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
