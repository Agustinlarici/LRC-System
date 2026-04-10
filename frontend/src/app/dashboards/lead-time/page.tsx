'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
} from 'recharts';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadTimePoint {
  commessa_code:  string;
  line_entry_ts:  string | null;
  model_code:     string | null;
  ts_a:           string;
  ts_b:           string;
  hours_net:      number;
  componente:     string | null;
}

interface SpmaCategory { id: number; name: string; sort_order: number }
interface CompMap { id: number; componente_iknow: string; component_category_id: number; category_name: string; active: boolean }
interface ZoneConfig { verde_max: number; amarillo_max: number; direction: 'higher_worse' | 'higher_better' }

// ─── Moving average ───────────────────────────────────────────────────────────

function movingAvg(data: Array<{ hours_net: number }>, window: number) {
  return data.map((_, i) => {
    const half = Math.floor(window / 2);
    const from = Math.max(0, i - half);
    const to   = Math.min(data.length - 1, i + half);
    const slice = data.slice(from, to + 1);
    return slice.reduce((s, d) => s + d.hours_net, 0) / slice.length;
  });
}

// ─── Custom X tick (idx + date) ───────────────────────────────────────────────

function XTick({ x, y, payload, data }: {
  x?: number | string; y?: number | string;
  payload?: { value: number };
  data: Array<{ line_entry_ts: string | null }>;
}) {
  const idx  = payload?.value ?? 0;
  const pt   = data[idx - 1];
  const prev = data[idx - 2];

  const toDate = (ts: string | null) =>
    ts ? new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';

  const date     = toDate(pt?.line_entry_ts ?? null);
  const prevDate = toDate(prev?.line_entry_ts ?? null);
  const showDate = date && date !== prevDate;

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fill="#6b7280" fontSize={11}>{idx}</text>
      {showDate && <text x={0} y={0} dy={24} textAnchor="middle" fill="#9ca3af" fontSize={9}>{date}</text>}
    </g>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: LeadTimePoint & { idx: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-w-52">
      <p className="font-semibold text-gray-900 mb-1">{d.commessa_code}</p>
      {d.model_code  && <p className="text-gray-500">Modello: {d.model_code}</p>}
      {d.componente  && <p className="text-gray-500">Comp.: {d.componente}</p>}
      <p className="text-gray-500 mt-1">Ingresso: {d.line_entry_ts ? fmtDatetime(d.line_entry_ts) : '–'}</p>
      <p className="text-gray-500">Fase A: {fmtDatetime(d.ts_a)}</p>
      <p className="text-gray-500">Fase B: {fmtDatetime(d.ts_b)}</p>
      <p className="font-bold text-blue-600 mt-1">{d.hours_net.toFixed(1)} h lavorative</p>
    </div>
  );
}

// ─── Mapping manager (inline) ─────────────────────────────────────────────────

