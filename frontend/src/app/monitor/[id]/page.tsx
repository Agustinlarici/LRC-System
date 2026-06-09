'use client';

import { useEffect, useRef, useState } from 'react';
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
  return 'giallo';
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
  const [blinkOn, setBlinkOn] = useState(true);
  const prevCommesseKeyRef = useRef<string>('');

  useEffect(() => {
    const t = setInterval(() => setBlinkOn(v => !v), 700);
    return () => clearInterval(t);
  }, []);

  // Fetch ogni 5 secondi + refetch immediato quando la tab torna visibile
  useEffect(() => { document.title = 'Andon — STR'; }, []);

  useEffect(() => {
    async function fetchStato() {
      try {
        const data = await api.get<MonitorStato>(`/api/monitor/stato/${id}`);
        setStato(data);
        setError(null);
        const currKey = data.commesse.slice().sort().join(',');
        const commesseArrivate = currKey !== prevCommesseKeyRef.current && data.commesse.length > 0;
        prevCommesseKeyRef.current = currKey;
        setLocalRemaining(prev => {
          if (data.remaining_sec === null) return null;
          // Nuove commesse arrivate mentre in overtime → reset a cycle time
          if (commesseArrivate && prev !== null && prev <= 0 && data.cycle_time_sec !== null) return data.cycle_time_sec;
          // In attesa di picking o fermata manuale
          const isBlocked = (data.commesse.length === 0 || data.fermata_manuale) && data.turno_attivo;
          if (isBlocked) {
            if (prev !== null && prev < 0) return prev;
            if (data.remaining_sec <= 0)   return data.remaining_sec;
            // Fermata manuale: usa il suo elapsed, altrimenti elapsed produzione
            const elapsedBase = data.fermata_manuale && data.fermata_elapsed_sec !== null
              ? data.fermata_elapsed_sec
              : (data.elapsed_sec ?? 0);
            return -elapsedBase;
          }
          if (prev === null) return data.remaining_sec;
          return Math.abs(prev - data.remaining_sec) >= 2 ? data.remaining_sec : prev;
        });
        setLineStopSec(prev => {
          const serverVal = data.linestop_sec ?? 0;
          return Math.abs(prev - serverVal) >= 2 ? serverVal : prev;
        });
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

  const inAttesa = (
    (stato?.commesse?.length ?? 1) === 0 ||
    stato?.fermata_manuale === true
  ) && stato?.turno_attivo === true;

  // Decrementa ogni secondo — si ferma solo durante le pause
  useEffect(() => {
    if (stato?.in_pausa) return;
    const tick = setInterval(() => {
      setLocalRemaining(prev => prev !== null ? prev - 1 : null);
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
    : localRemaining <= 0
      ? `+${formatTime(Math.abs(localRemaining))}`
      : formatTime(localRemaining);

  const qtaInRitardo = stato.turno_attivo &&
    stato.avanzamento_previsto != null &&
    stato.qta_prodotta < stato.avanzamento_previsto;

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
          <div className="flex flex-col items-center justify-center gap-3 px-6 overflow-hidden" style={{ backgroundColor: '#facf5a' }}>
            <span className="text-black font-medium tracking-[0.3em] uppercase" style={{ fontSize: 'clamp(1.2rem, 2.50vw, 2.3rem)' }}>
              Linea
            </span>
            <span
              className="text-black font-semibold text-center break-words leading-tight"
              style={{ fontSize: 'clamp(1.8rem, 5vw, 4.5rem)' }}
            >
              {stato.linea.nome}
            </span>
            {stato.linea.logo && (
              <img
                src={logoSrc(stato.linea.logo)}
                alt={stato.linea.logo}
                className="w-full max-w-[324px] object-contain flex-shrink"
                style={{ maxHeight: 'clamp(5.4rem, 14.4vh, 12.6rem)', filter: 'brightness(0)' }}
              />
            )}
          </div>
        </div>

        {/* ── Riga inferiore ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-4">

          {/* COMMESSA */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <div className="flex flex-col items-center justify-center gap-1" style={{ height: 'clamp(3rem, 10vw, 9rem)', overflow: 'hidden' }}>
              {stato.commesse.length === 0
                ? <span className={`font-bold text-red-500 text-center transition-opacity duration-100 ${blinkOn ? 'opacity-100' : 'opacity-0'}`} style={{ fontSize: 'clamp(1.2rem, 3vw, 2.8rem)', lineHeight: 1.1 }}>In attesa<br />di picking</span>
                : stato.commesse.map((cm, _, arr) => {
                    const fs = `clamp(${(3/arr.length).toFixed(2)}rem, ${(10/arr.length).toFixed(2)}vw, ${(9/arr.length).toFixed(2)}rem)`;
                    return <span key={cm} className="text-white font-semibold text-center" style={{ fontSize: fs, lineHeight: 1 }}>{cm}</span>;
                  })
              }
            </div>
            <span className="text-gray-500 font-medium tracking-[0.2em] uppercase text-center mt-4" style={{ fontSize: 'clamp(1.2rem, 2.50vw, 2.3rem)', maxWidth: '55%' }}>
              Commessa
            </span>
          </div>

          {/* QTA' PRODOTTA */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <div className="flex items-center justify-center" style={{ height: 'clamp(3rem, 10vw, 9rem)' }}>
              <span
                className={`font-semibold tabular-nums ${qtaInRitardo ? 'text-red-500' : 'text-white'}`}
                style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
              >
                {stato.qta_prodotta}
              </span>
            </div>
            <span className="text-gray-500 font-medium tracking-[0.2em] uppercase text-center mt-4" style={{ fontSize: 'clamp(1.2rem, 2.50vw, 2.3rem)', maxWidth: '55%' }}>
              Qtà Prodotta
            </span>
          </div>

          {/* AVANZAMENTO PREVISTO */}
          <div className={`flex flex-col items-center justify-center border-r ${c.border}`}>
            <div className="flex items-center justify-center" style={{ height: 'clamp(3rem, 10vw, 9rem)' }}>
              <span
                className="text-white font-semibold tabular-nums"
                style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
              >
                {stato.turno_attivo ? stato.avanzamento_previsto : '—'}
              </span>
            </div>
            <span className="text-gray-500 font-medium tracking-[0.2em] uppercase text-center mt-4" style={{ fontSize: 'clamp(1.2rem, 2.50vw, 2.3rem)', maxWidth: '55%' }}>
              Avanz. Previsto
            </span>
          </div>

          {/* PIANO TOTALE */}
          <div className="flex flex-col items-center justify-center">
            <div className="flex items-center justify-center" style={{ height: 'clamp(3rem, 10vw, 9rem)' }}>
              <span
                className="text-white font-semibold tabular-nums"
                style={{ fontSize: 'clamp(3rem, 10vw, 9rem)', lineHeight: 1 }}
              >
                {stato.turno_attivo ? stato.qta_da_produrre : '—'}
              </span>
            </div>
            <span className="text-gray-500 font-medium tracking-[0.2em] uppercase text-center mt-4" style={{ fontSize: 'clamp(1.2rem, 2.50vw, 2.3rem)', maxWidth: '55%'  }}>
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
