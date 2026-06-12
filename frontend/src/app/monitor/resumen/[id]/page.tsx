'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { MonitorResumenDettaglio, MonitorResumenLinea, MonitorStato } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimer(totalSeconds: number): string {
  const abs = Math.max(0, Math.floor(totalSeconds));
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
  if (stato.commesse.length === 0 && !stato.fermata_manuale) return 'rosso';
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
  const [blinkOn, setBlinkOn] = useState(true);
  const prevCommesseKeysRef   = useRef<Record<number, string>>({});

  useEffect(() => {
    const t = setInterval(() => setBlinkOn(v => !v), 700);
    return () => clearInterval(t);
  }, []);

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
        const currKey = stato.commesse.slice().sort().join(',');
        const commesseArrivate = currKey !== (prevCommesseKeysRef.current[id] ?? '') && stato.commesse.length > 0;
        prevCommesseKeysRef.current[id] = currKey;
        setRows(prev => {
          const existing = prev[id];
          const serverRemaining = stato.remaining_sec;
          const serverLineStop  = stato.linestop_sec ?? 0;
          let remaining: number | null;
          if (serverRemaining === null) {
            remaining = null;
          } else if (!existing || existing.remaining === null) {
            remaining = serverRemaining;
          } else if (commesseArrivate && existing.remaining <= 0 && stato.cycle_time_sec !== null) {
            remaining = stato.cycle_time_sec;
          } else if (existing.stato.fermata_manuale && !stato.fermata_manuale) {
            // Uscita da fermata → sincronizza sempre col server (evita timer che continuano)
            remaining = serverRemaining;
          } else if (stato.fermata_manuale && stato.turno_attivo) {
            remaining = -(stato.fermata_elapsed_sec ?? 0);
          } else if (stato.commesse.length === 0 && stato.turno_attivo) {
            remaining = existing.remaining < 0 ? existing.remaining : serverRemaining;
          } else if (existing.remaining < 0 && serverRemaining < 0) {
            // Entrambi in overtime: sincronizza solo se server è >8s avanti (evita salti da drift del poll)
            remaining = serverRemaining < existing.remaining - 8 ? serverRemaining : existing.remaining;
          } else if (Math.abs(existing.remaining - serverRemaining) >= 2) {
            remaining = serverRemaining;
          } else {
            remaining = existing.remaining;
          }
          // Non scende mai sotto il valore locale (es. dopo termina fermata il server manda 0)
          const lineStop = !existing ? serverLineStop : Math.max(existing.lineStop, serverLineStop);
          return {
            ...prev,
            [id]: { stato, remaining, lineStop, blink: existing?.blink ?? true },
          };
        });
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

  const count = loadedLinee.length;
  const sz = count <= 2
    ? { nome: 'text-3xl', commessa: 'text-4xl', timer: 'text-4xl', linestop: 'text-3xl', num: 'text-4xl', sub: 'text-base' }
    : count <= 5
    ? { nome: 'text-xl',  commessa: 'text-3xl', timer: 'text-3xl', linestop: 'text-2xl', num: 'text-3xl', sub: 'text-sm'  }
    : { nome: 'text-lg',  commessa: 'text-2xl', timer: 'text-2xl', linestop: 'text-xl',  num: 'text-2xl', sub: 'text-xs'  };

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

          const rowBg = isPausa ? 'bg-zinc-700/60' : overtime ? 'bg-red-950/60' : 'bg-[#1c1c1c]';

          const timeDisplay =
            isPausa || !row.stato.turno_attivo || row.remaining === null ? '--:--'
            : row.remaining <= 0 ? `+${formatTimer(Math.abs(row.remaining))}`
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
                  <p className={`font-semibold text-white ${sz.nome} leading-tight truncate`}>{linea.nome}</p>
                  {linea.fase && <p className={`${sz.sub} text-zinc-500 mt-0.5 truncate`}>{linea.fase}</p>}
                  {isPausa && <span className={`${sz.sub} text-zinc-400 font-medium uppercase tracking-widest`}>Pausa</span>}
                  {!row.stato.turno_attivo && <span className={`${sz.sub} text-zinc-600 uppercase tracking-widest`}>Nessun turno</span>}
                </div>
              </div>

              {/* Commesse */}
              <div className="flex flex-col items-center justify-center gap-0.5 px-2">
                {row.stato.commesse.length === 0
                  ? <span className={`${sz.commessa} font-bold text-red-500 transition-opacity duration-100 ${blinkOn ? 'opacity-100' : 'opacity-0'}`}>In attesa di picking</span>
                  : (() => {
                      const nc = row.stato.commesse.length;
                      const steps = nc <= 1 ? 0 : nc === 2 ? 1 : 2;
                      const sizes = ['text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl'];
                      const base  = sizes.indexOf(sz.commessa);
                      const cls   = sizes[Math.max(0, base - steps)];
                      return row.stato.commesse.map(c => (
                        <span key={c} className={`${cls} font-semibold text-white leading-tight`}>{c}</span>
                      ));
                    })()
                }
              </div>

              {/* Timer + barra */}
              <div className="flex flex-col items-center gap-1.5 px-2">
                <span className={`${sz.timer} font-semibold tabular-nums ${TIMER_COLOR[colorState]}`}>
                  {timeDisplay}
                </span>
                <div className="w-1/2 bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${BAR_COLOR[colorState]}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Line Stop */}
              <div className="text-center">
                <span className="text-4xl font-semibold tabular-nums text-white">
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
