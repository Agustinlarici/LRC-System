'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import { MultiSelectFilter, SingleSelectFilter } from '@/components/ui/MultiSelectFilter';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const DAY_OPTIONS = [30, 60, 90, 180];
const TOTAL_KEY   = 'Totale';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FaseOption { fase: string; is_delibera: boolean; }
interface FilterOptions { fasi: FaseOption[]; modelli: string[]; componenti: string[]; esiti: string[]; }
interface DailyRow { data: string; esito: string | null; quantita: number; }
interface HourRow  { ora: number; esito: string | null; quantita: number; }
interface ModelloRow    { modello: string;    quantita: number; }
interface ComponenteRow { componente: string; quantita: number; }
interface ModelloComponenteRow { modello: string; componente: string; quantita: number; }

interface QuantitySummary {
  fase: string; days: number; is_delibera: boolean;
  daily: DailyRow[]; today_by_hour: HourRow[];
  by_modello: ModelloRow[]; by_componente: ComponenteRow[];
  today_by_modello_componente: ModelloComponenteRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esitoColor(esito: string): string {
  const s = esito.toLowerCase();
  if (s.includes('accett') || s.includes('conform')) return '#16a34a';
  if (s.includes('respint') || s.includes('scart') || s.includes('rigett')) return '#dc2626';
  return '#f59e0b';
}

function fmtDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

// Greedy word-wrap for axis labels — keeps them horizontal, split across lines instead of rotated.
function wrapLabel(text: string, maxCharsPerLine = 12): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function WrappedAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const lines = wrapLabel(String(payload?.value ?? ''));
  return (
    <g transform={`translate(${x},${y})`}>
      {lines.map((line, i) => (
        <text key={i} x={0} y={0} dy={13 + i * 14} textAnchor="middle" fontSize={13} fill="#374151">
          {line}
        </text>
      ))}
    </g>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function SingleBarTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-700">{label}: <span className="text-blue-600">{payload[0].value.toLocaleString('it-IT')}</span> pz</p>
    </div>
  );
}

function StackedTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-medium text-gray-700 mb-1">{label} — {total.toLocaleString('it-IT')} pz</p>
      {payload.filter(p => p.value > 0).map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value.toLocaleString('it-IT')}
        </p>
      ))}
    </div>
  );
}

// ─── Ranked bar list (by modello / componente) ─────────────────────────────────

