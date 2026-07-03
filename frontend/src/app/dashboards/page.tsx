'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Targets — change here to adjust KPI thresholds ──────────────────────────
const OEE_TARGET      = 80;  // % — verde ≥80, giallo ≥72, rosso <72
const QUALITA_TARGET  = 97;  // % — verde ≥97, giallo ≥87.3, rosso <87.3
const PROD_WARN_PCT   = 0.8; // produzione: verde ≥80% del piano, giallo ≥60%

// ─── Types ────────────────────────────────────────────────────────────────────

type Fermata = { inizio: string; fine: string | null; durata_min: number };

type LineaSummary = {
  id:                number;
  nome:              string;
  logo:              string | null;
  pezzi_reali:          number;
  pezzi_pianificati:    number;
  avanzamento_previsto: number;
  pezzi_conformi:       number;
  pezzi_deliberati:  number;
  minuti_turno:      number;
  minuti_fermo:      number;
  disponibilita:     number;
  performance:       number;
  qualita:           number;
  oee:               number;
  turno_oggi:        boolean;
  ferma_adesso:      boolean;
  ferma_da_min:      number | null;
  fermi_count:       number;
  fermate:           Fermata[];
  status:            'verde' | 'giallo' | 'rosso' | 'nessun_turno';
};

type KPI = {
  oee_generale:           number;
  tempo_perso_min:        number;
  fermi_count:            number;
  produzione_reale:       number;
  produzione_pianificata: number;
  qualita_pct:            number | null;
};

type DashboardData = {
  aggiornato_at: string;
  date:          string;
  is_historical: boolean;
  delibera_fasi: string[];
  kpi:           KPI;
  linee:         LineaSummary[];
};

// ─── Color helpers ────────────────────────────────────────────────────────────

function kpiTextColor(value: number, target: number): string {
  if (value >= target)        return 'text-green-600';
  if (value >= target * 0.9)  return 'text-yellow-500';
  return 'text-red-600';
}

function oeeTextColor(oee: number): string {
  if (oee >= OEE_TARGET) return 'text-green-600';
  if (oee >= 60)         return 'text-yellow-500';
  return 'text-red-600';
}

function oeeStatus(oee: number): 'verde' | 'giallo' | 'rosso' {
  if (oee >= OEE_TARGET) return 'verde';
  if (oee >= 60)         return 'giallo';
  return 'rosso';
}

function prodBarColor(reali: number, pianificati: number): string {
  if (pianificati === 0) return 'bg-gray-300';
  const r = reali / pianificati;
  if (r >= PROD_WARN_PCT) return 'bg-green-500';
  if (r >= 0.6)           return 'bg-yellow-400';
  return 'bg-red-500';
}

function prodBarPct(reali: number, pianificati: number): number {
  if (pianificati === 0) return 0;
  return Math.min(100, Math.round(reali / pianificati * 100));
}

function ratioPct(reale: number, pianificata: number): number {
  return pianificata === 0 ? 0 : reale / pianificata * 100;
}

function ratioText(pct: number): string {
  if (pct >= PROD_WARN_PCT * 100) return 'text-green-600';
  if (pct >= 60)                  return 'text-yellow-500';
  return 'text-red-600';
}

const BORDER_COLOR: Record<string, string> = {
  verde:        'border-l-green-500',
  giallo:       'border-l-yellow-400',
  rosso:        'border-l-red-500',
  nessun_turno: 'border-l-gray-200',
};

