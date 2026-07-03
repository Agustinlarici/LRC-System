'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const OEE_TARGET  = 80;
const DAY_OPTIONS = [30, 60, 90, 180];
const MA_WINDOW   = 7; // moving-average window, in days

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayRow {
  linea_id:          number;
  nome:              string;
  data:              string; // YYYY-MM-DD
  pezzi_reali:       number;
  pezzi_pianificati: number;
  pezzi_deliberati:  number;
  pezzi_conformi:    number;
  minuti_turno:      number;
  minuti_fermo:      number;
  fermi_count:       number;
  disponibilita:     number | null;
  performance:       number | null;
  qualita:           number | null;
  oee:               number | null;
}

interface PlantDay {
  data:              string;
  pezzi_reali:       number;
  pezzi_pianificati: number;
  pezzi_conformi:    number;
  pezzi_deliberati:  number;
  minuti_turno:      number;
  minuti_fermo:      number;
  disponibilita:     number | null;
  performance:       number | null;
  qualita:           number | null;
  oee:               number | null;
}

interface LineaTrend {
  linea_id:           number;
  nome:               string;
  days:               (DayRow | null)[];
  oee_recent:         number | null;
  oee_prev:           number | null;
  avg_disponibilita:  number | null;
  total_pezzi_reali:  number;
  total_pezzi_piano:  number;
  total_conformi:     number;
  total_deliberati:   number;
}

interface ParetoReason { reason_id: number; descrizione: string; categoria: string; colore: string; minuti_totali: number; eventi_count: number; }
interface ParetoLinea  { linea_id: number; nome: string; minuti_totali: number; eventi_count: number; }
interface ParetoData   { days: number; by_reason: ParetoReason[]; by_linea: ParetoLinea[]; }

interface FilterOptions {
  linee:      { id: number; nome: string }[];
  modelli:    string[];
  componenti: string[];
  combos:     { linea_id: number; modello: string; componente: string }[];
}

interface ProdModelRow {
  linea_id: number; nome: string; modello: string; componente: string; data: string; pezzi_reali: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function oeeTextColor(oee: number | null): string {
  if (oee == null)         return 'text-gray-400';
  if (oee >= OEE_TARGET)   return 'text-green-600';
  if (oee >= 65)           return 'text-yellow-500';
  return 'text-red-600';
}

function ratioTextColor(pctVal: number | null): string {
  if (pctVal == null)  return 'text-gray-400';
  if (pctVal >= 90)     return 'text-green-600';
  if (pctVal >= 70)     return 'text-yellow-500';
  return 'text-red-600';
}

function scrapTextColor(conformi: number, deliberati: number): string {
  if (deliberati === 0) return 'text-gray-400';
  const scrapPct = (deliberati - conformi) / deliberati * 100;
  if (scrapPct <= 3)  return 'text-green-600';
  if (scrapPct <= 7)  return 'text-yellow-500';
  return 'text-red-600';
}

function fmtDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

function fmtHours(minuti: number): string {
  const h = minuti / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

function periodAvg(rows: DayRow[]): number | null {
  const withOee = rows.filter(r => r.oee != null);
  if (withOee.length === 0) return null;
  return withOee.reduce((s, r) => s + (r.oee as number), 0) / withOee.length;
}

// Aggregate raw counts across lines per day — correct way to build a plant-wide
// OEE (never average pre-computed percentages across lines).
function buildPlantDays(allDays: string[], rows: DayRow[]): PlantDay[] {
  const acc = new Map<string, { reali: number; piano: number; conformi: number; deliberati: number; turno: number; fermo: number }>();
  for (const ds of allDays) acc.set(ds, { reali: 0, piano: 0, conformi: 0, deliberati: 0, turno: 0, fermo: 0 });
  for (const r of rows) {
    const a = acc.get(r.data);
    if (!a) continue;
    a.reali      += r.pezzi_reali;
    a.piano      += r.pezzi_pianificati;
    a.conformi   += r.pezzi_conformi;
    a.deliberati += r.pezzi_deliberati;
    a.turno      += r.minuti_turno;
    a.fermo      += r.minuti_fermo;
  }
  return allDays.map(ds => {
    const a = acc.get(ds)!;
    const disponibilita = a.turno > 0 ? Math.max(0, Math.min(1, (a.turno - a.fermo) / a.turno)) : null;
    const performance    = a.piano > 0 ? Math.min(1, a.reali / a.piano) : null;
    const qualita         = a.deliberati > 0 ? a.conformi / a.deliberati : null;
    const hasData = a.reali > 0 && disponibilita != null && performance != null;
    const oee = hasData ? disponibilita! * performance! * (qualita ?? 1) * 100 : null;
    return {
      data: ds,
      pezzi_reali: a.reali, pezzi_pianificati: a.piano,
      pezzi_conformi: a.conformi, pezzi_deliberati: a.deliberati,
      minuti_turno: a.turno, minuti_fermo: a.fermo,
      disponibilita: disponibilita != null ? disponibilita * 100 : null,
      performance:   performance   != null ? performance   * 100 : null,
      qualita:       qualita       != null ? qualita        * 100 : null,
      oee,
    };
  });
}

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    if (slice.length === 0) return null;
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function topReasonsWithOther(reasons: ParetoReason[], topN: number): ParetoReason[] {
  const sorted = [...reasons].sort((a, b) => b.minuti_totali - a.minuti_totali);
  const top    = sorted.slice(0, topN);
  const rest   = sorted.slice(topN);
  const restMin = rest.reduce((s, r) => s + r.minuti_totali, 0);
  const restEv  = rest.reduce((s, r) => s + r.eventi_count, 0);
  if (restMin > 0) top.push({ reason_id: -1, descrizione: 'Altri motivi', categoria: '', colore: '#cbd5e1', minuti_totali: restMin, eventi_count: restEv });
  return top;
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function SeriesTooltip({ active, payload, label, suffix }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; suffix: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value != null ? `${p.value.toLocaleString('it-IT', { maximumFractionDigits: 1 })}${suffix}` : '—'}
        </p>
      ))}
    </div>
  );
}

function ParetoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ParetoReason }> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1 max-w-[220px]">
      <p className="font-medium text-gray-700">{r.descrizione}</p>
      {r.categoria && <p className="text-gray-400">{r.categoria}</p>}
      <p className="text-gray-600">{fmtHours(r.minuti_totali)} persi · {r.eventi_count} {r.eventi_count === 1 ? 'evento' : 'eventi'}</p>
    </div>
  );
}

// ─── Multi-select filter dropdown ──────────────────────────────────────────────

function MultiSelectFilter<T extends string | number>({
  label, options, selected, onChange, optionLabel,
}: {
  label: string;
  options: T[];
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  optionLabel?: (opt: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const toggle = (opt: T) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1 text-xs rounded-lg font-medium border transition-colors ${
          selected.size > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {label}{selected.size > 0 ? ` (${selected.size})` : ''}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-64 overflow-auto min-w-[200px]">
          {selected.size > 0 && (
            <button onClick={() => onChange(new Set())} className="text-xs text-blue-600 hover:text-blue-800 mb-1 px-2">
              Cancella filtro
            </button>
          )}
          {options.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">Nessuna opzione</p>}
          {options.map(opt => (
            <label key={String(opt)} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} className="accent-blue-600" />
              {optionLabel ? optionLabel(opt) : String(opt)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sparkline — compact per-line OEE trend for the detail table ──────────────

function Sparkline({ days }: { days: (DayRow | null)[] }) {
  const data = days.map((d, i) => ({ i, oee: d?.oee ?? null }));
  return (
    <ResponsiveContainer width="100%" height={28}>
      <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <ReferenceLine y={OEE_TARGET} stroke="#16a34a" strokeDasharray="2 2" strokeWidth={1} />
        <Line type="monotone" dataKey="oee" stroke="#2563eb" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Per-line daily detail chart (drill-down) ──────────────────────────────────

function LineaDetailChart({ linea, allDays }: { linea: LineaTrend; allDays: string[] }) {
  const chartData = allDays.map((ds, i) => {
    const d = linea.days[i];
    return {
      day:           fmtDay(ds),
      OEE:           d?.oee           ?? null,
      Disponibilità: d?.disponibilita ?? null,
      Performance:   d?.performance   ?? null,
    };
  });
  const tickInterval = Math.max(0, Math.ceil(allDays.length / 14) - 1);

  return (
    <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <Tooltip content={<SeriesTooltip suffix="%" />} />
          <ReferenceLine y={OEE_TARGET} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1.5} />
          <Line type="monotone" dataKey="OEE" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="Disponibilità" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="Performance" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-gray-400 mt-1 pl-2">
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> OEE</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ borderTop: '2px dashed #f59e0b' }} /> Disponibilità</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ borderTop: '2px dashed #8b5cf6' }} /> Performance</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TrendsPage() {
  const [daysParam, setDaysParam] = useState(60);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [dayRows,   setDayRows]   = useState<DayRow[]>([]);
  const [allDays,   setAllDays]   = useState<string[]>([]);
  const [pareto,    setPareto]    = useState<ParetoData | null>(null);
  const [prodModel, setProdModel] = useState<ProdModelRow[]>([]);
  const [expanded,  setExpanded]  = useState<number | null>(null);
  const [sortBy,    setSortBy]    = useState<'oee' | 'nome' | 'prod' | 'scrap'>('oee');

  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [selLinee,      setSelLinee]      = useState<Set<number>>(new Set());
  const [selModelli,    setSelModelli]    = useState<Set<string>>(new Set());
  const [selComponenti, setSelComponenti] = useState<Set<string>>(new Set());

  // Load filter options once
  useEffect(() => {
    fetch(`${BACKEND}/api/dashboards/filter-options`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (json) setFilterOptions(json); })
      .catch(() => {});
  }, []);

  // Lines implied by the modello/componente selection, intersected with the explicit línea filter
  const effectiveLineaIds = useMemo<number[] | null>(() => {
    if (!filterOptions) return null;
    if (selLinee.size === 0 && selModelli.size === 0 && selComponenti.size === 0) return null;
    let ids = new Set(filterOptions.linee.map(l => l.id));
    if (selLinee.size > 0) ids = new Set([...ids].filter(id => selLinee.has(id)));
    if (selModelli.size > 0 || selComponenti.size > 0) {
      const matching = new Set(
        filterOptions.combos
          .filter(c => (selModelli.size === 0 || selModelli.has(c.modello)) && (selComponenti.size === 0 || selComponenti.has(c.componente)))
          .map(c => c.linea_id)
      );
      ids = new Set([...ids].filter(id => matching.has(id)));
    }
    return [...ids];
  }, [filterOptions, selLinee, selModelli, selComponenti]);

  const modelFilterActive = selModelli.size > 0 || selComponenti.size > 0;

  // Most lines make exactly one modello/componente combo, so filtering by model
  // is effectively a line filter and OEE/disponibilità ARE valid for that model.
  // Only warn when a *selected* line actually handles more than one combo.
  const hasAmbiguousLines = useMemo(() => {
    if (!filterOptions || !effectiveLineaIds) return false;
    const countByLine = new Map<number, number>();
    for (const c of filterOptions.combos) countByLine.set(c.linea_id, (countByLine.get(c.linea_id) ?? 0) + 1);
    return effectiveLineaIds.some(id => (countByLine.get(id) ?? 0) > 1);
  }, [filterOptions, effectiveLineaIds]);

  const fetchData = useCallback(async (days: number, lineaIds: number[] | null, modelli: Set<string>, componenti: Set<string>) => {
    setLoading(true);
    try {
      const lineaParam = lineaIds && lineaIds.length > 0 ? `&linea_ids=${lineaIds.join(',')}` : '';
      const modelParam = modelli.size    > 0 ? `&modelli=${[...modelli].map(encodeURIComponent).join(',')}`       : '';
      const compParam  = componenti.size > 0 ? `&componenti=${[...componenti].map(encodeURIComponent).join(',')}` : '';

      const [oeeRes, paretoRes, prodModelRes] = await Promise.all([
        fetch(`${BACKEND}/api/dashboards/daily-oee?days=${days}${lineaParam}`,                       { credentials: 'include' }),
        fetch(`${BACKEND}/api/dashboards/stop-pareto?days=${days}${lineaParam}`,                     { credentials: 'include' }),
        fetch(`${BACKEND}/api/dashboards/daily-production-by-model?days=${days}${lineaParam}${modelParam}${compParam}`, { credentials: 'include' }),
      ]);
      if (!oeeRes.ok || !paretoRes.ok || !prodModelRes.ok) throw new Error('fetch failed');
      const oeeJson:      { days: number; data: DayRow[] }      = await oeeRes.json();
      const paretoJson:   ParetoData                             = await paretoRes.json();
      const prodModelJson:{ days: number; data: ProdModelRow[] } = await prodModelRes.json();

      const daySet = new Set(oeeJson.data.map(r => r.data));
      setAllDays(Array.from(daySet).sort());
      setDayRows(oeeJson.data);
      setPareto(paretoJson);
      setProdModel(prodModelJson.data);
      setError('');
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(daysParam, effectiveLineaIds, selModelli, selComponenti);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, daysParam, effectiveLineaIds, selModelli, selComponenti]);

  // ─── Per-line trends (for the drill-down table) ───────────────────────────

  const linee = useMemo<LineaTrend[]>(() => {
    const byLine = new Map<number, { nome: string; map: Map<string, DayRow> }>();
    for (const row of dayRows) {
      if (!byLine.has(row.linea_id)) byLine.set(row.linea_id, { nome: row.nome, map: new Map() });
      byLine.get(row.linea_id)!.map.set(row.data, row);
    }
    const result: LineaTrend[] = [];
    for (const [linea_id, { nome, map }] of byLine) {
      const days = allDays.map(ds => map.get(ds) ?? null);
      const withData = days.filter((d): d is DayRow => d != null && d.oee != null);
      const last14  = withData.slice(-14);
      const recent7 = last14.slice(-7);
      const prev7   = last14.slice(0, Math.max(0, last14.length - 7));
      let total_pezzi_reali = 0, total_pezzi_piano = 0, total_conformi = 0, total_deliberati = 0;
      const dispValues: number[] = [];
      for (const d of days) {
        if (!d) continue;
        total_pezzi_reali += d.pezzi_reali;
        total_pezzi_piano += d.pezzi_pianificati;
        total_conformi    += d.pezzi_conformi;
        total_deliberati  += d.pezzi_deliberati;
        if (d.disponibilita != null) dispValues.push(d.disponibilita);
      }
      result.push({
        linea_id, nome, days,
        oee_recent: periodAvg(recent7),
        oee_prev:   prev7.length > 0 ? periodAvg(prev7) : null,
        avg_disponibilita: dispValues.length > 0 ? dispValues.reduce((s, v) => s + v, 0) / dispValues.length : null,
        total_pezzi_reali, total_pezzi_piano, total_conformi, total_deliberati,
      });
    }
    return result;
  }, [dayRows, allDays]);

  // ─── Plant-wide daily aggregate + moving average ──────────────────────────

  const plantDays = useMemo(() => buildPlantDays(allDays, dayRows), [allDays, dayRows]);
  const oeeMA     = useMemo(() => movingAverage(plantDays.map(p => p.oee), MA_WINDOW), [plantDays]);

  const mainChartData = useMemo(() => plantDays.map((p, i) => ({
    day: fmtDay(p.data), OEE: p.oee, [`Media mobile ${MA_WINDOW}gg`]: oeeMA[i],
  })), [plantDays, oeeMA]);

  const decompChartData = useMemo(() => plantDays.map(p => ({
    day: fmtDay(p.data), Disponibilità: p.disponibilita, Performance: p.performance, Qualità: p.qualita,
  })), [plantDays]);

  // Production reale: use the model-filtered piece count when a modello/componente
  // filter is active (exact match), otherwise the line-level total from daily-oee.
  const modelDailyReale = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of prodModel) map.set(r.data, (map.get(r.data) ?? 0) + r.pezzi_reali);
    return map;
  }, [prodModel]);

  const cumChartData = useMemo(() => {
    let cumReale = 0, cumPiano = 0;
    return plantDays.map(p => {
      const reale = modelFilterActive ? (modelDailyReale.get(p.data) ?? 0) : p.pezzi_reali;
      cumReale += reale;
      cumPiano += p.pezzi_pianificati;
      return { day: fmtDay(p.data), Reale: cumReale, Piano: cumPiano };
    });
  }, [plantDays, modelDailyReale, modelFilterActive]);

  const tickInterval = Math.max(0, Math.ceil(allDays.length / 14) - 1);

  // ─── Headline KPIs (plant-wide, over the whole selected period) ───────────

  const headline = useMemo(() => {
    const withOee = plantDays.filter(p => p.oee != null);
    const last14  = withOee.slice(-14);
    const recent7 = last14.slice(-7);
    const prev7   = last14.slice(0, Math.max(0, last14.length - 7));
    const oeeAvg  = (rows: PlantDay[]) => rows.length === 0 ? null : rows.reduce((s, r) => s + (r.oee as number), 0) / rows.length;

    const totReale = modelFilterActive
      ? prodModel.reduce((s, r) => s + r.pezzi_reali, 0)
      : plantDays.reduce((s, p) => s + p.pezzi_reali, 0);
    const totPiano = plantDays.reduce((s, p) => s + p.pezzi_pianificati, 0);
    const totConf  = plantDays.reduce((s, p) => s + p.pezzi_conformi, 0);
    const totDelib = plantDays.reduce((s, p) => s + p.pezzi_deliberati, 0);
    const totFermo = plantDays.reduce((s, p) => s + p.minuti_fermo, 0);

    return {
      oee_recent: oeeAvg(recent7),
      oee_prev:   prev7.length > 0 ? oeeAvg(prev7) : null,
      prod_pct:   totPiano > 0 ? pct(totReale, totPiano) : null,
      totReale, totPiano,
      scrap_pct:  totDelib > 0 ? +((totDelib - totConf) / totDelib * 100).toFixed(1) : null,
      totFermo,
    };
  }, [plantDays, prodModel, modelFilterActive]);

  const paretoTop = useMemo(() => pareto ? topReasonsWithOther(pareto.by_reason, 8) : [], [pareto]);
  const topLinee  = useMemo(() => pareto ? [...pareto.by_linea].sort((a, b) => b.minuti_totali - a.minuti_totali).slice(0, 6) : [], [pareto]);
  const maxLineaMinuti = topLinee.length > 0 ? topLinee[0].minuti_totali : 1;

  const prodByModello = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of prodModel) map.set(r.modello, (map.get(r.modello) ?? 0) + r.pezzi_reali);
    return [...map.entries()].map(([modello, pezzi]) => ({ modello, pezzi })).sort((a, b) => b.pezzi - a.pezzi).slice(0, 8);
  }, [prodModel]);
  const maxModelloPezzi = prodByModello.length > 0 ? prodByModello[0].pezzi : 1;

  // ─── Sort (drill-down table) ───────────────────────────────────────────────

  const sorted = [...linee].sort((a, b) => {
    if (sortBy === 'nome') return a.nome.localeCompare(b.nome);
    if (sortBy === 'prod') {
      const pa = a.total_pezzi_piano > 0 ? a.total_pezzi_reali / a.total_pezzi_piano : 0;
      const pb = b.total_pezzi_piano > 0 ? b.total_pezzi_reali / b.total_pezzi_piano : 0;
      return pa - pb;
    }
    if (sortBy === 'scrap') {
      const sa = a.total_deliberati > 0 ? (a.total_deliberati - a.total_conformi) / a.total_deliberati : 0;
      const sb = b.total_deliberati > 0 ? (b.total_deliberati - b.total_conformi) / b.total_deliberati : 0;
      return sb - sa;
    }
    if (a.oee_recent == null && b.oee_recent == null) return 0;
    if (a.oee_recent == null) return -1;
    if (b.oee_recent == null) return 1;
    return a.oee_recent - b.oee_recent;
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading && dayRows.length === 0) return <div className="text-sm text-gray-400 py-16 text-center">Caricamento…</div>;
  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-10 text-center">{error}</div>;

  const headlineDelta = headline.oee_recent != null && headline.oee_prev != null
    ? +(headline.oee_recent - headline.oee_prev).toFixed(1) : null;

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Tendenze di produzione</h1>
          <p className="text-xs text-gray-400 mt-0.5">Andamento dello stabilimento giorno per giorno — OEE, produzione, qualità e fermate</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Giorni:</span>
          {DAY_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => { setDaysParam(n); setExpanded(null); }}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                daysParam === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{n}g</button>
          ))}
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Filtri:</span>
        <MultiSelectFilter
          label="Linea"
          options={filterOptions?.linee.map(l => l.id) ?? []}
          selected={selLinee}
          onChange={setSelLinee}
          optionLabel={id => filterOptions?.linee.find(l => l.id === id)?.nome ?? String(id)}
        />
        <MultiSelectFilter label="Modello" options={filterOptions?.modelli ?? []} selected={selModelli} onChange={setSelModelli} />
        <MultiSelectFilter label="Componente" options={filterOptions?.componenti ?? []} selected={selComponenti} onChange={setSelComponenti} />
        {(selLinee.size > 0 || selModelli.size > 0 || selComponenti.size > 0) && (
          <button
            onClick={() => { setSelLinee(new Set()); setSelModelli(new Set()); setSelComponenti(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Rimuovi tutti i filtri
          </button>
        )}
        {loading && <span className="text-xs text-gray-400">Aggiornamento…</span>}
      </div>
      {modelFilterActive && hasAmbiguousLines && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          Una o più linee selezionate producono più di un modello/componente: per quelle linee OEE, disponibilità e piano restano a livello linea (non scomposti per modello). I pezzi reali prodotti riflettono comunque esattamente il filtro selezionato.
        </p>
      )}

      {/* ── Headline KPI strip ─────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-gray-100 lg:divide-y-0 lg:divide-x">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">OEE stabilimento (7gg)</p>
            <p className={`text-4xl font-semibold leading-none mt-2 ${oeeTextColor(headline.oee_recent)}`}>
              {headline.oee_recent != null ? `${headline.oee_recent.toFixed(1)}%` : '—'}
            </p>
            <p className="text-xs mt-2">
              {headlineDelta != null ? (
                <span className={headlineDelta > 0 ? 'text-green-600' : headlineDelta < 0 ? 'text-red-500' : 'text-gray-400'}>
                  {headlineDelta > 0 ? '▲' : headlineDelta < 0 ? '▼' : '●'} {headlineDelta > 0 ? '+' : ''}{headlineDelta.toFixed(1)}% vs 7gg prec.
                </span>
              ) : <span className="text-gray-400">dati insufficienti</span>}
            </p>
          </div>
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Produzione (periodo)</p>
            <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">
              {headline.prod_pct != null ? `${headline.prod_pct}%` : '—'}
              <span className="text-lg font-medium text-gray-400"> del piano</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {headline.totReale.toLocaleString('it-IT')} / {headline.totPiano.toLocaleString('it-IT')} pezzi
            </p>
          </div>
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Scrap (periodo)</p>
            <p className={`text-4xl font-semibold leading-none mt-2 ${
              headline.scrap_pct == null ? 'text-gray-300' : headline.scrap_pct <= 3 ? 'text-green-600' : headline.scrap_pct <= 7 ? 'text-yellow-500' : 'text-red-600'
            }`}>
              {headline.scrap_pct != null ? `${headline.scrap_pct}%` : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-2">quota pezzi non conformi</p>
          </div>
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Tempo perso (periodo)</p>
            <p className="text-4xl font-semibold leading-none mt-2 text-gray-900">{fmtHours(headline.totFermo)}</p>
            <p className="text-xs text-gray-400 mt-2">somma fermate sulle linee filtrate</p>
          </div>
        </div>
      </div>

      {/* ── Main trend: daily OEE + moving average ────────────────────── */}
      <div className="card">
        <p className="text-base font-medium text-gray-700 mb-1">Andamento OEE — stabilimento</p>
        <p className="text-xs text-gray-400 mb-2">Punti: OEE giornaliero. Linea blu: media mobile {MA_WINDOW} giorni.</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={mainChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 10, fill: '#9ca3af' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
            <Tooltip content={<SeriesTooltip suffix="%" />} />
            <ReferenceLine y={OEE_TARGET} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `${OEE_TARGET}%`, fontSize: 9, fill: '#16a34a', position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="OEE" stroke="#93c5fd" strokeWidth={1.5} dot={{ r: 2, fill: '#3b82f6' }} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey={`Media mobile ${MA_WINDOW}gg`} stroke="#1d4ed8" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Two-panel: cumulative S-curve + OEE decomposition ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-1">Produzione cumulata — reale vs piano</p>
          <p className="text-xs text-gray-400 mb-2">Se la linea blu cade sotto la grigia, si sta accumulando ritardo sul piano.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cumChartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<SeriesTooltip suffix=" pz" />} />
              <Line type="monotone" dataKey="Piano" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Reale" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-1">Scomposizione OEE</p>
          <p className="text-xs text-gray-400 mb-2">Quale dei 3 fattori sta trascinando giù l&apos;OEE.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={decompChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<SeriesTooltip suffix="%" />} />
              <Line type="monotone" dataKey="Disponibilità" stroke="#f59e0b" strokeWidth={1.75} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Performance" stroke="#8b5cf6" strokeWidth={1.75} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Qualità" stroke="#10b981" strokeWidth={1.75} dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Downtime Pareto + Produzione per modello ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <p className="text-base font-medium text-gray-700 mb-1">Fermate per motivo</p>
          <p className="text-xs text-gray-400 mb-2">Dove intervenire prima: i motivi che hanno rubato più tempo nel periodo.</p>
          {paretoTop.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, paretoTop.length * 32)}>
              <BarChart data={paretoTop} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} unit="m" />
                <YAxis type="category" dataKey="descrizione" width={150} tick={{ fontSize: 11, fill: '#374151' }} />
                <Tooltip content={<ParetoTooltip />} />
                <Bar dataKey="minuti_totali" radius={[0, 4, 4, 0]}>
                  {paretoTop.map((r, i) => <Cell key={i} fill={r.colore} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">Nessuna fermata registrata nel periodo</p>
          )}
        </div>

        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-1">Produzione per modello</p>
          <p className="text-xs text-gray-400 mb-3">Pezzi reali totali nel periodo, per modello.</p>
          {prodByModello.length > 0 ? (
            <div className="space-y-2.5">
              {prodByModello.map(m => (
                <div key={m.modello} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 truncate w-16 shrink-0">{m.modello}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
                    <div className="h-2 rounded-full bg-blue-400" style={{ width: `${pct(m.pezzi, maxModelloPezzi)}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 shrink-0 w-12 text-right">{m.pezzi.toLocaleString('it-IT')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dato</p>
          )}
        </div>
      </div>

      {/* ── Linee più colpite dalle fermate ────────────────────────────── */}
      {topLinee.length > 0 && (
        <div className="card">
          <p className="text-base font-medium text-gray-700 mb-1">Linee più colpite dalle fermate</p>
          <p className="text-xs text-gray-400 mb-3">Minuti persi totali per linea nel periodo.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
            {topLinee.map((l, i) => (
              <div key={l.linea_id} className="flex items-center gap-2">
                <span className="text-xs text-gray-300 w-4 shrink-0 text-right">{i + 1}</span>
                <span className="text-sm text-gray-700 truncate w-28 shrink-0">{l.nome}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
                  <div className="h-2 rounded-full bg-red-400" style={{ width: `${pct(l.minuti_totali, maxLineaMinuti)}%` }} />
                </div>
                <span className="text-xs text-gray-500 shrink-0 w-10 text-right">{fmtHours(l.minuti_totali)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per-line drill-down table ──────────────────────────────────── */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-600">Dettaglio per linea</p>
        </div>
        <div className="grid grid-cols-[minmax(110px,1fr)_90px_90px_minmax(110px,1.2fr)_80px_90px_100px] gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <button onClick={() => setSortBy('nome')} className={`text-left hover:text-gray-700 transition-colors ${sortBy === 'nome' ? 'text-blue-600' : ''}`}>
            Linea {sortBy === 'nome' ? '↑' : ''}
          </button>
          <button onClick={() => setSortBy('oee')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'oee' ? 'text-blue-600' : ''}`}>
            OEE (7gg) {sortBy === 'oee' ? '↑' : ''}
          </button>
          <div className="text-right">Δ 7gg</div>
          <div className="text-center">Andamento</div>
          <div className="text-right">Disp.</div>
          <button onClick={() => setSortBy('prod')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'prod' ? 'text-blue-600' : ''}`}>
            Prod. {sortBy === 'prod' ? '↑' : ''}
          </button>
          <button onClick={() => setSortBy('scrap')} className={`text-right hover:text-gray-700 transition-colors ${sortBy === 'scrap' ? 'text-blue-600' : ''}`}>
            Qualità {sortBy === 'scrap' ? '↑' : ''}
          </button>
        </div>

        {sorted.map((l, rank) => {
          const delta = l.oee_recent != null && l.oee_prev != null ? +(l.oee_recent - l.oee_prev).toFixed(1) : null;
          const scrap = l.total_deliberati > 0 ? l.total_deliberati - l.total_conformi : null;
          const prodPct = l.total_pezzi_piano > 0 ? pct(l.total_pezzi_reali, l.total_pezzi_piano) : null;
          const isExpanded = expanded === l.linea_id;

          return (
            <div key={l.linea_id} className="border-b border-gray-50 last:border-b-0">
              <div
                onClick={() => setExpanded(isExpanded ? null : l.linea_id)}
                className="grid grid-cols-[minmax(110px,1fr)_90px_90px_minmax(110px,1.2fr)_80px_90px_100px] gap-x-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors items-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-300 w-5 shrink-0 text-right">{rank + 1}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{l.nome}</span>
                  {isExpanded && <span className="text-gray-300 text-xs">▲</span>}
                </div>

                <div className="text-right">
                  <span className={`text-base font-semibold ${oeeTextColor(l.oee_recent)}`}>
                    {l.oee_recent != null ? `${l.oee_recent.toFixed(1)}%` : '—'}
                  </span>
                </div>

                <div className="text-right">
                  {delta != null ? (
                    <span className={`text-xs font-medium ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {delta > 0 ? '▲' : delta < 0 ? '▼' : '●'} {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                    </span>
                  ) : <span className="text-xs text-gray-300">—</span>}
                </div>

                <div className="min-w-0">
                  <Sparkline days={l.days} />
                </div>

                {/* Disponibilità — text + color, same format as Qualità */}
                <div className="text-right">
                  <span className={`text-sm font-medium ${ratioTextColor(l.avg_disponibilita)}`}>
                    {l.avg_disponibilita != null ? `${l.avg_disponibilita.toFixed(0)}%` : '—'}
                  </span>
                </div>

                {/* Produzione — text + color, same format as Qualità (no bar) */}
                <div className="text-right">
                  <span className={`text-sm font-medium ${ratioTextColor(prodPct)}`}>
                    {prodPct != null ? `${prodPct}%` : '—'}
                  </span>
                  <p className="text-[10px] text-gray-400">{l.total_pezzi_reali.toLocaleString('it-IT')} pz</p>
                </div>

                {/* Qualità — text + color */}
                <div className="text-right">
                  {l.total_deliberati > 0 ? (
                    <>
                      <span className={`text-sm font-medium ${scrapTextColor(l.total_conformi, l.total_deliberati)}`}>
                        {scrap! > 0 ? `${scrap} scrap` : 'OK'}
                      </span>
                      <p className="text-[10px] text-gray-400">{((l.total_deliberati - l.total_conformi) / l.total_deliberati * 100).toFixed(1)}%</p>
                    </>
                  ) : <span className="text-xs text-gray-300">—</span>}
                </div>
              </div>

              {isExpanded && <LineaDetailChart linea={l} allDays={allDays} />}
            </div>
          );
        })}

        {sorted.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile per il periodo/filtri selezionati</p>
        )}
      </div>

    </div>
  );
}
