'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const OEE_TARGET = 80;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekRow {
  linea_id:         number;
  nome:             string;
  week_start:       string;
  giorni:           number;
  oee_avg:          number | null;
  disp_avg:         number | null;
  perf_avg:         number | null;
  qual_avg:         number | null;
  pezzi_reali:      number;
  pezzi_piano:      number;
  pezzi_deliberati: number;
  pezzi_conformi:   number;
  fermi_min:        number;
  fermi_count:      number;
}

interface LineaTrend {
  linea_id:           number;
  nome:               string;
  weeks:              (WeekRow | null)[];   // null = no data for that week
  oee_current:        number | null;
  oee_prev:           number | null;
  total_pezzi_reali:  number;
  total_pezzi_piano:  number;
  total_conformi:     number;
  total_deliberati:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function oeeBlockColor(oee: number | null): string {
  if (oee == null)    return 'bg-gray-100';
  if (oee >= OEE_TARGET) return 'bg-green-500';
  if (oee >= 65)      return 'bg-yellow-400';
  if (oee >= 50)      return 'bg-orange-400';
  return 'bg-red-500';
}

function oeeTextColor(oee: number | null): string {
  if (oee == null)         return 'text-gray-400';
  if (oee >= OEE_TARGET)   return 'text-green-600';
  if (oee >= 65)           return 'text-yellow-500';
  return 'text-red-600';
}

function fmtWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

function prodBarColor(reali: number, piano: number): string {
  if (piano === 0) return 'bg-gray-300';
  const r = reali / piano;
  if (r >= 0.9) return 'bg-green-500';
  if (r >= 0.7) return 'bg-yellow-400';
  return 'bg-red-500';
}

function scrapColor(conformi: number, deliberati: number): string {
  if (deliberati === 0) return 'text-gray-400';
  const scrapPct = (deliberati - conformi) / deliberati * 100;
  if (scrapPct <= 3)  return 'text-green-600';
  if (scrapPct <= 7)  return 'text-yellow-500';
  return 'text-red-600';
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value != null ? p.value.toFixed(1) + '%' : '—'}
        </p>
      ))}
    </div>
  );
}

// ─── Expanded detail chart ────────────────────────────────────────────────────

