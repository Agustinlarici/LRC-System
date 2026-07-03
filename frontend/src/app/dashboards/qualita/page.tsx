'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { MultiSelectFilter, SingleSelectFilter } from '@/components/ui/MultiSelectFilter';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const DAY_OPTIONS     = [30, 60, 90, 180];
const QUALITA_TARGET  = 97; // % — stessa soglia usata nel resto del sito
const MA_WINDOW       = 7;

// ─── Types ────────────────────────────────────────────────────────────────────

interface FaseOption { fase: string; is_delibera: boolean; eventi: number; }
interface FilterOptions { fasi: FaseOption[]; modelli: string[]; componenti: string[]; esiti: string[]; }
interface DailyRow { data: string; esito: string | null; quantita: number; }
interface HourRow  { ora: number; esito: string | null; quantita: number; }
interface DimEsitoRow { modello?: string; componente?: string; esito: string | null; quantita: number; }

interface QualitySummary {
  fase: string; days: number; is_delibera: boolean;
  daily: DailyRow[]; today_by_hour: HourRow[];
  by_modello_esito: DimEsitoRow[]; by_componente_esito: DimEsitoRow[];
  today_by_modello_esito: DimEsitoRow[]; today_by_componente_esito: DimEsitoRow[];
}

// ─── Esito classification ──────────────────────────────────────────────────────

function isAccepted(esito: string | null): boolean {
  const s = (esito ?? '').toLowerCase();
  return s.includes('accett') || s.includes('conform');
}
function isRejected(esito: string | null): boolean {
  const s = (esito ?? '').toLowerCase();
  return s.includes('respint') || s.includes('scart') || s.includes('rigett');
}
function esitoColor(esito: string | null): string {
  if (esito == null)     return '#9ca3af';
  if (isAccepted(esito)) return '#16a34a';
  if (isRejected(esito)) return '#dc2626';
  return '#f59e0b';
}

function rateColor(rate: number | null): string {
  if (rate == null)                      return 'text-gray-400';
  if (rate >= QUALITA_TARGET)             return 'text-green-600';
  if (rate >= QUALITA_TARGET * 0.9)       return 'text-yellow-500';
  return 'text-red-600';
}

function fmtDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    if (slice.length === 0) return null;
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

// Righe con esito NULL non hanno un dato di delibera noto (fase non ancora
// risincronizzata, o campo non valorizzato in WebThron) — vanno escluse dal
// tasso di accettazione, non contate come "da rilavorare". `totale` resta il
// volume REALE (tutti i pezzi passati, inclusi i non classificati) — usato
// per "quanti pezzi oggi". `classificati` è la base del tasso di accettazione
// (solo righe con esito noto) — usato per "che % è stata accettata".
function aggregateEsiti(rows: Array<{ esito: string | null; quantita: number }>) {
  let accettati = 0, respinti = 0, rilavorare = 0, nonClassificato = 0;
  for (const r of rows) {
    if (r.esito == null) { nonClassificato += r.quantita; continue; }
    if (isAccepted(r.esito))      accettati  += r.quantita;
    else if (isRejected(r.esito)) respinti   += r.quantita;
    else                           rilavorare += r.quantita;
  }
  const classificati = accettati + respinti + rilavorare;
  return { accettati, respinti, rilavorare, nonClassificato, classificati, totale: classificati + nonClassificato };
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function RateTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value != null ? `${p.value.toFixed(1)}%` : '—'}
        </p>
      ))}
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

// ─── Ranked list — non-accept rate by dimension (worst first) ─────────────────

