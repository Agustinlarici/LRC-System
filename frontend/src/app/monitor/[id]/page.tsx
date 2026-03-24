'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { MonitorStato } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(totalSeconds: number): string {
  const abs = Math.max(0, totalSeconds);
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatLinestop(totalSeconds: number): string {
  const abs = Math.max(0, totalSeconds);
  const hh  = Math.floor(abs / 3600);
  const mm  = Math.floor((abs % 3600) / 60);
  const ss  = abs % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

type ColorState = 'verde' | 'giallo' | 'rosso';

function getColorState(stato: MonitorStato, remaining: number | null): ColorState {
  if (!stato.turno_attivo || stato.cycle_time_sec === null || remaining === null) return 'verde';
  if (remaining <= 0) return 'rosso';
  const pct = (remaining / stato.cycle_time_sec) * 100;
  if (pct > stato.soglie.soglia_giallo) return 'verde';
  if (pct > stato.soglie.soglia_rosso) return 'giallo';
  return 'rosso';
}

const COLORS: Record<ColorState, { bg: string; text: string; sub: string; border: string }> = {
  verde:  { bg: 'bg-[#1a1a1a]', text: 'text-emerald-400',  sub: 'text-gray-500', border: 'border-gray-800' },
  giallo: { bg: 'bg-[#1a1a1a]', text: 'text-yellow-400',   sub: 'text-gray-500', border: 'border-gray-800' },
  rosso:  { bg: 'bg-[#1a1a1a]', text: 'text-red-500',      sub: 'text-gray-500', border: 'border-gray-800' },
};

// ─── Logo file map ────────────────────────────────────────────────────────────

const LOGO_FILES: Record<string, string> = {
  'ferrari':      'ferrari.png',
  'maserati':     'maserati.svg',
  'aston-martin': 'aston-martin.svg',
};
function logoSrc(slug: string) {
  return `/brands/${LOGO_FILES[slug] ?? slug + '.svg'}`;
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function MonitorDisplayPage() {
  const params = useParams();
  const id = params.id as string;

  const [stato, setStato] = useState<MonitorStato | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRemaining, setLocalRemaining] = useState<number | null>(null);
  const [blink, setBlink] = useState(true);
  const [lineStopSec, setLineStopSec] = useState(0);

  // Fetch ogni 5 secondi + refetch immediato quando la tab torna visibile
  useEffect(() => { document.title = 'Andon — STR'; }, []);

  useEffect(() => {
    async function fetchStato() {
      try {
        const data = await api.get<MonitorStato>(`/api/monitor/stato/${id}`);
        setStato(data);
        setError(null);
        setLocalRemaining(data.remaining_sec);
        setLineStopSec(data.linestop_sec ?? 0);
      } catch {
        setError('Errore connessione');
      }
    }
    fetchStato();
    const interval = setInterval(fetchStato, 5_000);

    function onVisible() {
      if (document.visibilityState === 'visible') fetchStato();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);

  // Decrementa ogni secondo — si ferma durante le pause
  useEffect(() => {
    if (stato?.in_pausa) return;
    const tick = setInterval(() => {
      setLocalRemaining(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearInterval(tick);
  }, [stato?.in_pausa]);

  // Incrementa Line Stop ogni secondo quando in overtime (non in pausa)
  const isOvertime = !stato?.in_pausa && localRemaining !== null && localRemaining <= 0;
  useEffect(() => {
    if (!isOvertime) return;
    const t = setInterval(() => setLineStopSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isOvertime]);
  useEffect(() => {
    if (isOvertime) {
      const b = setInterval(() => setBlink(v => !v), 600);
      return () => clearInterval(b);
    }
    setBlink(true);
  }, [isOvertime]);

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (!stato) {
    return (
      <div className="fixed inset-0 bg-[#1a1a1a] flex items-center justify-center">
        <p className="text-gray-400 text-xl font-light tracking-widest">
          {error ?? 'CARICAMENTO...'}
        </p>
      </div>
    );
  }

  // ─── Colori ─────────────────────────────────────────────────────────────────

  const isPausa = stato.in_pausa === true;
  const colorState = getColorState(stato, localRemaining);
  const c = COLORS[colorState];
  const timeDisplay = isPausa || !stato.turno_attivo || localRemaining === null
    ? '--:--'
    : formatTime(localRemaining);

  // Sfondo: grigio durante pausa, lampeggia rosso quando scaduto, altrimenti scuro
  const bgColor = isPausa
    ? '#374151'
    : isOvertime ? (blink ? '#dc2626' : '#1a1a1a') : '#1a1a1a';

  return (
    <div className="fixed inset-0 transition-colors duration-200" style={{ backgroundColor: bgColor }}>
      <div className="w-full h-full grid grid-rows-2">

        {/* ── Riga superiore ─────────────────────────────────────────────── */}
        <div className={`grid grid-cols-3 border-b ${c.border}`}>

          {/* Countdown */}
          <div className={`col-span-2 flex items-center justify-center border-r ${c.border}`}>
            <span
              className={`${c.text} font-semibold tabular-nums tracking-tight transition-colors duration-300`}
              style={{ fontSize: 'clamp(5rem, 20vw, 18rem)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
            >
              {timeDisplay}
            </span>
          </div>

          {/* Nome linea + logo marca */}
          <div className="flex flex-col items-center justify-center gap-3 px-6">
            <span className="text-gray-600 text-xs font-medium tracking-[0.3em] uppercase">
              Linea
            </span>
            <span
              className="text-white font-semibold text-center break-all leading-tight"
              style={{ fontSize: 'clamp(1.8rem, 5vw, 4.5rem)' }}
            >
              {stato.linea.nome}
            </span>
            {stato.linea.logo && (
              <img
                src={logoSrc(stato.linea.logo)}
                alt={stato.linea.logo}
                className="w-full max-w-[324px] object-contain opacity-90"
                style={{ maxHeight: 'clamp(5.4rem, 14.4vh, 12.6rem)' }}
              />
            )}
          </div>
        </div>

        {/* ── Riga inferiore ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-4">

          {/* LINE STOP */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <span
              className="text-white font-semibold tabular-nums"
              style={{ fontSize: 'clamp(1.6rem, 5.5vw, 5rem)', lineHeight: 1 }}
            >
              {formatLinestop(lineStopSec)}
            </span>
            <span className="text-gray-500 text-xs font-medium tracking-[0.2em] uppercase mt-4">
              Line Stop
            </span>
          </div>

          {/* QTA' PRODOTTA */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <span
              className="text-white font-semibold tabular-nums"
              style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
            >
              {stato.qta_prodotta}
            </span>
            <span className="text-gray-500 text-xs font-medium tracking-[0.2em] uppercase mt-4">
              Qtà Prodotta
            </span>
          </div>

          {/* AVANZAMENTO PREVISTO */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <span
              className="text-white font-semibold tabular-nums"
              style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
            >
              {stato.turno_attivo ? stato.avanzamento_previsto : '—'}
            </span>
            <span className="text-gray-500 text-xs font-medium tracking-[0.2em] uppercase mt-4">
              Avanz. Previsto
            </span>
          </div>

          {/* PIANO TOTALE */}
          <div className="flex flex-col items-center justify-center">
            <span
              className="text-white font-semibold tabular-nums"
              style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
            >
              {stato.turno_attivo ? stato.qta_da_produrre : '—'}
            </span>
            <span className="text-gray-500 text-xs font-medium tracking-[0.2em] uppercase mt-4">
              Piano Totale
            </span>
          </div>
        </div>

      </div>

      {/* Nessun turno */}
      {!stato.turno_attivo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-white text-xl font-light tracking-widest uppercase">
            Nessun turno attivo
          </p>
        </div>
      )}

      {/* Pausa */}
      {isPausa && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-300 text-2xl font-light tracking-[0.4em] uppercase">
            Pausa
          </p>
        </div>
      )}
    </div>
  );
}
