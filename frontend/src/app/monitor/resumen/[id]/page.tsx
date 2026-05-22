'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { MonitorResumenDettaglio, MonitorResumenLinea, MonitorStato } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimer(totalSeconds: number): string {
  const abs = Math.max(0, totalSeconds);
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatLinestop(totalSeconds: number): string {
  const abs = Math.max(0, totalSeconds);
  const hh = Math.floor(abs / 3600);
  const mm = Math.floor((abs % 3600) / 60);
  const ss = abs % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

type ColorState = 'verde' | 'giallo' | 'rosso' | 'grigio';

function getColorState(stato: MonitorStato, remaining: number | null): ColorState {
  if (!stato.turno_attivo || stato.in_pausa) return 'grigio';
  if (stato.cycle_time_sec === null || remaining === null) return 'grigio';
  if (remaining <= 0) return 'rosso';
  const pct = (remaining / stato.cycle_time_sec) * 100;
  if (pct > stato.soglie.soglia_giallo) return 'verde';
  return 'giallo';
}

const DOT_COLOR: Record<ColorState, string> = {
  verde:  'bg-emerald-500',
  giallo: 'bg-yellow-400',
  rosso:  'bg-red-500',
  grigio: 'bg-zinc-600',
};
const BAR_COLOR: Record<ColorState, string> = {
  verde:  'bg-emerald-500',
  giallo: 'bg-yellow-400',
  rosso:  'bg-red-500',
  grigio: 'bg-zinc-700',
};
const TIMER_COLOR: Record<ColorState, string> = {
  verde:  'text-emerald-400',
  giallo: 'text-yellow-400',
  rosso:  'text-red-500',
  grigio: 'text-zinc-500',
};
const LEFT_BORDER: Record<ColorState, string> = {
  verde:  'border-l-emerald-500',
  giallo: 'border-l-yellow-400',
  rosso:  'border-l-red-500',
  grigio: 'border-l-zinc-700',
};

// ─── Row state ────────────────────────────────────────────────────────────────

interface RowState {
  stato: MonitorStato;
  remaining: number | null;
  lineStop: number;
  blink: boolean;
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function ResumenDisplayPage() {
  const params = useParams();
  const resumenId = params.id as string;

  const [resumen, setResumen] = useState<MonitorResumenDettaglio | null>(null);
  const [linee, setLinee]     = useState<MonitorResumenLinea[]>([]);
  const [rows, setRows]       = useState<Record<number, RowState>>({});
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => { document.title = 'Riepilogo Andon — STR'; }, []);

  useEffect(() => {
    api.get<MonitorResumenDettaglio>(`/api/monitor/resumen/${resumenId}`)
      .then(data => {
        setResumen(data);
        setLinee(data.linee.filter(l => l.attivo));
        document.title = `${data.nome} — STR`;
      })
      .catch(() => setError('Riepilogo non trovato'));
  }, [resumenId]);

  const fetchAll = useCallback(async (ids: number[]) => {
    await Promise.all(ids.map(async id => {
      try {
        const stato = await api.get<MonitorStato>(`/api/monitor/stato/${id}`);
        setRows(prev => ({
          ...prev,
          [id]: {
            stato,
            remaining: stato.remaining_sec,
            lineStop:  stato.linestop_sec ?? 0,
            blink:     prev[id]?.blink ?? true,
          },
        }));
      } catch { /* mantieni stato precedente */ }
    }));
  }, []);

  useEffect(() => {
    if (linee.length === 0) return;
    const ids = linee.map(l => l.linea_id);
    fetchAll(ids);
    const interval = setInterval(() => fetchAll(ids), 5_000);
    function onVisible() {
      if (document.visibilityState === 'visible') fetchAll(ids);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [linee, fetchAll]);

  useEffect(() => {
    const tick = setInterval(() => {
      setRows(prev => {
        const next: Record<number, RowState> = {};
        for (const key in prev) {
          const id  = Number(key);
          const row = prev[id];
          if (row.stato.in_pausa) { next[id] = row; continue; }
          const newRemaining = row.remaining !== null ? row.remaining - 1 : null;
          const overtime     = newRemaining !== null && newRemaining <= 0;
          next[id] = {
            ...row,
            remaining: newRemaining,
            lineStop:  overtime ? row.lineStop + 1 : row.lineStop,
            blink:     overtime ? !row.blink : true,
          };
        }
        return next;
      });
    }, 1_000);
    return () => clearInterval(tick);
  }, []);

  // ─── Loading / error ────────────────────────────────────────────────────────

  if (error || (!resumen && !error)) {
    return (
      <div className="fixed inset-0 bg-[#111] flex items-center justify-center">
        <p className="text-gray-400 text-xl font-light tracking-widest">
          {error ?? 'CARICAMENTO...'}
        </p>
      </div>
    );
  }

  const loadedLinee = linee.filter(l => rows[l.linea_id]);

  return (
    <div className="fixed inset-0 bg-[#111] text-white overflow-auto">
      <div className="p-4 flex flex-col gap-2 min-h-full">

        {/* Header */}
        <div className="mb-3">
          <h1 className="text-2xl font-semibold text-white tracking-wide">{resumen!.nome}</h1>
        </div>

        {/* Intestazioni colonne */}
        {loadedLinee.length > 0 && (
          <div
            className="grid px-5 mb-1 text-lg font-semibold text-white uppercase tracking-widest"
            style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1.5fr 1fr 1fr 1fr' }}
          >
            <span>Linea</span>
            <span className="text-center">Commessa</span>
            <span className="text-center">Timer</span>
            <span className="text-center">Line Stop</span>
            <span className="text-center leading-tight">Qtà<br />Prodotta</span>
            <span className="text-center leading-tight">Avanz.<br />Previsto</span>
            <span className="text-center">Piano Totale</span>
          </div>
        )}

        {/* Righe */}
        {linee.length === 0 && (
          <p className="text-center py-20 text-zinc-600">Nessuna linea attiva in questo riepilogo</p>
        )}

        {loadedLinee.map(linea => {
          const row        = rows[linea.linea_id]!;
          const colorState = getColorState(row.stato, row.remaining);
          const overtime   = !row.stato.in_pausa && row.remaining !== null && row.remaining <= 0;
          const isPausa    = row.stato.in_pausa === true;

          const rowBg = isPausa
            ? 'bg-zinc-700/60'
            : overtime
              ? (row.blink ? 'bg-red-950/60' : 'bg-[#1c1c1c]')
              : 'bg-[#1c1c1c]';

          const timeDisplay = isPausa || !row.stato.turno_attivo || row.remaining === null
            ? '--:--'
            : row.remaining <= 0
              ? `-${formatTimer(Math.abs(row.remaining))}`
              : formatTimer(row.remaining);

          const cycleTime = row.stato.cycle_time_sec;
          const hasBar = cycleTime !== null && row.remaining !== null && row.stato.turno_attivo && !isPausa;
          const progressPct = hasBar
            ? Math.max(0, Math.min(100, ((cycleTime! - row.remaining!) / cycleTime!) * 100))
            : 0;

          const qtaInRitardo = row.stato.turno_attivo &&
            row.stato.avanzamento_previsto != null &&
            row.stato.qta_prodotta < row.stato.avanzamento_previsto;

          return (
            <div
              key={linea.linea_id}
              className={`grid items-center rounded-xl border border-zinc-800 border-l-4
                ${LEFT_BORDER[colorState]} ${rowBg} px-5 py-5 transition-colors duration-300`}
              style={{ gridTemplateColumns: '2fr 1.5fr 1.5fr 1.5fr 1fr 1fr 1fr' }}
            >
              {/* Linea */}
              <div className="flex items-center gap-4 min-w-0">
                <div className={`w-3 h-3 rounded-full shrink-0 ${DOT_COLOR[colorState]}`} />
                <div className="min-w-0">
                  <p className="font-semibold text-white text-3xl leading-tight truncate">{linea.nome}</p>
                  {linea.fase && <p className="text-sm text-zinc-500 mt-0.5 truncate">{linea.fase}</p>}
                  {isPausa && <span className="text-sm text-zinc-400 font-medium uppercase tracking-widest">Pausa</span>}
                  {!row.stato.turno_attivo && <span className="text-sm text-zinc-600 uppercase tracking-widest">Nessun turno</span>}
                </div>
              </div>

              {/* Commesse */}
              <div className="flex flex-col items-center justify-center gap-0.5 px-2">
                {row.stato.commesse.length === 0
                  ? <span className="text-lg text-zinc-500 italic">In attesa di picking</span>
                  : row.stato.commesse.map(c => (
                      <span key={c} className="text-2xl font-semibold text-white leading-tight">{c}</span>
                    ))
                }
              </div>

              {/* Timer + barra + elapsed */}
              <div className="flex flex-col items-center gap-1.5 px-2">
                <span className={`text-4xl font-semibold tabular-nums ${TIMER_COLOR[colorState]}`}>
                  {timeDisplay}
                </span>
                <div className="w-1/2 bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${BAR_COLOR[colorState]}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xl text-zinc-400 tabular-nums font-normal">
                  {hasBar && row.remaining !== null
                    ? `${formatTimer(Math.max(0, cycleTime! - row.remaining!))} / ${formatTimer(cycleTime!)}`
                    : ' '}
                </span>
              </div>

              {/* Line Stop */}
              <div className="text-center">
                <span className="text-3xl font-semibold tabular-nums text-white">
                  {formatLinestop(row.lineStop)}
                </span>
              </div>

              {/* Qtà Prodotta */}
              <div className="text-center">
                <span className={`text-4xl font-semibold tabular-nums ${qtaInRitardo ? 'text-red-500' : 'text-white'}`}>
                  {row.stato.qta_prodotta}
                </span>
              </div>

              {/* Avanzamento Previsto */}
              <div className="text-center">
                <span className="text-4xl font-semibold tabular-nums text-white">
                  {row.stato.turno_attivo ? row.stato.avanzamento_previsto : '—'}
                </span>
              </div>

              {/* Piano Totale */}
              <div className="text-center">
                <span className="text-4xl font-semibold tabular-nums text-white">
                  {row.stato.turno_attivo ? row.stato.qta_da_produrre : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