function MappingManager({ categories }: { categories: SpmaCategory[] }) {
  const [maps,     setMaps]     = useState<CompMap[]>([]);
  const [compAll,  setCompAll]  = useState<string[]>([]);
  const [iknow,    setIknow]    = useState('');
  const [catId,    setCatId]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [open,     setOpen]     = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get<CompMap[]>('/api/spma/componente-map'),
      api.get<string[]>('/api/dashboards/lead-time/componenti'),
    ]).then(([m, c]) => { setMaps(m); setCompAll(c); }).catch(console.error);
  }, [open]);

  async function add() {
    if (!iknow.trim() || !catId) return;
    setBusy(true);
    try {
      const row = await api.post<CompMap>('/api/spma/componente-map', {
        componenteIknow: iknow.trim(), componentCategoryId: parseInt(catId),
      });
      setMaps(prev => [...prev.filter(m => m.id !== row.id), row]);
      setIknow('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/spma/componente-map/${id}`);
    setMaps(prev => prev.filter(m => m.id !== id));
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span>Equivalenze componenti (iKnow ↔ SPMA)</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-3 bg-white">
          <p className="text-xs text-gray-500">
            Collega il nome del componente in iKnow/WebThron alla categoria SPMA.
            Puoi aggiungere più equivalenze per la stessa categoria.
          </p>

          {/* Add row */}
          <div className="flex gap-2 flex-wrap">
            <input
              value={iknow} onChange={e => setIknow(e.target.value)}
              placeholder="Nome componente iKnow (es. PARAURTI ANT)"
              list="iknow-map-list"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <datalist id="iknow-map-list">
              {compAll.map(c => <option key={c} value={c} />)}
            </datalist>
            <select value={catId} onChange={e => setCatId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Categoria SPMA</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={add} disabled={busy || !iknow.trim() || !catId}
              className="bg-blue-600 text-white px-3 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Aggiungi
            </button>
          </div>

          {/* Table */}
          {maps.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">Nessuna equivalenza configurata</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
                    <th className="py-2 px-3 text-left font-medium">Componente iKnow</th>
                    <th className="py-2 px-3 text-left font-medium">Categoria SPMA</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {maps.map(m => (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 px-3 font-mono">{m.componente_iknow}</td>
                      <td className="py-1.5 px-3 text-gray-600">{m.category_name}</td>
                      <td className="py-1.5 px-3 text-right">
                        <button onClick={() => del(m.id)} className="text-red-400 hover:text-red-600 transition-colors">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LeadTimePage() {
  const today     = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [categories, setCategories] = useState<SpmaCategory[]>([]);
  const [fasi,       setFasi]       = useState<string[]>([]);
  const [lines,      setLines]      = useState<{ id: number; name: string }[]>([]);

  const [categoryId, setCategoryId] = useState('');
  const [fase_a,     setFaseA]      = useState('');
  const [fase_b,     setFaseB]      = useState('');
  const [dateFrom,   setDateFrom]   = useState(thirtyAgo);
  const [dateTo,     setDateTo]     = useState(today);
  const [lineId,     setLineId]     = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [allModels,   setAllModels]   = useState<string[]>([]);

  const [points,   setPoints]   = useState<LeadTimePoint[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [warning,  setWarning]  = useState<string | null>(null);
  const [loaded,   setLoaded]   = useState(false);
  const [yMin,        setYMin]        = useState<string>('');
  const [yMax,        setYMax]        = useState<string>('');
  const [displayCount, setDisplayCount] = useState(20);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [zone,        setZone]        = useState<ZoneConfig | null>(null);
  const [zoneEdit,    setZoneEdit]    = useState<{ verde: string; amarillo: string; direction: 'higher_worse' | 'higher_better' } | null>(null);
  const [zoneOpen,    setZoneOpen]    = useState(false);
  const [zoneSaving,  setZoneSaving]  = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<SpmaCategory[]>('/api/spma/categories'),
      api.get<string[]>('/api/dashboards/lead-time/fasi'),
      api.get<{ id: number; name: string }[]>('/api/spma/lines'),
      api.get<string[]>('/api/dashboards/lead-time/models'),
    ]).then(([c, f, l, m]) => { setCategories(c); setFasi(f); setLines(l); setAllModels(m); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!categoryId || !fase_a || !fase_b) { setZone(null); return; }
    const params = new URLSearchParams({ category_id: categoryId, fase_a, fase_b });
    api.get<ZoneConfig | null>(`/api/dashboards/lead-time/zones?${params}`)
      .then(z => { setZone(z); setZoneEdit(null); })
      .catch(() => setZone(null));
  }, [categoryId, fase_a, fase_b]);

  // Reset display count when data changes
  useEffect(() => { setDisplayCount(20); }, [points, modelFilter]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setDisplayCount(n => n + 20);
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [sentinelRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!categoryId || !fase_a || !fase_b) return;
    setLoading(true); setError(null); setWarning(null);
    try {
      const params = new URLSearchParams({
        category_id: categoryId, fase_a, fase_b, date_from: dateFrom, date_to: dateTo,
      });
      if (lineId) params.set('line_id', lineId);
      const data = await api.get<{ points: LeadTimePoint[]; count: number; warning?: string }>(
        `/api/dashboards/lead-time?${params}`
      );
      setPoints(data.points);
      setModelFilter('');
      if (data.warning) setWarning(data.warning);
      if (data.points.length > 0) {
        const hrs = data.points.map(p => p.hours_net);
        const minVal = Math.min(...hrs);
        const avgVal = hrs.reduce((a, b) => a + b, 0) / hrs.length;
        setYMin(String(Math.floor(minVal / 10) * 10));
        setYMax(String(Math.ceil((avgVal * 3) / 10) * 10));
      }
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [categoryId, fase_a, fase_b, dateFrom, dateTo, lineId]);

  const chartData = useMemo(() => {
    const filtered = modelFilter ? points.filter(p => p.model_code === modelFilter) : points;
    const w = Math.max(3, Math.round(filtered.length * 0.20));
    const window = w % 2 === 0 ? w + 1 : w;
    const trend  = movingAvg(filtered, window);
    return filtered.map((p, i) => ({ ...p, idx: i + 1, trend: trend[i] }));
  }, [points, modelFilter]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const hrs = chartData.map(p => p.hours_net);
    const avg = hrs.reduce((a, b) => a + b, 0) / hrs.length;
    return {
      avg, count: hrs.length,
      min: Math.min(...hrs),
      max: Math.max(...hrs),
      median: [...hrs].sort((a, b) => a - b)[Math.floor(hrs.length / 2)],
    };
  }, [chartData]);

  const canLoad = categoryId && fase_a && fase_b;

  return (
    <div>
      <div className="mb-6">
        <Link href="/dashboards" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Tempi tra Fasi</h1>
        <p className="mt-1 text-gray-500">Ore lavorative nette tra due eventi di produzione per ogni commessa</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Categoria SPMA — required */}
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Componente <span className="text-red-400">*</span>
            </label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleziona componente</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Fase A */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Fase A — da <span className="text-red-400">*</span>
            </label>
            <select value={fase_a} onChange={e => setFaseA(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleziona</option>
              <option value="SPMA_PIANO">📋 Montaggio componente (SPMA)</option>
              {fasi.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Fase B */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Fase B — a <span className="text-red-400">*</span>
            </label>
            <select value={fase_b} onChange={e => setFaseB(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleziona</option>
              <option value="SPMA_PIANO">📋 Montaggio componente (SPMA)</option>
              {fasi.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Da data ingresso</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Date to */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">A data ingresso</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Linea */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Linea (opz.)</label>
            <select value={lineId} onChange={e => setLineId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Tutte le linee</option>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {/* Modello */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Modello (opz.)</label>
            <select value={modelFilter} onChange={e => setModelFilter(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Tutti i modelli</option>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {!canLoad && (
            <p className="text-xs text-gray-400">Seleziona componente e due fasi per calcolare</p>
          )}
          <div className="ml-auto">
            <button onClick={load} disabled={loading || !canLoad}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? 'Calcolo...' : 'Calcola'}
            </button>
          </div>
        </div>
      </div>

      {error   && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {warning && <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">⚠ {warning}</div>}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Commesse',  val: String(stats.count),                                  unit: ''  },
            { label: 'Media',     val: stats.avg.toFixed(1),                                 unit: ' h'},
            { label: 'Mediana',   val: stats.median.toFixed(1),                              unit: ' h'},
            { label: 'Min / Max', val: `${stats.min.toFixed(1)} / ${stats.max.toFixed(1)}`,  unit: ' h'},
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{s.val}{s.unit}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {loaded && chartData.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          Nessun dato per i filtri selezionati
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Ore lavorative nette — {chartData.length} commesse
            {stats && <span className="text-gray-400 ml-2">· media {stats.avg.toFixed(1)} h</span>}
          </h2>

          {/* Zone config panel */}
          {canLoad && (
            <div className="mb-4 border border-gray-100 rounded-xl overflow-hidden">
              <button
                onClick={() => {
                  const opening = !zoneOpen;
                  setZoneOpen(opening);
                  if (opening && !zoneEdit) {
                    setZoneEdit({
                      verde:     zone ? String(zone.verde_max)    : '',
                      amarillo:  zone ? String(zone.amarillo_max) : '',
                      direction: zone?.direction ?? 'higher_worse',
                    });
                  }
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-xs font-medium text-gray-600"
              >
                <span className="flex items-center gap-2">
                  {zone ? (<>
                    {zone.direction === 'higher_worse'
                      ? <><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-300" /><span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300" /><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-300" /></>
                      : <><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-300" /><span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300" /><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-300" /></>
                    }
                    {zone.direction === 'higher_worse'
                      ? `Zone: verde ≤ ${zone.verde_max} h · giallo ≤ ${zone.amarillo_max} h · rosso oltre`
                      : `Zone: rosso ≤ ${zone.verde_max} h · giallo ≤ ${zone.amarillo_max} h · verde oltre`
                    }
                  </>) : (<>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-300" />
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-300" />
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-300" />
                    Configura zone di colore
                  </>)}
                </span>
                <span className="text-gray-400">{zoneOpen ? '▲' : '▼'}</span>
              </button>

              {zoneOpen && zoneEdit && (
                <div className="px-4 py-3 bg-white space-y-3">
                  {/* Direction toggle */}
                  <div>
                    <p className="text-[10px] font-medium text-gray-500 mb-1.5">Direzione — cosa significa un valore alto?</p>
                    <div className="flex gap-2">
                      {(['higher_worse', 'higher_better'] as const).map(d => (
                        <button key={d}
                          onClick={() => setZoneEdit(z => z ? { ...z, direction: d } : z)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            zoneEdit.direction === d
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {d === 'higher_worse' ? '↑ Più alto = peggio (ritardo)' : '↑ Più alto = meglio (velocità)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Thresholds */}
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="block text-[10px] font-medium mb-1"
                        style={{ color: zoneEdit.direction === 'higher_worse' ? '#16a34a' : '#dc2626' }}>
                        {zoneEdit.direction === 'higher_worse' ? 'Verde' : 'Rosso'} — sotto (ore)
                      </label>
                      <input type="number" min={0} step={0.5}
                        value={zoneEdit.verde}
                        onChange={e => setZoneEdit(z => z ? { ...z, verde: e.target.value } : z)}
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-yellow-600 mb-1">Giallo — sotto (ore)</label>
                      <input type="number" min={0} step={0.5}
                        value={zoneEdit.amarillo}
                        onChange={e => setZoneEdit(z => z ? { ...z, amarillo: e.target.value } : z)}
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={zoneSaving || !zoneEdit.verde || !zoneEdit.amarillo}
                        onClick={async () => {
                          if (!zoneEdit.verde || !zoneEdit.amarillo) return;
                          setZoneSaving(true);
                          try {
                            const saved = await api.put<ZoneConfig>('/api/dashboards/lead-time/zones', {
                              category_id: parseInt(categoryId),
                              fase_a, fase_b,
                              verde_max:    parseFloat(zoneEdit.verde),
                              amarillo_max: parseFloat(zoneEdit.amarillo),
                              direction:    zoneEdit.direction,
                            });
                            setZone(saved);
                            setZoneOpen(false);
                            setZoneEdit(null);
                          } catch (e) {
                            alert((e as Error).message);
                          } finally {
                            setZoneSaving(false);
                          }
                        }}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {zoneSaving ? 'Salvo...' : 'Salva'}
                      </button>
                      {zone && (
                        <button
                          onClick={async () => {
                            await api.delete(`/api/dashboards/lead-time/zones?category_id=${categoryId}&fase_a=${encodeURIComponent(fase_a)}&fase_b=${encodeURIComponent(fase_b)}`);
                            setZone(null);
                            setZoneEdit(null);
                            setZoneOpen(false);
                          }}
                          className="text-red-400 hover:text-red-600 px-3 py-1.5 text-xs transition-colors"
                        >
                          Rimuovi
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chart + Y-axis controls side by side */}
          <div className="flex gap-2">

            {/* Y-axis controls (left of chart) */}
            <div className="flex flex-col items-center justify-between py-1 w-16 shrink-0 text-xs text-gray-500">
              <div className="flex flex-col items-center gap-1">
                <span className="text-gray-400 text-[10px]">máx</span>
                <input
                  type="number"
                  value={yMax}
                  onChange={e => setYMax(e.target.value)}
                  className="w-14 border border-gray-200 rounded-lg px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => {
                  if (!stats) return;
                  const minVal = stats.min;
                  const avgVal = stats.avg;
                  setYMin(String(Math.floor(minVal / 10) * 10));
                  setYMax(String(Math.ceil((avgVal * 3) / 10) * 10));
                }}
                className="text-gray-400 hover:text-blue-600 transition-colors text-base leading-none"
                title="Ripristina range automatico"
              >↺</button>
              <div className="flex flex-col items-center gap-1">
                <input
                  type="number"
                  value={yMin}
                  onChange={e => setYMin(e.target.value)}
                  className="w-14 border border-gray-200 rounded-lg px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-400 text-[10px]">mín</span>
              </div>
            </div>

            {/* Chart */}
            <ResponsiveContainer width="100%" height={612}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="idx"
                  height={52}
                  tick={(props) => <XTick {...props} data={chartData} />}
                  label={{ value: 'Commesse (ordine ingresso linea)', position: 'insideBottom', offset: -8, fontSize: 11, fill: '#9ca3af' }}
                />
                <YAxis tick={{ fontSize: 11 }}
                  label={{ value: 'Ore lavorative', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: '#9ca3af' }}
                  width={55}
                  allowDataOverflow
                  domain={[
                    yMin !== '' ? Number(yMin) : 'auto',
                    yMax !== '' ? Number(yMax) : 'auto',
                  ]} />
                <Tooltip content={<ChartTooltip />} />

                {/* Colour zones */}
                {zone && (() => {
                  const yLo = yMin !== '' ? Number(yMin) : (stats ? Math.floor(stats.min / 10) * 10 : 0);
                  const yHi = yMax !== '' ? Number(yMax) : (stats ? Math.ceil((stats.avg * 3) / 10) * 10 : 100);
                  const hw  = zone.direction === 'higher_worse';
                  return (<>
                    {/* Bottom band: green (hw) or red (hb) */}
                    <ReferenceArea y1={yLo} y2={zone.verde_max}    fill={hw ? '#bbf7d0' : '#fecaca'} fillOpacity={0.35} ifOverflow="hidden" />
                    {/* Middle band: yellow */}
                    <ReferenceArea y1={zone.verde_max} y2={zone.amarillo_max} fill="#fef08a" fillOpacity={0.35} ifOverflow="hidden" />
                    {/* Top band: red (hw) or green (hb) */}
                    <ReferenceArea y1={zone.amarillo_max} y2={yHi} fill={hw ? '#fecaca' : '#bbf7d0'} fillOpacity={0.35} ifOverflow="hidden" />
                  </>);
                })()}

                {/* Y=0 always visible */}
                <ReferenceLine y={0} stroke="#d1d5db" strokeWidth={1.5} />
                {stats && (
                  <ReferenceLine y={stats.avg} stroke="#3b82f6" strokeDasharray="4 4"
                    label={{ value: `avg ${stats.avg.toFixed(1)}h`, fill: '#3b82f6', fontSize: 11 }} />
                )}
                {/* Trend line (moving average) */}
                <Line type="monotone" dataKey="trend" stroke="#f59e0b" strokeWidth={2}
                  dot={false} activeDot={false} name="Tendenza" strokeOpacity={0.85} />
                {/* Main data line */}
                <Line type="monotone" dataKey="hours_net" stroke="#3b82f6" strokeWidth={1.5}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    const color = (payload as LeadTimePoint).hours_net < 0 ? '#ef4444' : '#3b82f6';
                    return <circle key={`dot-${(payload as LeadTimePoint & { idx: number }).idx}`} cx={cx} cy={cy} r={3} fill={color} />;
                  }}
                  activeDot={{ r: 5 }} name="Ore nette" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-3 px-4 text-left font-medium">#</th>
                <th className="py-3 px-4 text-left font-medium">Commessa</th>
                <th className="py-3 px-4 text-left font-medium">Modello</th>
                <th className="py-3 px-4 text-left font-medium">Ingresso linea</th>
                <th className="py-3 px-4 text-left font-medium">Fase A</th>
                <th className="py-3 px-4 text-left font-medium">Fase B</th>
                <th className="py-3 px-4 text-right font-medium">Ore nette</th>
              </tr>
            </thead>
            <tbody>
              {chartData.slice(0, displayCount).map(p => (
                <tr key={p.commessa_code} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 px-4 text-gray-400">{p.idx}</td>
                  <td className="py-2.5 px-4 font-mono font-medium">{p.commessa_code}</td>
                  <td className="py-2.5 px-4 text-gray-600">{p.model_code || '–'}</td>
                  <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">
                    {p.line_entry_ts ? fmtDatetime(p.line_entry_ts) : '–'}
                  </td>
                  <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">{fmtDatetime(p.ts_a)}</td>
                  <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">{fmtDatetime(p.ts_b)}</td>
                  <td className={`py-2.5 px-4 text-right font-semibold tabular-nums ${
                    p.hours_net < 8 ? 'text-red-600' : 'text-gray-900'
                  }`}>
                    {p.hours_net.toFixed(1)} h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Infinite scroll sentinel */}
          {displayCount < chartData.length && (
            <div ref={sentinelRef} className="py-3 text-center text-xs text-gray-400">
              Mostrando {Math.min(displayCount, chartData.length)} di {chartData.length} · Scorri per caricare altri...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