function LineaDetailChart({ linea, allWeeks }: { linea: LineaTrend; allWeeks: string[] }) {
  const chartData = allWeeks.map(ws => {
    const w = linea.weeks[allWeeks.indexOf(ws)];
    return {
      week: fmtWeek(ws),
      OEE:          w?.oee_avg  ?? null,
      Disponibilità: w?.disp_avg ?? null,
      Performance:  w?.perf_avg ?? null,
    };
  });

  return (
    <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={OEE_TARGET} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `${OEE_TARGET}%`, fontSize: 9, fill: '#16a34a', position: 'insideTopRight' }} />
          <Line type="monotone" dataKey="OEE" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          <Line type="monotone" dataKey="Disponibilità" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} />
          <Line type="monotone" dataKey="Performance" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-gray-400 mt-1 pl-2">
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> OEE</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-yellow-400 inline-block" style={{ borderTop: '2px dashed #f59e0b', background: 'none' }} /> Disponibilità</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-violet-500 inline-block" style={{ borderTop: '2px dashed #8b5cf6', background: 'none' }} /> Performance</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TrendsPage() {
  const [weeksParam, setWeeksParam] = useState(8);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [linee,      setLinee]      = useState<LineaTrend[]>([]);
  const [allWeeks,   setAllWeeks]   = useState<string[]>([]);
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [sortBy,     setSortBy]     = useState<'oee' | 'nome' | 'prod' | 'scrap'>('oee');

  const fetchData = useCallback(async (weeks: number) => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/dashboards/weekly-oee?weeks=${weeks}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status}`);
      const json: { weeks: number; data: WeekRow[] } = await r.json();

      // Build unique sorted week list
      const weekSet = new Set(json.data.map(r => r.week_start));
      const sortedWeeks = Array.from(weekSet).sort();
      setAllWeeks(sortedWeeks);

      // Group by line
      const byLine = new Map<number, { nome: string; map: Map<string, WeekRow> }>();
      for (const row of json.data) {
        if (!byLine.has(row.linea_id)) byLine.set(row.linea_id, { nome: row.nome, map: new Map() });
        byLine.get(row.linea_id)!.map.set(row.week_start, row);
      }

      const result: LineaTrend[] = [];
      for (const [linea_id, { nome, map }] of byLine) {
        const weeks = sortedWeeks.map(ws => map.get(ws) ?? null);

        // Current & previous week OEE (last 2 weeks with data)
        const withData = weeks.filter((w): w is WeekRow => w != null && w.oee_avg != null).slice(-2);
        const oee_current = withData[1]?.oee_avg ?? withData[0]?.oee_avg ?? null;
        const oee_prev    = withData.length >= 2 ? withData[0].oee_avg : null;

        // Period totals
        let total_pezzi_reali = 0, total_pezzi_piano = 0;
        let total_conformi = 0, total_deliberati = 0;
        for (const w of weeks) {
          if (!w) continue;
          total_pezzi_reali  += w.pezzi_reali;
          total_pezzi_piano  += w.pezzi_piano;
          total_conformi     += w.pezzi_conformi;
          total_deliberati   += w.pezzi_deliberati;
        }

        result.push({ linea_id, nome, weeks, oee_current, oee_prev, total_pezzi_reali, total_pezzi_piano, total_conformi, total_deliberati });
      }

      setLinee(result);
      setError('');
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(weeksParam); }, [fetchData, weeksParam]);

  // ─── Sort ──────────────────────────────────────────────────────────────────

  const sorted = [...linee].sort((a, b) => {
    if (sortBy === 'nome') return a.nome.localeCompare(b.nome);
    if (sortBy === 'prod') {
      const pa = a.total_pezzi_piano > 0 ? a.total_pezzi_reali / a.total_pezzi_piano : 0;
      const pb = b.total_pezzi_piano > 0 ? b.total_pezzi_reali / b.total_pezzi_piano : 0;
      return pa - pb; // peggio in cima
    }
    if (sortBy === 'scrap') {
      const sa = a.total_deliberati > 0 ? (a.total_deliberati - a.total_conformi) / a.total_deliberati : 0;
      const sb = b.total_deliberati > 0 ? (b.total_deliberati - b.total_conformi) / b.total_deliberati : 0;
      return sb - sa; // peggio in cima
    }
    // default: oee peggio in cima
    if (a.oee_current == null && b.oee_current == null) return 0;
    if (a.oee_current == null) return -1;
    if (b.oee_current == null) return 1;
    return a.oee_current - b.oee_current;
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="text-sm text-gray-400 py-16 text-center">Caricamento…</div>;
  if (error)   return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-10 text-center">{error}</div>;

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Tendenze settimanali</h1>
          <p className="text-xs text-gray-400 mt-0.5">OEE · Produzione vs piano · Qualità — aggregati per settimana</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Settimane:</span>
          {[4, 8, 12, 26].map(w => (
            <button
              key={w}
              onClick={() => { setWeeksParam(w); setExpanded(null); }}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                weeksParam === w
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{w}s</button>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden p-0">

        {/* Column headers */}
        <div className="grid grid-cols-[minmax(120px,1fr)_100px_100px_minmax(160px,2fr)_minmax(120px,1.5fr)_minmax(120px,1.5fr)] gap-x-4 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
          <button onClick={() => setSortBy('nome')} className={`text-left hover:text-gray-700 transition-colors ${sortBy === 'nome' ? 'text-blue-600' : ''}`}>
            Linea {sortBy === 'nome' ? '↑' : ''}
          </button>
          <button onClick={() => setSortBy('oee')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'oee' ? 'text-blue-600' : ''}`}>
            OEE {sortBy === 'oee' ? '↑' : ''}
          </button>
          <div className="text-right">Delta</div>
          <div className="text-center">Ultime {weeksParam} settimane</div>
          <button onClick={() => setSortBy('prod')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'prod' ? 'text-blue-600' : ''}`}>
            Produzione {sortBy === 'prod' ? '↑' : ''}
          </button>
          <button onClick={() => setSortBy('scrap')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'scrap' ? 'text-blue-600' : ''}`}>
            Qualità {sortBy === 'scrap' ? '↑' : ''}
          </button>
        </div>

        {/* Week date labels */}
        <div className="grid grid-cols-[minmax(120px,1fr)_100px_100px_minmax(160px,2fr)_minmax(120px,1.5fr)_minmax(120px,1.5fr)] gap-x-4 px-4 py-1.5 border-b border-gray-100 bg-gray-50">
          <div /><div /><div />
          <div className="flex gap-0.5">
            {allWeeks.map(ws => (
              <div key={ws} className="w-5 text-center text-[9px] text-gray-400 leading-tight overflow-hidden">
                {fmtWeek(ws).split('/')[0]}
                <br />
                {fmtWeek(ws).split('/')[1]}
              </div>
            ))}
          </div>
          <div /><div />
        </div>

        {/* Rows */}
        {sorted.map((l, rank) => {
          const delta = l.oee_current != null && l.oee_prev != null
            ? +(l.oee_current - l.oee_prev).toFixed(1)
            : null;
          const scrap = l.total_deliberati > 0
            ? l.total_deliberati - l.total_conformi
            : null;
          const isExpanded = expanded === l.linea_id;

          return (
            <div key={l.linea_id} className="border-b border-gray-50 last:border-b-0">

              {/* Main row */}
              <div
                onClick={() => setExpanded(isExpanded ? null : l.linea_id)}
                className="grid grid-cols-[minmax(120px,1fr)_100px_100px_minmax(160px,2fr)_minmax(120px,1.5fr)_minmax(120px,1.5fr)] gap-x-4 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors items-center"
              >
                {/* Linea */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-300 w-5 shrink-0 text-right">{rank + 1}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{l.nome}</span>
                  {isExpanded && <span className="text-gray-300 text-xs">▲</span>}
                </div>

                {/* OEE */}
                <div className="text-right">
                  <span className={`text-base font-bold ${oeeTextColor(l.oee_current)}`}>
                    {l.oee_current != null ? `${l.oee_current.toFixed(1)}%` : '—'}
                  </span>
                </div>

                {/* Delta */}
                <div className="text-right">
                  {delta != null ? (
                    <span className={`text-xs font-semibold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {delta > 0 ? '▲' : delta < 0 ? '▼' : '●'} {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>

                {/* Week blocks */}
                <div className="flex gap-0.5 items-center">
                  {l.weeks.map((w, i) => (
                    <div
                      key={i}
                      title={w ? `${fmtWeek(allWeeks[i])}: OEE ${w.oee_avg?.toFixed(1) ?? '—'}%` : `${fmtWeek(allWeeks[i])}: nessun dato`}
                      className={`w-5 h-5 rounded-sm shrink-0 ${oeeBlockColor(w?.oee_avg ?? null)}`}
                    />
                  ))}
                </div>

                {/* Produzione */}
                <div className="text-right space-y-1">
                  <div className="text-sm font-semibold text-gray-800">
                    {l.total_pezzi_reali.toLocaleString('it-IT')}
                    {l.total_pezzi_piano > 0 && (
                      <span className="text-xs text-gray-400 font-normal"> / {l.total_pezzi_piano.toLocaleString('it-IT')}</span>
                    )}
                  </div>
                  {l.total_pezzi_piano > 0 && (
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${prodBarColor(l.total_pezzi_reali, l.total_pezzi_piano)}`}
                        style={{ width: `${Math.min(100, pct(l.total_pezzi_reali, l.total_pezzi_piano))}%` }}
                      />
                    </div>
                  )}
                  {l.total_pezzi_piano > 0 && (
                    <p className="text-[10px] text-gray-400">{pct(l.total_pezzi_reali, l.total_pezzi_piano)}% del piano</p>
                  )}
                </div>

                {/* Qualità */}
                <div className="text-right">
                  {l.total_deliberati > 0 ? (
                    <>
                      <p className={`text-sm font-semibold ${scrapColor(l.total_conformi, l.total_deliberati)}`}>
                        {scrap! > 0 ? `${scrap} scrap` : 'Nessuno scrap'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {l.total_conformi.toLocaleString('it-IT')} OK / {l.total_deliberati.toLocaleString('it-IT')} deliberati
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {((l.total_deliberati - l.total_conformi) / l.total_deliberati * 100).toFixed(1)}% scrap
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-gray-300">Nessun dato delibera</span>
                  )}
                </div>
              </div>

              {/* Expanded chart */}
              {isExpanded && <LineaDetailChart linea={l} allWeeks={allWeeks} />}
            </div>
          );
        })}

        {sorted.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile per il periodo selezionato</p>
        )}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
        <span className="font-medium text-gray-500">OEE:</span>
        {[
          { color: 'bg-green-500', label: `≥${OEE_TARGET}%` },
          { color: 'bg-yellow-400', label: '65–79%' },
          { color: 'bg-orange-400', label: '50–64%' },
          { color: 'bg-red-500',    label: '<50%' },
          { color: 'bg-gray-100 border border-gray-200',   label: 'Nessun dato' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm inline-block ${color}`} />
            {label}
          </span>
        ))}
        <span className="ml-2 text-gray-300">· Click su una riga per aprire il grafico dettagliato</span>
      </div>

    </div>
  );
}
