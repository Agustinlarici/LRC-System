'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Targets — change here to adjust KPI thresholds ──────────────────────────
const OEE_TARGET      = 80;  // % — verde ≥80, giallo ≥72, rosso <72
const QUALITA_TARGET  = 97;  // % — verde ≥97, giallo ≥87.3, rosso <87.3
const PROD_WARN_PCT   = 0.8; // produzione bar: verde ≥80% del piano
const SCRAP_WARN_PCT  = 5;   // % scrap — sopra questa soglia appare in "Richiede attenzione"

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

function kpiBg(value: number, target: number): string {
  if (value >= target)        return 'bg-green-50 border-green-200';
  if (value >= target * 0.9)  return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
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

function oeeTextColor(oee: number): string {
  if (oee >= OEE_TARGET) return 'text-green-600';
  if (oee >= 60)         return 'text-yellow-500';
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/monitor/executive`, { credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status}`);
      const d: DashboardData = await r.json();
      setData(d);
      setError('');
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 10 * 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

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

  // Issues for "Richiede attenzione" — sorted: stops first, then scrap, then OEE, then production
  const issues: Array<{ id: number; nome: string; msg: string; level: 'red' | 'yellow' }> = [];
  for (const l of linee) {
    if (!l.turno_oggi) continue;
    if (l.ferma_adesso) {
      issues.push({ id: l.id, nome: l.nome, msg: `Ferma da ${l.ferma_da_min ?? '?'} min`, level: 'red' });
    }
    if (l.pezzi_deliberati > 0) {
      const scrapPct = (l.pezzi_deliberati - l.pezzi_conformi) / l.pezzi_deliberati * 100;
      if (scrapPct > SCRAP_WARN_PCT) {
        issues.push({ id: l.id, nome: l.nome, msg: `Scrap ${scrapPct.toFixed(1)}% (${l.pezzi_deliberati - l.pezzi_conformi} pz)`, level: 'red' });
      }
    }
    if (!l.ferma_adesso && l.oee > 0 && l.oee < OEE_TARGET) {
      issues.push({ id: l.id, nome: l.nome, msg: `OEE ${l.oee.toFixed(1)}%`, level: 'yellow' });
    } else if (l.pezzi_pianificati > 0 && l.pezzi_reali / l.pezzi_pianificati < 0.6) {
      issues.push({ id: l.id, nome: l.nome, msg: `Produzione ${l.pezzi_reali} / ${l.pezzi_pianificati} pz`, level: 'yellow' });
    }
  }

  return (
    <div className="space-y-6">

      {/* ── KPI row + timestamp ───────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">

        {/* OEE Generale */}
        <div className={`card border ${kpiBg(kpi.oee_generale, OEE_TARGET)}`}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">OEE Generale</p>
          <p className={`text-3xl font-bold leading-none ${kpiTextColor(kpi.oee_generale, OEE_TARGET)}`}>
            {kpi.oee_generale.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 mt-1.5">obiettivo {OEE_TARGET}%</p>
        </div>

        {/* Tempo Perso */}
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tempo Perso</p>
          <p className="text-3xl font-bold text-gray-800 leading-none">{kpi.tempo_perso_min}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            min &nbsp;·&nbsp; {kpi.fermi_count} {kpi.fermi_count === 1 ? 'fermo' : 'fermi'}
          </p>
        </div>

        {/* Produzione */}
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Produzione</p>
          <p className="text-3xl font-bold text-gray-800 leading-none">
            {kpi.produzione_reale}
            <span className="text-lg font-normal text-gray-400"> / {kpi.produzione_pianificata}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1.5">pezzi reali / pianificati</p>
        </div>

        {/* Qualità */}
        {kpi.qualita_pct != null ? (
          <div className={`card border ${kpiBg(kpi.qualita_pct, QUALITA_TARGET)}`}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Qualità</p>
            <p className={`text-3xl font-bold leading-none ${kpiTextColor(kpi.qualita_pct, QUALITA_TARGET)}`}>
              {kpi.qualita_pct.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-400 mt-1.5">obiettivo {QUALITA_TARGET}%</p>
          </div>
        ) : (
          <div className="card">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Qualità</p>
            <p className="text-3xl font-bold text-gray-300 leading-none">—</p>
            <p className="text-xs text-gray-400 mt-1.5">nessun dato delibera oggi</p>
          </div>
        )}
        </div>
        <div className="text-right shrink-0 pt-1">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Aggiornato alle</p>
          <p className="text-sm font-mono font-semibold text-gray-700">{fmtTime(aggiornato_at)}</p>
        </div>
      </div>

      {/* ── Richiede attenzione / Tutto ok banner ─────────────────────────── */}
      {issues.length > 0 ? (
        <div className="card border border-orange-200 bg-orange-50">
          <p className="text-sm font-semibold text-orange-800 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
            Richiede attenzione
          </p>
          <ul className="space-y-1.5">
            {issues.map((iss, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 inline-block ${iss.level === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`} />
                <span className="font-semibold text-gray-800">{iss.nome}</span>
                <span className="text-gray-500">{iss.msg}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="card border border-green-200 bg-green-50 flex items-center gap-3 py-4">
          <span className="w-3 h-3 rounded-full bg-green-500 shrink-0 inline-block" />
          <p className="text-sm font-semibold text-green-800">Tutto sotto controllo</p>
        </div>
      )}

      {/* ── Line cards grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {linee.map(l => (
          <div
            key={l.id}
            className={`card border-l-4 ${BORDER_COLOR[l.status]} space-y-3`}
          >
            {/* Card header: status dot + name + fermo badge */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 inline-block ${DOT_COLOR[l.status]}`} />
                <span className="font-semibold text-gray-900 text-sm truncate">{l.nome}</span>
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
                {/* Bar 1: Disponibilità */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-gray-500">Disponibilità</span>
                    <span className="font-semibold text-gray-700">{l.disponibilita.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${l.disponibilita >= 90 ? 'bg-green-500' : l.disponibilita >= 70 ? 'bg-yellow-400' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, l.disponibilita)}%` }}
                    />
                  </div>
                </div>

                {/* Bar 2: Pezzi prodotti vs avanzamento previsto */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-gray-500">Produzione</span>
                    <span className="font-semibold text-gray-700">
                      {l.pezzi_reali} / {l.avanzamento_previsto} pz
                      <span className="text-gray-400 font-normal"> su {l.pezzi_pianificati}</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${prodBarColor(l.pezzi_reali, l.avanzamento_previsto)}`}
                      style={{ width: `${prodBarPct(l.pezzi_reali, l.avanzamento_previsto)}%` }}
                    />
                  </div>
                </div>

                {/* Bar 3: Qualità (pezzi OK) */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-gray-500">Qualità</span>
                    {l.pezzi_deliberati > 0 ? (
                      <span className="font-semibold text-gray-700">
                        {l.pezzi_conformi} OK · {l.pezzi_deliberati - l.pezzi_conformi} scrap
                      </span>
                    ) : (
                      <span className="text-gray-400">nessun dato</span>
                    )}
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    {l.pezzi_deliberati > 0 && (
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          l.qualita >= 97 ? 'bg-green-500'
                          : l.qualita >= 90 ? 'bg-yellow-400'
                          : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.round(l.pezzi_conformi / l.pezzi_deliberati * 100)}%` }}
                      />
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-100" />

                {/* OEE */}
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-medium">OEE</p>
                  <p className={`text-2xl font-bold leading-none ${oeeTextColor(l.oee)}`}>
                    {l.oee.toFixed(1)}%
                  </p>
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
          <div className="card">
            <p className="text-sm font-semibold text-gray-700 mb-3">Fermate del giorno</p>
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
                      <td className="py-2 text-right font-semibold text-gray-700">{f.durata_min} min</td>
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