function RankedRateBars({ rows }: { rows: Array<{ label: string; total: number; nonAcceptRate: number | null }> }) {
  return (
    <div className="space-y-2.5">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-sm text-gray-700 truncate w-32 shrink-0">{r.label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
            <div
              className="h-2 rounded-full bg-red-400"
              style={{ width: `${Math.min(100, r.nonAcceptRate ?? 0)}%` }}
            />
          </div>
          <span className={`text-xs font-medium shrink-0 w-14 text-right ${
            r.nonAcceptRate == null ? 'text-gray-400' : r.nonAcceptRate <= 3 ? 'text-green-600' : r.nonAcceptRate <= 10 ? 'text-yellow-500' : 'text-red-600'
          }`}>
            {r.nonAcceptRate != null ? `${r.nonAcceptRate.toFixed(1)}%` : '—'}
          </span>
          <span className="text-[10px] text-gray-400 shrink-0 w-14 text-right">{r.total.toLocaleString('it-IT')} pz</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QualitaPage() {
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [selFase,       setSelFase]       = useState<string | null>(null);
  const [selModelli,    setSelModelli]    = useState<Set<string>>(new Set());
  const [selComponenti, setSelComponenti] = useState<Set<string>>(new Set());
  const [daysParam,     setDaysParam]     = useState(60);

  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Load filter options once — default to the highest-volume delibera fase
  // (the final quality gate is usually the most representative one).
  useEffect(() => {
    fetch(`${BACKEND}/api/dashboards/quantity-filter-options`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((json: FilterOptions | null) => {
        if (json) {
          setFilterOptions(json);
          const deliberaFasi = json.fasi.filter(f => f.is_delibera).sort((a, b) => b.eventi - a.eventi);
          if (deliberaFasi.length > 0) setSelFase(deliberaFasi[0].fase);
        }
      })
      .catch(() => {});
  }, []);

  const deliberaFasi = filterOptions?.fasi.filter(f => f.is_delibera) ?? [];

  const fetchSummary = useCallback(async (fase: string, days: number, modelli: Set<string>, componenti: Set<string>) => {
    setLoading(true);
    try {
      const modelParam = modelli.size    > 0 ? `&modelli=${[...modelli].map(encodeURIComponent).join(',')}`       : '';
      const compParam  = componenti.size > 0 ? `&componenti=${[...componenti].map(encodeURIComponent).join(',')}` : '';
      const r = await fetch(
        `${BACKEND}/api/dashboards/quantity-summary?fase=${encodeURIComponent(fase)}&days=${days}${modelParam}${compParam}`,
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
    fetchSummary(selFase, daysParam, selModelli, selComponenti);
  }, [fetchSummary, selFase, daysParam, selModelli, selComponenti]);

  // ─── Derived data ──────────────────────────────────────────────────────────

  const dailyRates = useMemo(() => {
    if (!summary) return [];
    const byDay = new Map<string, { esiti: Array<{ esito: string | null; quantita: number }> }>();
    for (const r of summary.daily) {
      if (!byDay.has(r.data)) byDay.set(r.data, { esiti: [] });
      byDay.get(r.data)!.esiti.push(r);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, { esiti }]) => {
      const agg = aggregateEsiti(esiti);
      return { data, day: fmtDay(data), rate: agg.classificati > 0 ? agg.accettati / agg.classificati * 100 : null, ...agg };
    });
  }, [summary]);

  const rateMA = useMemo(() => movingAverage(dailyRates.map(d => d.rate), MA_WINDOW), [dailyRates]);

  const rateChartData = useMemo(() => dailyRates.map((d, i) => ({
    day: d.day, 'Tasso accettazione': d.rate, [`Media mobile ${MA_WINDOW}gg`]: rateMA[i],
  })), [dailyRates, rateMA]);

  const volumeChartData = useMemo(() => dailyRates.map(d => ({
    day: d.day, Accettati: d.accettati, 'Da rilavorare': d.rilavorare, Respinti: d.respinti, 'Non classificato': d.nonClassificato,
  })), [dailyRates]);

  const todayAgg = useMemo(() => aggregateEsiti(summary?.today_by_hour ?? []), [summary]);
  const periodAgg = useMemo(() => aggregateEsiti(summary?.daily ?? []), [summary]);

  const hourlyChartData = useMemo(() => {
    if (!summary) return [];
    const byHour = new Map<number, { Accettati: number; 'Da rilavorare': number; Respinti: number; 'Non classificato': number }>();
    for (let h = 0; h < 24; h++) byHour.set(h, { Accettati: 0, 'Da rilavorare': 0, Respinti: 0, 'Non classificato': 0 });
    for (const r of summary.today_by_hour) {
      const cur = byHour.get(r.ora)!;
      if (r.esito == null) cur['Non classificato'] += r.quantita;
      else if (isAccepted(r.esito)) cur.Accettati += r.quantita;
      else if (isRejected(r.esito)) cur.Respinti += r.quantita;
      else cur['Da rilavorare'] += r.quantita;
    }
    return Array.from(byHour.entries()).map(([ora, vals]) => ({ ora: `${ora}:00`, ...vals }));
  }, [summary]);

  function rankByDimension(rows: DimEsitoRow[], key: 'modello' | 'componente') {
    const map = new Map<string, Array<{ esito: string | null; quantita: number }>>();
    for (const r of rows) {
      const label = (key === 'modello' ? r.modello : r.componente) ?? '—';
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push({ esito: r.esito, quantita: r.quantita });
    }
    return [...map.entries()].map(([label, esiti]) => {
      const agg = aggregateEsiti(esiti);
      return { label, total: agg.totale, nonAcceptRate: agg.classificati > 0 ? (agg.classificati - agg.accettati) / agg.classificati * 100 : null };
    }).sort((a, b) => (b.nonAcceptRate ?? 0) - (a.nonAcceptRate ?? 0));
  }

  const modelloRanking            = useMemo(() => summary ? rankByDimension(summary.by_modello_esito, 'modello') : [], [summary]);
  const componenteRanking         = useMemo(() => summary ? rankByDimension(summary.by_componente_esito, 'componente') : [], [summary]);
  const modelloRankingOggi        = useMemo(() => summary ? rankByDimension(summary.today_by_modello_esito, 'modello') : [], [summary]);
  const componenteRankingOggi     = useMemo(() => summary ? rankByDimension(summary.today_by_componente_esito, 'componente') : [], [summary]);

  const tickInterval = Math.max(0, Math.ceil(rateChartData.length / 14) - 1);
  const todayRate  = todayAgg.classificati  > 0 ? todayAgg.accettati  / todayAgg.classificati  * 100 : null;
  const periodRate = periodAgg.classificati > 0 ? periodAgg.accettati / periodAgg.classificati * 100 : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Qualità</h1>
          <p className="text-xs text-gray-400 mt-0.5">Tasso di accettazione, tendenza e criticità per modello/componente — dalla delibera</p>
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
          label="Fase delibera"
          options={deliberaFasi.map(f => f.fase)}
          selected={selFase}
          onChange={setSelFase}
        />
        <MultiSelectFilter label="Modello" options={filterOptions?.modelli ?? []} selected={selModelli} onChange={setSelModelli} />
        <MultiSelectFilter label="Componente" options={filterOptions?.componenti ?? []} selected={selComponenti} onChange={setSelComponenti} />
        {(selModelli.size > 0 || selComponenti.size > 0) && (
          <button
            onClick={() => { setSelModelli(new Set()); setSelComponenti(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Rimuovi filtri
          </button>
        )}
        {loading && <span className="text-xs text-gray-400">Aggiornamento…</span>}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-10 text-center">{error}</div>}

      {!error && summary && periodAgg.nonClassificato > 0 && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
          {periodAgg.nonClassificato.toLocaleString('it-IT')} pezzi nel periodo senza esito registrato (grigio nei grafici) — esclusi dal tasso di accettazione, non contati come rilavorazione.
        </p>
      )}

      {!error && summary && (
        <>
          {/* ── Headline KPIs ──────────────────────────────────────────── */}
          <div className="card p-0 overflow-hidden">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-gray-100 lg:divide-y-0 lg:divide-x">
              <div className="p-5">
                <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Tasso accettazione (oggi)</p>
                <p className={`text-4xl font-semibold leading-none mt-2 ${rateColor(todayRate)}`}>
                  {todayRate != null ? `${todayRate.toFixed(1)}%` : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-2">obiettivo {QUALITA_TARGET}%</p>
              </div>
              <div className="p-5">
                <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Deliberati oggi</p>
                <p className="text-4xl font-semibold text-gray-900 leading-none mt-2">{todayAgg.totale.toLocaleString('it-IT')}</p>
                <p className="text-xs text-gray-400 mt-2">pezzi passati dalla delibera</p>
              </div>
              <div className="p-5">
                <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Da rilavorare (oggi)</p>
                <p className="text-4xl font-semibold leading-none mt-2" style={{ color: '#f59e0b' }}>
                  {todayAgg.rilavorare.toLocaleString('it-IT')}
                </p>
                <p className="text-xs text-gray-400 mt-2">{todayAgg.classificati > 0 ? (todayAgg.rilavorare / todayAgg.classificati * 100).toFixed(1) : '0.0'}% dei classificati</p>
              </div>
              <div className="p-5">
                <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Respinti (oggi)</p>
                <p className="text-4xl font-semibold leading-none mt-2" style={{ color: '#dc2626' }}>
                  {todayAgg.respinti.toLocaleString('it-IT')}
                </p>
                <p className="text-xs text-gray-400 mt-2">{todayAgg.classificati > 0 ? (todayAgg.respinti / todayAgg.classificati * 100).toFixed(1) : '0.0'}% dei classificati</p>
              </div>
            </div>
          </div>

          {/* ═══ SEZIONE: OGGI ═══════════════════════════════════════════ */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-1">Oggi</p>

          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Oggi, per ora</p>
            <p className="text-xs text-gray-400 mb-2">Esiti delibera per fascia oraria.</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="ora" tick={{ fontSize: 13, fill: '#374151' }} interval={1} />
                <YAxis tick={{ fontSize: 13, fill: '#374151' }} />
                <Tooltip content={<StackedTooltip />} />
                <Bar dataKey="Accettati" stackId="a" fill="#16a34a" />
                <Bar dataKey="Da rilavorare" stackId="a" fill="#f59e0b" />
                <Bar dataKey="Respinti" stackId="a" fill="#dc2626" />
                <Bar dataKey="Non classificato" stackId="a" fill="#9ca3af" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Criticità per modello — oggi</p>
              <p className="text-xs text-gray-400 mb-3">% non accettato (rilavorazione + respinto), peggiore in cima.</p>
              {modelloRankingOggi.length > 0
                ? <RankedRateBars rows={modelloRankingOggi} />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato oggi</p>}
            </div>
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Criticità per componente — oggi</p>
              <p className="text-xs text-gray-400 mb-3">% non accettato (rilavorazione + respinto), peggiore in cima.</p>
              {componenteRankingOggi.length > 0
                ? <RankedRateBars rows={componenteRankingOggi} />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato oggi</p>}
            </div>
          </div>

          {/* ═══ SEZIONE: STORICO ════════════════════════════════════════ */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Storico — ultimi {daysParam} giorni</p>

          <div className="card">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-base font-medium text-gray-700">Tendenza tasso di accettazione</p>
              <p className="text-sm text-gray-500">Media periodo: <span className={rateColor(periodRate)}>{periodRate != null ? `${periodRate.toFixed(1)}%` : '—'}</span></p>
            </div>
            <p className="text-xs text-gray-400 mb-2">Punti: tasso giornaliero. Linea blu: media mobile {MA_WINDOW} giorni. Riferimento verde: obiettivo {QUALITA_TARGET}%.</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rateChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 13, fill: '#374151' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 13, fill: '#374151' }} />
                <Tooltip content={<RateTooltip />} />
                <ReferenceLine y={QUALITA_TARGET} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `${QUALITA_TARGET}%`, fontSize: 9, fill: '#16a34a', position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="Tasso accettazione" stroke="#93c5fd" strokeWidth={1.5} dot={{ r: 2, fill: '#3b82f6' }} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey={`Media mobile ${MA_WINDOW}gg`} stroke="#1d4ed8" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <p className="text-base font-medium text-gray-700 mb-1">Volumi per esito — storico</p>
            <p className="text-xs text-gray-400 mb-2">Ultimi {daysParam} giorni.</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={volumeChartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" interval={tickInterval} tick={{ fontSize: 13, fill: '#374151' }} />
                <YAxis tick={{ fontSize: 13, fill: '#374151' }} />
                <Tooltip content={<StackedTooltip />} />
                <Bar dataKey="Accettati" stackId="a" fill="#16a34a" />
                <Bar dataKey="Da rilavorare" stackId="a" fill="#f59e0b" />
                <Bar dataKey="Respinti" stackId="a" fill="#dc2626" />
                <Bar dataKey="Non classificato" stackId="a" fill="#9ca3af" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Criticità per modello — storico</p>
              <p className="text-xs text-gray-400 mb-3">% non accettato (rilavorazione + respinto), peggiore in cima.</p>
              {modelloRanking.length > 0
                ? <RankedRateBars rows={modelloRanking} />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>}
            </div>
            <div className="card">
              <p className="text-base font-medium text-gray-700 mb-1">Criticità per componente — storico</p>
              <p className="text-xs text-gray-400 mb-3">% non accettato (rilavorazione + respinto), peggiore in cima.</p>
              {componenteRanking.length > 0
                ? <RankedRateBars rows={componenteRanking} />
                : <p className="text-sm text-gray-400 text-center py-8">Nessun dato</p>}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
