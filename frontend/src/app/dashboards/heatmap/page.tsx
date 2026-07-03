'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Types ────────────────────────────────────────────────────────────────────

type OeeHourCell = {
  linea_id:      number;
  data:          string;
  ora:           number;
  pezzi_reali:   number;
  pezzi_attesi:  number;
  minuti_fermo:  number;
  fermi_count:   number;
  disponibilita: number;
  performance:   number;
  oee:           number;
  has_data:      boolean;
};

type OeeDayCell = {
  linea_id:          number;
  data:              string;
  oee:               number;
  pezzi_reali:       number;
  pezzi_pianificati: number;
  disponibilita:     number;
  performance:       number;
  qualita:           number;
};

type HeatmapData = {
  year:       number;
  month:      number;
  linee:      Array<{ id: number; nome: string }>;
  days:       number[];
  cells:      OeeHourCell[];
  dailyCells: OeeDayCell[];
};

type DetailData = {
  linea_id:          number;
  nome:              string;
  data:              string;
  pezzi_reali:       number;
  pezzi_pianificati: number;
  pezzi_conformi:    number;
  pezzi_deliberati:  number;
  minuti_turno:      number;
  minuti_fermo:      number;
  disponibilita:     number;
  performance:       number;
  qualita:           number;
  oee:               number;
  fermi_count:       number;
  has_data:          boolean;
  fermate:           Array<{ inizio: string; fine: string; durata_min: number }>;
};

// ─── Color helpers ─────────────────────────────────────────────────────────────

function oeeColor(oee: number): string {
  if (oee >= 80) return 'bg-green-500';
  if (oee >= 65) return 'bg-yellow-400';
  if (oee >= 50) return 'bg-orange-400';
  return 'bg-red-500';
}