function RankedBars({ rows, labelKey }: { rows: Array<Record<string, unknown>>; labelKey: string }) {
  const max = rows.length > 0 ? (rows[0].quantita as number) : 1;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-sm text-gray-700 truncate w-32 shrink-0">{String(r[labelKey])}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
            <div className="h-2 rounded-full bg-blue-400" style={{ width: `${pct(r.quantita as number, max)}%` }} />
          </div>
          <span className="text-xs text-gray-500 shrink-0 w-14 text-right">{(r.quantita as number).toLocaleString('it-IT')}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuantitaPage() {
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [selFase,       setSelFase]       = useState<string | null>(null);
  const [selModelli,    setSelModelli]    = useState<Set<string>>(new Set());
  const [selComponenti, setSelComponenti] = useState<Set<string>>(new Set());
  const [selEsiti,      setSelEsiti]      = useState<Set<string>>(new Set());
  const [daysParam,     setDaysParam]     = useState(60);

  const [summary, setSummary] = useState<QuantitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Load filter options once, default to the first fase
  useEffect(() => {
    fetch(`${BACKEND}/api/dashboards/quantity-filter-options`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((json: FilterOptions | null) => {
        if (json) {
          setFilterOptions(json);
          if (json.fasi.length > 0) setSelFase(json.fasi[0].fase);
        }
      })
      .catch(() => {});
  }, []);

  const currentFaseIsDelibera = filterOptions?.fasi.find(f => f.fase === selFase)?.is_delibera ?? false;

  // Clear the esito filter when switching to a non-delibera fase
  useEffect(() => {
    if (!currentFaseIsDelibera && selEsiti.size > 0) setSelEsiti(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFaseIsDelibera]);

  const fetchSummary = useCallback(async (fase: string, days: number, modelli: Set<string>, componenti: Set<string>, esiti: Set<string>) => {
    setLoading(true);
    try {
      const modelParam = modelli.size    > 0 ? `&modelli=${[...modelli].map(encodeURIComponent).join(',')}`       : '';
      const compParam  = componenti.size > 0 ? `&componenti=${[...componenti].map(encodeURIComponent).join(',')}` : '';
      const esitoParam = esiti.size      > 0 ? `&esiti=${[...esiti].map(encodeURIComponent).join(',')}`           : '';
      const r = await fetch(
        `${BACKEND}/api/dashboards/quantity-summary?fase=${encodeURIComponent(fase)}&days=${days}${modelParam}${compParam}${esitoParam}`,
        { credentials: 'include' },
      );
      if (!r.ok) throw new Error(`${r.status}`);
      setSummary(await r.json());
      setError('');
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selFase) return;
    fetchSummary(selFase, daysParam, selModelli, selComponenti, selEsiti);
  }, [fetchSummary, selFase, daysParam, selModelli, selComponenti, selEsiti]);

  // Which esito keys to stack, in a stable accepted → rework → rejected order
  const esitoKeys = useMemo(() => {
    if (!currentFaseIsDelibera) return [TOTAL_KEY];
    const all = filterOptions?.esiti ?? [];
    const active = selEsiti.size > 0 ? all.filter(e => selEsiti.has(e)) : all;
    return [...active].sort((a, b) => {
      const rank = (e: string) => esitoColor(e) === '#16a34a' ? 0 : esitoColor(e) === '#f59e0b' ? 1 : 2;
      return rank(a) - rank(b);
    });
  }, [currentFaseIsDelibera, filterOptions, selEsiti]);

  const hourlyChartData = useMemo(() => {
    if (!summary) return [];
    const byHour = new Map<number, Record<string, number>>();
    for (let h = 0; h < 24; h++) byHour.set(h, {});
    for (const r of summary.today_by_hour) {
      const key = currentFaseIsDelibera ? (r.esito ?? 'N/D') : TOTAL_KEY;
      const cur = byHour.get(r.ora) ?? {};
      cur[key] = (cur[key] ?? 0) + r.quantita;
      byHour.set(r.ora, cur);
    }
    return Array.from(byHour.entries()).map(([ora, vals]) => ({ ora: `${ora}:00`, ...vals }));
  }, [summary, currentFaseIsDelibera]);

  const dailyChartData = useMemo(() => {
    if (!summary) return [];
    const byDay = new Map<string, Record<string, number>>();
    for (const r of summary.daily) {
      if (!byDay.has(r.data)) byDay.set(r.data, {});
      const key = currentFaseIsDelibera ? (r.esito ?? 'N/D') : TOTAL_KEY;
      const cur = byDay.get(r.data)!;
      cur[key] = (cur[key] ?? 0) + r.quantita;
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, vals]) => ({ day: fmtDay(data), ...vals }));
  }, [summary, currentFaseIsDelibera]);

  const todayTotal  = summary ? summary.today_by_hour.reduce((s, r) => s + r.quantita, 0) : 0;
  const periodTotal = summary ? summary.daily.reduce((s, r) => s + r.quantita, 0) : 0;

  const todayByEsito = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, number>();
    for (const r of summary.today_by_hour) {
      const key = r.esito ?? 'N/D';
      map.set(key, (map.get(key) ?? 0) + r.quantita);
    }
    return [...map.entries()].sort((a, b) => {
      const rank = (e: string) => esitoColor(e) === '#16a34a' ? 0 : esitoColor(e) === '#f59e0b' ? 1 : 2;
      return rank(a[0]) - rank(b[0]);
    });
  }, [summary]);

  const tickInterval = Math.max(0, Math.ceil(dailyChartData.length / 14) - 1);

  // Today's production grouped by modello, each with its componenti ranked desc
  const todayByModello = useMemo(() => {
    if (!summary) return [];
    const byModello = new Map<string, ComponenteRow[]>();
    for (const r of summary.today_by_modello_componente) {
      const list = byModello.get(r.modello) ?? [];
      list.push({ componente: r.componente, quantita: r.quantita });
      byModello.set(r.modello, list);
    }
    return [...byModello.entries()]
      .map(([modello, componenti]) => ({
        modello,
        componenti: componenti.sort((a, b) => b.quantita - a.quantita),
        totale: componenti.reduce((s, c) => s + c.quantita, 0),
      }))
      .sort((a, b) => b.totale - a.totale);
  }, [summary]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Pezzi Prodotti</h1>
          <p className="text-xs text-gray-400 mt-0.5">Pezzi contati in una fase — oggi e storico, filtrabile per modello/componente/esito</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Giorni:</span>
          {DAY_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => setDaysParam(n)}
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
        <SingleSelectFilter
          label="Fase"
          options={filterOptions?.fasi.map(f => f.fase) ?? []}
          selected={selFase}
          onChange={setSelFase}
        />
        <MultiSelectFilter label="Modello" options={filterOptions?.modelli ?? []} selected={selModelli} onChange={setSelModelli} />
        <MultiSelectFilter label="Componente" options={filterOptions?.componenti ?? []} selected={selComponenti} onChange={setSelComponenti} />
        {currentFaseIsDelibera && (
          <MultiSelectFilter label="Esito" options={filterOptions?.esiti ?? []} selected={selEsiti} onChange={setSelEsiti} />
        )}
        {(selModelli.size > 0 || selComponenti.size > 0 || selEsiti.size > 0) && (
          <button
            onClick={() => { setSelModelli(new Set()); setSelComponenti(new Set()); setSelEsiti(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Rimuovi filtri
          </button>
        )}
        {loading && <span className="text-xs text-gray-400">Aggiornamento…</span>}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-10 text-center">{error}</div>}

      {!error && summary && (
        <>
          {/* ── Today ──────────────────────────────────────────────────── */}
          <div className="card p-0 overflow-hidden">
            <div className={`grid divide-y divide-gray-100 lg:divide-y-0 lg:divide-x ${currentFaseIsDelibera ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 lg:grid-cols-2'}`}>
              <div className="p-5">
                <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Totale oggi</p>
                <p className="text-5xl font-semibold text-gray-900 leading-none mt-2">{todayTotal.toLocaleString('it-IT')}</p>
                <p className="text-xs text-gray-400 mt-2">pezzi in {selFase}</p>
              </div>
              {currentFaseIsDelibera && todayByEsito.map(([esito, qty]) => (
                <div key={esito} className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">{esito}</p>
                  <p className="text-5xl font-semibold leading-none mt-2" style={{ color: esitoColor(esito) }}>
                    {qty.toLocaleString('it-IT')}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">{pct(qty, todayTotal)}% di oggi</p>
                </div>
              ))}
              {!currentFaseIsDelibera && (
                <div className="p-5">
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Periodo ({daysParam}g)</p>
                  <p className="text-5xl font-semibold text-gray-900 leading-none mt-2">{periodTotal.toLocaleString('it-IT')}</p>
                  <p className="text-xs text-gray-400 mt-2">pezzi totali nel periodo selezionato</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Today by hour ──────────────────────────────────────────── */}
          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Andamento di oggi, per ora</p>
            <p className="text-xs text-gray-400 mb-2">Pezzi contati in &quot;{selFase}&quot; per fascia oraria.</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="ora" tick={{ fontSize: 13, fill: '#374151' }} interval={1} />
                <YAxis tick={{ fontSize: 13, fill: '#374151' }} />
                <Tooltip content={<StackedTooltip />} />
                {esitoKeys.map(key => (
                  <Bar key={key} dataKey={key} stackId="a" fill={key === TOTAL_KEY ? '#2563eb' : esitoColor(key)} radius={key === esitoKeys[esitoKeys.length - 1] ? [3, 3, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Today by modello / componente ───────────────────────────── */}
          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Produzione di oggi, per modello e componente</p>
            <p className="text-xs text-gray-400 mb-3">Pezzi contati oggi in &quot;{selFase}&quot; fino ad ora, per ogni componente di ogni modello.</p>
            {todayByModello.length > 0 ? (
              <div className="flex gap-6 overflow-x-auto pb-2">
                {todayByModello.map(({ modello, componenti, totale }) => {
                  const maxLines  = Math.max(1, ...componenti.map(c => wrapLabel(c.componente).length));
                  const axisHeight = 18 + maxLines * 14;
                  return (
                    <div key={modello} className="flex-1 min-w-[260px]">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">{modello}</span>
                        <span className="text-xs text-gray-400">{totale.toLocaleString('it-IT')} pz</span>
                      </div>
                      <ResponsiveContainer width="100%" height={220 + axisHeight}>
                        <BarChart data={componenti} margin={{ top: 20, right: 16, bottom: 8, left: -16 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                          <XAxis
                            dataKey="componente"
                            tick={<WrappedAxisTick />}
                            interval={0}
                            height={axisHeight}
                          />
                          <YAxis tick={{ fontSize: 13, fill: '#374151' }} allowDecimals={false} />
                          <Tooltip content={<SingleBarTooltip />} cursor={{ fill: '#f3f4f6' }} />
                          <Bar dataKey="quantita" fill="#2563eb" radius={[3, 3, 0, 0]}>
                            <LabelList dataKey="quantita" position="top" style={{ fontSize: 12, fill: '#374151', fontWeight: 600 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Nessun pezzo contato oggi</p>
            )}
          </div>

          {/* ── Historical daily ───────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-base font-medium text-gray-700">Storico giornaliero</p>
              <p className="text-sm text-gray-500">{periodTotal.toLocaleString('it-IT')} pz totali nel periodo</p>
            </div>
            <p className="text-xs text-gray-400 mb-2">Pezzi contati in &quot;{selFase}&quot; per giorno, ultimi {daysParam} giorni.</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 13, fill: '#374151' }} />
                <YAxis tick={{ fontSize: 13, fill: '#374151' }} />
                <Tooltip content={<StackedTooltip />} />
                {esitoKeys.map(key => (
                  <Bar key={key} dataKey={key} stackId="a" fill={key === TOTAL_KEY ? '#2563eb' : esitoColor(key)} radius={key === esitoKeys[esitoKeys.length - 1] ? [3, 3, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Breakdown by modello / componente ──────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Per modello</p>
              <p className="text-xs text-gray-400 mb-3">Pezzi totali nel periodo, per modello.</p>
              {summary.by_modello.length > 0
                ? <RankedBars rows={summary.by_modello as unknown as Array<Record<string, unknown>>} labelKey="modello" />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>}
            </div>
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Per componente</p>
              <p className="text-xs text-gray-400 mb-3">Pezzi totali nel periodo, per componente.</p>
              {summary.by_componente.length > 0
                ? <RankedBars rows={summary.by_componente as unknown as Array<Record<string, unknown>>} labelKey="componente" />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