const DOT_COLOR: Record<string, string> = {
  verde:        'bg-green-500',
  giallo:       'bg-yellow-400',
  rosso:        'bg-red-500 animate-pulse',
  nessun_turno: 'bg-gray-300',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── OEE gauge — car-dashboard style arc, open at the bottom ──────────────────

const GAUGE_GAP   = 64;                 // degrees left open at the bottom
const GAUGE_START = 90 + GAUGE_GAP / 2; // start angle (bottom-left), 0deg = 3 o'clock, clockwise
const GAUGE_SWEEP = 360 - GAUGE_GAP;    // total arc sweep

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start    = polarToCartesian(cx, cy, r, startDeg);
  const end      = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function OeeGauge({ value, size, strokeWidth, fontSizeClass }: {
  value: number; size: number; strokeWidth: number; fontSizeClass: string;
}) {
  const cx          = size / 2;
  const cy           = size / 2;
  const r             = (size - strokeWidth) / 2;
  const clamped       = Math.max(0, Math.min(100, value));
  const colorClass    = oeeTextColor(value);
  const trackD        = arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP);
  const progressD     = clamped > 0 ? arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP * (clamped / 100)) : '';

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={trackD} fill="none" strokeWidth={strokeWidth} strokeLinecap="round" stroke="currentColor" className="text-gray-200" />
        {progressD && (
          <path
            d={progressD} fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
            stroke="currentColor" className={`${colorClass} transition-all duration-700 ease-out`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-semibold leading-none ${colorClass} ${fontSizeClass}`}>
          {value.toFixed(1)}<span className="text-[0.4em] font-medium text-gray-400 align-top">%</span>
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const fetchData = useCallback(async (date: string) => {
    try {
      const params = date !== todayStr ? `?date=${date}` : '';
      const r = await fetch(`${BACKEND}/api/monitor/executive${params}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status}`);
      const d: DashboardData = await r.json();
      setData(d);
      setError('');
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, [todayStr]);

  useEffect(() => {
    fetchData(selectedDate);
    // Auto-refresh only for today
    if (selectedDate === todayStr) {
      const id = setInterval(() => fetchData(selectedDate), 10 * 60_000);
      return () => clearInterval(id);
    }
  }, [fetchData, selectedDate, todayStr]);

  if (loading) {
    return <div className="text-sm text-gray-400 py-16 text-center">Caricamento…</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-10 text-center">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { kpi, linee, aggiornato_at } = data;
  const prodPct = ratioPct(kpi.produzione_reale, kpi.produzione_pianificata);

  return (
    <div className="space-y-6">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Dashboard Produzione</h1>
          <p className="text-xs text-gray-400 mt-0.5">Stato in tempo reale delle linee — OEE, produzione e qualità</p>
        </div>
        <div className="flex items-center gap-3">
          {data.is_historical ? (
            <span className="text-xs text-blue-500 font-medium">Storico — {selectedDate}</span>
          ) : (
            <span className="text-xs text-gray-400">Aggiornato alle {fmtTime(aggiornato_at)}</span>
          )}
          <input
            type="date"
            value={selectedDate}
            max={todayStr}
            onChange={e => { setSelectedDate(e.target.value); setLoading(true); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* ── KPI stat strip ─────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-gray-100 lg:divide-y-0 lg:divide-x">

          {/* OEE — headline gauge, gets extra visual emphasis */}
          <div className={`p-5 flex items-center gap-5 border-l-4 ${BORDER_COLOR[oeeStatus(kpi.oee_generale)]}`}>
            <OeeGauge value={kpi.oee_generale} size={148} strokeWidth={12} fontSizeClass="text-5xl" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">OEE</p>
              <p className="text-xs text-gray-400 mt-1">obiettivo {OEE_TARGET}%</p>
            </div>
          </div>

          {/* Tempo Perso */}
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Tempo Perso</p>
            <p className="text-5xl font-semibold text-gray-900 leading-none mt-2">
              {kpi.tempo_perso_min}<span className="text-lg font-medium text-gray-400 ml-1">min</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {kpi.fermi_count} {kpi.fermi_count === 1 ? 'fermo' : 'fermi'}
            </p>
          </div>

          {/* Produzione */}
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Produzione</p>
            <p className="text-5xl font-semibold leading-none mt-2">
              <span className={ratioText(prodPct)}>{kpi.produzione_reale}</span>
              <span className="text-xl font-medium text-gray-400"> / {kpi.produzione_pianificata}</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">pezzi reali / attesi ad ora</p>
          </div>

          {/* Qualità */}
          <div className="p-5">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide">Qualità</p>
            {kpi.qualita_pct != null ? (
              <>
                <p className={`text-5xl font-semibold leading-none mt-2 ${kpiTextColor(kpi.qualita_pct, QUALITA_TARGET)}`}>
                  {kpi.qualita_pct.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400 mt-2">obiettivo {QUALITA_TARGET}%</p>
              </>
            ) : (
              <>
                <p className="text-5xl font-semibold text-gray-300 leading-none mt-2">—</p>
                <p className="text-xs text-gray-400 mt-2">nessun dato delibera oggi</p>
              </>
            )}
          </div>

        </div>
      </div>

      {/* ── Line cards grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {linee.map(l => (
          <div
            key={l.id}
            className={`card border-l-2 p-5 ${BORDER_COLOR[l.status]}`}
          >
            {/* Card header: status dot + name + fermo badge */}
            <div className="flex items-center justify-between gap-2 min-w-0 mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 inline-block ${DOT_COLOR[l.status]}`} />
                <span className="font-medium text-gray-900 text-base truncate">{l.nome}</span>
              </div>
              {l.ferma_adesso && l.ferma_da_min != null && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0 whitespace-nowrap">
                  Ferma {l.ferma_da_min} min
                </span>
              )}
            </div>

            {!l.turno_oggi ? (
              <p className="text-xs text-gray-400 text-center py-3">Nessun turno configurato</p>
            ) : (
              <>
                {/* OEE gauge — hero metric, centered on top */}
                <div className="flex flex-col items-center pb-4 mb-4 border-b border-gray-100">
                  <OeeGauge value={l.oee} size={128} strokeWidth={10} fontSizeClass="text-3xl" />
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mt-2">OEE</p>
                </div>

                {/* Contributing bars — thin */}
                <div className="space-y-2.5">
                  {/* Disponibilità */}
                  <div>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">Disponibilità</span>
                      <span className="text-sm font-medium text-gray-900">{l.disponibilita.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${l.disponibilita >= 90 ? 'bg-green-500' : l.disponibilita >= 70 ? 'bg-yellow-400' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, l.disponibilita)}%` }}
                      />
                    </div>
                  </div>

                  {/* Produzione */}
                  <div>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">Produzione</span>
                      <span className="text-sm">
                        <span className="font-medium text-gray-900">{l.pezzi_reali}</span>
                        <span className="text-gray-500"> / {l.avanzamento_previsto}</span>
                        <span className="text-gray-400"> · su {l.pezzi_pianificati}</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${prodBarColor(l.pezzi_reali, l.avanzamento_previsto)}`}
                        style={{ width: `${prodBarPct(l.pezzi_reali, l.avanzamento_previsto)}%` }}
                      />
                    </div>
                  </div>

                  {/* Qualità */}
                  <div>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">Qualità</span>
                      {l.pezzi_deliberati > 0 ? (
                        <span className="text-sm">
                          <span className="font-medium text-gray-900">{l.pezzi_conformi} OK</span>
                          <span className={l.pezzi_deliberati - l.pezzi_conformi > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                            {' '}· {l.pezzi_deliberati - l.pezzi_conformi} scrap
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">nessun dato</span>
                      )}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      {l.pezzi_deliberati > 0 && (
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            l.qualita >= 97 ? 'bg-green-500'
                            : l.qualita >= 90 ? 'bg-yellow-400'
                            : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.round(l.pezzi_conformi / l.pezzi_deliberati * 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Fermate del giorno ────────────────────────────────────────────── */}
      {(() => {
        const tutteLeFormate = linee
          .flatMap(l => l.fermate.map(f => ({ ...f, linea: l.nome })))
          .sort((a, b) => new Date(b.inizio).getTime() - new Date(a.inizio).getTime());
        if (tutteLeFormate.length === 0) return null;
        return (
          <div className="card p-5">
            <p className="text-lg font-medium text-gray-700 mb-3">Fermate del giorno</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Linea</th>
                    <th className="pb-2 font-medium">Inizio</th>
                    <th className="pb-2 font-medium">Fine</th>
                    <th className="pb-2 font-medium text-right">Durata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tutteLeFormate.map((f, i) => (
                    <tr key={i} className={f.fine === null ? 'bg-red-50' : ''}>
                      <td className="py-2 font-medium text-gray-800">{f.linea}</td>
                      <td className="py-2 text-gray-600">{fmtTime(f.inizio)}</td>
                      <td className="py-2 text-gray-600">
                        {f.fine ? fmtTime(f.fine) : (
                          <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                            in corso
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-medium text-gray-700">{f.durata_min} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