const MONTH_NAMES = [
  '', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const DOW_LABELS = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ─── Merge N hour cells (4h→8h or all→day) ────────────────────────────────────

function mergeHourCells(
  inputs: (OeeHourCell | undefined)[],
  startOra: number,
): OeeHourCell | null {
  const cells = inputs.filter((c): c is OeeHourCell => !!c && c.has_data);
  if (cells.length === 0) return null;
  const pezzi_reali   = cells.reduce((s, c) => s + c.pezzi_reali,  0);
  const pezzi_attesi  = cells.reduce((s, c) => s + c.pezzi_attesi, 0);
  const minuti_fermo  = cells.reduce((s, c) => s + c.minuti_fermo, 0);
  const fermi_count   = cells.reduce((s, c) => s + c.fermi_count,  0);
  const disponibilita = cells.reduce((s, c) => s + c.disponibilita, 0) / cells.length;
  const performance   = pezzi_attesi > 0 ? Math.min(100, (pezzi_reali / pezzi_attesi) * 100) : 0;
  const oee           = disponibilita * performance / 100;
  return { ...cells[0], ora: startOra, pezzi_reali, pezzi_attesi, minuti_fermo, fermi_count,
           disponibilita, performance, oee, has_data: true };
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  useAuth();

  const now   = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [data,    setData]    = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const [blockSize, setBlockSize] = useState<4 | 8 | 'day'>(4);

  const [detail,        setDetail]        = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedCell,  setSelectedCell]  = useState<{ lineaId: number; date: string } | null>(null);

  const [tooltip, setTooltip] = useState<{
    cell: OeeHourCell; lineName: string; x: number; y: number;
  } | null>(null);
  const ttTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch ─────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(
        `${BACKEND}/api/dashboards/heatmap?year=${year}&month=${month}`,
        { credentials: 'include' }
      );
      if (!r.ok) throw new Error(`${r.status}`);
      setData(await r.json());
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchDetail = useCallback(async (lineaId: number, date: string) => {
    setDetailLoading(true); setDetail(null);
    try {
      const r = await fetch(
        `${BACKEND}/api/dashboards/heatmap/detail/${lineaId}/${date}`,
        { credentials: 'include' }
      );
      if (!r.ok) throw new Error();
      setDetail(await r.json());
    } finally { setDetailLoading(false); }
  }, []);

  const openDetail = (lineaId: number, date: string) => {
    setSelectedCell({ lineaId, date });
    fetchDetail(lineaId, date);
  };

  // ─── Month navigation ──────────────────────────────────────────────────────

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (year === now.getFullYear() && month === now.getMonth() + 1) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  // ─── Derived data ──────────────────────────────────────────────────────────

  const pad = (n: number) => String(n).padStart(2, '0');

  // Fast lookup: "lineaId-YYYY-MM-DD-HH" → OeeHourCell
  const cellMap = new Map<string, OeeHourCell>();
  // Fast lookup: "lineaId-YYYY-MM-DD" → OeeDayCell
  const dailyCellMap = new Map<string, OeeDayCell>();
  // Hours with data per line
  const lineaHoursMap = new Map<number, number[]>();

  if (data) {
    for (const cell of data.cells) {
      if (!cell.has_data) continue;
      cellMap.set(`${cell.linea_id}-${cell.data}-${cell.ora}`, cell);
      if (!lineaHoursMap.has(cell.linea_id)) lineaHoursMap.set(cell.linea_id, []);
      const hrs = lineaHoursMap.get(cell.linea_id)!;
      if (!hrs.includes(cell.ora)) hrs.push(cell.ora);
    }
    for (const [, hrs] of lineaHoursMap) hrs.sort((a, b) => a - b);
    for (const dc of data.dailyCells) {
      dailyCellMap.set(`${dc.linea_id}-${dc.data}`, dc);
    }
  }

  // ─── Summary cards ─────────────────────────────────────────────────────────

  let bestDay:      { day: number; avg: number } | null = null;
  let worstDay:     { day: number; avg: number } | null = null;
  let mostStopsLine: { nome: string; stops: number } | null = null;

  if (data) {
    const dayOees   = new Map<number, number[]>();
    const lineStops = new Map<number, number>();
    for (const c of data.cells) {
      if (!c.has_data) continue;
      const d = parseInt(c.data.slice(8), 10);
      if (!dayOees.has(d))   dayOees.set(d, []);
      dayOees.get(d)!.push(c.oee);
      lineStops.set(c.linea_id, (lineStops.get(c.linea_id) ?? 0) + c.fermi_count);
    }
    for (const [day, oeees] of dayOees) {
      const avg = oeees.reduce((a, b) => a + b, 0) / oeees.length;
      if (!bestDay  || avg > bestDay.avg)  bestDay  = { day, avg };
      if (!worstDay || avg < worstDay.avg) worstDay = { day, avg };
    }
    for (const [lid, stops] of lineStops) {
      if (!mostStopsLine || stops > mostStopsLine.stops)
        mostStopsLine = { nome: data.linee.find(l => l.id === lid)?.nome ?? `#${lid}`, stops };
    }
  }

  // ─── Today string ──────────────────────────────────────────────────────────

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Month selector ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-lg">
          ‹
        </button>
        <span className="text-lg font-semibold text-gray-800 min-w-[160px] text-center">
          {MONTH_NAMES[month]} {year}
        </span>
        <button onClick={nextMonth} disabled={isCurrentMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-lg disabled:opacity-30 disabled:cursor-not-allowed">
          ›
        </button>
        {loading && <span className="text-xs text-gray-400 ml-1">Caricamento…</span>}

        {/* ── Block-size toggle ──────────────────────────────────────────── */}
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {([4, 8, 'day'] as const).map(size => (
            <button key={size}
              onClick={() => setBlockSize(size)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors
                ${blockSize === size
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'}`}>
              {size === 'day' ? 'Giorno' : `${size}h`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        <span className="font-medium">OEE (D×P):</span>
        {[
          { color: 'bg-green-500',  label: '≥ 80%' },
          { color: 'bg-yellow-400', label: '60–79%' },
          { color: 'bg-orange-400', label: '40–59%' },
          { color: 'bg-red-500',    label: '< 40%' },
          { color: 'bg-gray-100 border border-gray-200', label: 'Fuori turno' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm inline-block ${color}`} /> {label}
          </span>
        ))}
      </div>

      {/* ── Heatmap grid ──────────────────────────────────────────────────── */}
      {data && !loading && (
        <div className="overflow-x-auto">
          {/* min-width: line-col(120) + hour-col(36) + days(34px each) */}
          <div style={{ minWidth: `${156 + data.days.length * 34}px` }}>

            {/* ── Column headers ─────────────────────────────────────────── */}
            <div className="flex mb-0.5">
              <div className="w-[120px] shrink-0" />
              <div className="w-9 shrink-0" />
              {data.days.map(d => {
                const ds      = `${year}-${pad(month)}-${pad(d)}`;
                const isToday = ds === todayStr;
                return (
                  <div key={d}
                    className={`w-8 shrink-0 mx-px text-center text-xs font-medium
                      ${isToday ? 'text-blue-600 font-bold' : 'text-gray-600'}`}>
                    {d}
                  </div>
                );
              })}
            </div>

            {/* Day-of-week row */}
            <div className="flex mb-3">
              <div className="w-[120px] shrink-0" />
              <div className="w-9 shrink-0" />
              {data.days.map(d => {
                const dow       = new Date(year, month - 1, d).getDay();
                const isWeekend = dow === 0 || dow === 6;
                return (
                  <div key={d}
                    className={`w-8 shrink-0 mx-px text-center text-[11px] font-medium
                      ${isWeekend ? 'text-red-500' : 'text-gray-500'}`}>
                    {DOW_LABELS[dow]}
                  </div>
                );
              })}
            </div>

            {/* ── Line groups ─────────────────────────────────────────────── */}
            {data.linee.map((linea, li) => {
              const hours = lineaHoursMap.get(linea.id) ?? [];
              if (hours.length === 0) return null;

              return (
                <div key={linea.id} className={li > 0 ? 'mt-4' : ''}>

                  {/* Line header */}
                  <div className="flex items-center mb-0.5">
                    <div className="w-[120px] shrink-0 text-xs font-bold text-gray-700 truncate pr-1"
                      title={linea.nome}>
                      {linea.nome}
                    </div>
                    <div className="w-9 shrink-0" />
                    {/* daily OEE average per column */}
                    {data.days.map(d => {
                      const ds       = `${year}-${pad(month)}-${pad(d)}`;
                      const dayCells = hours
                        .map(h => cellMap.get(`${linea.id}-${ds}-${h}`))
                        .filter((c): c is OeeHourCell => !!c && c.has_data);
                      const avg = dayCells.length > 0
                        ? dayCells.reduce((s, c) => s + c.oee, 0) / dayCells.length
                        : null;
                      return (
                        <div key={d}
                          className="w-8 shrink-0 mx-px text-center text-[10px] font-semibold text-gray-600">
                          {avg !== null ? Math.round(avg) : ''}
                        </div>
                      );
                    })}
                  </div>

                  {/* Hour rows — 4h, 8h or day */}
                  {(blockSize === 'day'
                    ? [hours[0] ?? 6]                          // single row
                    : blockSize === 8
                      ? hours.filter(h => h === 6 || h === 14) // two rows
                      : hours                                   // four rows
                  ).map(ora => {
                    const cellHeight = blockSize === 'day' ? 'h-10' : blockSize === 8 ? 'h-8' : 'h-6';
                    const blockEnd   = blockSize === 'day' ? 24 : ora + blockSize;

                    return (
                      <div key={ora} className="flex items-center mb-px">
                        <div className="w-[120px] shrink-0" />
                        <div className="w-9 shrink-0 text-[11px] font-medium text-gray-600 text-right pr-1.5 select-none">
                          {blockSize === 'day' ? 'giorno' : `${pad(ora)}-${pad(blockEnd)}`}
                        </div>
                        {data.days.map(d => {
                          const ds = `${year}-${pad(month)}-${pad(d)}`;

                          // In day mode use monitor_oee_daily directly (same source as tendenze)
                          const dayCell = blockSize === 'day' ? dailyCellMap.get(`${linea.id}-${ds}`) : undefined;
                          const cell =
                            blockSize === 4
                              ? cellMap.get(`${linea.id}-${ds}-${ora}`)
                              : blockSize === 8
                                ? mergeHourCells([
                                    cellMap.get(`${linea.id}-${ds}-${ora}`),
                                    cellMap.get(`${linea.id}-${ds}-${ora + 4}`),
                                  ], ora) ?? undefined
                                : dayCell
                                  ? { linea_id: linea.id, data: ds, ora, has_data: true,
                                      oee: dayCell.oee, disponibilita: dayCell.disponibilita,
                                      performance: dayCell.performance, pezzi_reali: dayCell.pezzi_reali,
                                      pezzi_attesi: dayCell.pezzi_pianificati, minuti_fermo: 0, fermi_count: 0 }
                                  : undefined;
                          const selected = selectedCell?.lineaId === linea.id && selectedCell?.date === ds;

                          return (
                            <div key={d}
                              className={`w-8 shrink-0 mx-px rounded-sm flex items-center justify-center
                                transition-all select-none ${cellHeight}
                                ${cell ? oeeColor(cell.oee) : 'bg-gray-100'}
                                ${selected ? 'ring-2 ring-blue-500 ring-offset-1 z-10' : ''}
                                ${cell ? 'cursor-pointer hover:opacity-75' : ''}`}
                              onClick={() => cell && openDetail(linea.id, ds)}
                              onMouseEnter={e => {
                                if (!cell) return;
                                if (ttTimeout.current) clearTimeout(ttTimeout.current);
                                const r = e.currentTarget.getBoundingClientRect();
                                setTooltip({ cell, lineName: linea.nome, x: r.left, y: r.bottom + 6 });
                              }}
                              onMouseLeave={() => {
                                ttTimeout.current = setTimeout(() => setTooltip(null), 100);
                              }}
                            >
                              {cell && (
                                <span className="text-[9px] font-bold text-white leading-none">
                                  {Math.round(cell.oee)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

          </div>
        </div>
      )}

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      {data && !loading && (bestDay || worstDay || mostStopsLine) && (
        <div className="grid grid-cols-3 gap-4 pt-2">
          {bestDay && (
            <div className="card border border-green-200 bg-green-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Miglior giorno</p>
              <p className="text-2xl font-bold text-green-700">
                {bestDay.day} {MONTH_NAMES[month].slice(0, 3)}
              </p>
              <p className="text-xs text-gray-500 mt-1">OEE medio {bestDay.avg.toFixed(1)}%</p>
            </div>
          )}
          {worstDay && (
            <div className="card border border-red-200 bg-red-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Giorno critico</p>
              <p className="text-2xl font-bold text-red-700">
                {worstDay.day} {MONTH_NAMES[month].slice(0, 3)}
              </p>
              <p className="text-xs text-gray-500 mt-1">OEE medio {worstDay.avg.toFixed(1)}%</p>
            </div>
          )}
          {mostStopsLine && (
            <div className="card border border-orange-200 bg-orange-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Più fermate</p>
              <p className="text-xl font-bold text-orange-700 truncate">{mostStopsLine.nome}</p>
              <p className="text-xs text-gray-500 mt-1">{mostStopsLine.stops} fermate nel mese</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tooltip ───────────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}>
          <p className="font-semibold mb-1">
            {tooltip.lineName} — {fmtDate(tooltip.cell.data)}{blockSize !== 'day' ? ` ${pad(tooltip.cell.ora)}h-${pad(tooltip.cell.ora + (blockSize as number))}h` : ''}
          </p>
          <p className="text-sm font-bold">{tooltip.cell.oee.toFixed(1)}% OEE</p>
          <div className="mt-1 space-y-0.5 text-gray-300">
            <p>Disponibilità {tooltip.cell.disponibilita.toFixed(1)}%</p>
            <p>Performance {tooltip.cell.performance.toFixed(1)}%</p>
            <p>Produzione {tooltip.cell.pezzi_reali} / {tooltip.cell.pezzi_attesi} pz</p>
            <p>Fermo {tooltip.cell.minuti_fermo} min ({tooltip.cell.fermi_count} fermate)</p>
          </div>
          <p className="mt-1.5 text-gray-500 text-[10px]">Clicca per dettagli giornata</p>
        </div>
      )}

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
      {selectedCell && (
        <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <p className="font-semibold text-gray-800 text-sm">
                {detail?.nome ?? data?.linee.find(l => l.id === selectedCell.lineaId)?.nome}
              </p>
              <p className="text-xs text-gray-400">{fmtDate(selectedCell.date)}</p>
            </div>
            <button onClick={() => { setSelectedCell(null); setDetail(null); }}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
              ✕
            </button>
          </div>

          {detailLoading && (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Caricamento…
            </div>
          )}

          {!detailLoading && detail && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              <div className={`rounded-xl px-4 py-3 ${oeeColor(detail.oee)}`}>
                <p className="text-white text-xs font-semibold uppercase tracking-wide">OEE giornaliero</p>
                <p className="text-white text-3xl font-bold">{detail.oee.toFixed(1)}%</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Disp.', value: `${detail.disponibilita.toFixed(1)}%` },
                  { label: 'Perf.', value: `${detail.performance.toFixed(1)}%` },
                  { label: 'Qual.', value: `${detail.qualita.toFixed(1)}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-lg py-2">
                    <p className="text-[10px] text-gray-400 uppercase font-semibold">{label}</p>
                    <p className="text-sm font-bold text-gray-700">{value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Produzione</span>
                  <span className="font-medium">{detail.pezzi_reali} / {detail.pezzi_pianificati} pz</span>
                </div>
                {detail.pezzi_deliberati > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Delibera</span>
                    <span className="font-medium">{detail.pezzi_conformi} OK / {detail.pezzi_deliberati}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Turno</span>
                  <span className="font-medium">{detail.minuti_turno} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tempo perso</span>
                  <span className="font-medium text-red-600">{detail.minuti_fermo} min</span>
                </div>
              </div>

              {detail.fermate.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Fermate ({detail.fermate.length})
                  </p>
                  <div className="space-y-1.5">
                    {detail.fermate.map((f, i) => (
                      <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs">
                        <span className="font-medium text-red-700">{f.durata_min} min</span>
                        <span className="text-gray-500 ml-2">{fmtTime(f.inizio)} → {fmtTime(f.fine)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.fermate.length === 0 && detail.has_data && (
                <p className="text-sm text-gray-400 text-center py-2">Nessuna fermata registrata</p>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
