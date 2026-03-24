'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { BufferStato } from '@/types';

// ─── Color config ─────────────────────────────────────────────────────────────

const COLORS = {
  verde:  { bg: '#052e16', count: '#4ade80', label: 'text-emerald-400' },
  giallo: { bg: '#422006', count: '#facc15', label: 'text-yellow-400'  },
  rosso:  { bg: '#450a0a', count: '#f87171', label: 'text-red-400'     },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BufferDisplayPage() {
  const params = useParams();
  const id     = params.id as string;

  const [stato, setStato]   = useState<BufferStato | null>(null);
  const [nome, setNome]     = useState<string>('');
  const [error, setError]   = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchStato = useCallback(async () => {
    try {
      const data = await api.get<BufferStato & { nome?: string }>(`/api/buffer/${id}/stato`);
      setStato(data);
      setError(null);
      setUpdatedAt(new Date());
    } catch {
      setError('Errore connessione');
    }
  }, [id]);

  useEffect(() => {
    api.get<Array<{ id: number; nome: string }>>('/api/buffer')
      .then(list => {
        const found = list.find(l => l.id === parseInt(id));
        if (found) setNome(found.nome);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    document.title = 'Buffer — STR';
    fetchStato();
    const interval = setInterval(fetchStato, 60_000);

    function onVisible() {
      if (document.visibilityState === 'visible') fetchStato();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchStato]);

  if (!stato) {
    return (
      <div className="fixed inset-0 bg-zinc-900 flex items-center justify-center">
        <p className="text-gray-400 text-xl font-light tracking-widest">
          {error ?? 'CARICAMENTO...'}
        </p>
      </div>
    );
  }

  const colore   = stato.colore;
  const c        = COLORS[colore];
  const commesse = stato.commesse;

  return (
    <div
      className="fixed inset-0 flex flex-col transition-colors duration-500"
      style={{ backgroundColor: c.bg }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-10 pt-6 pb-2">
        <span className="text-zinc-500 text-sm font-medium tracking-widest uppercase">{nome}</span>
        {updatedAt && (
          <span className="text-zinc-600 text-xs">
            {updatedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Main content: numero a sinistra, commesse a destra */}
      <div className="flex-1 flex items-center px-10 gap-10 min-h-0">

        {/* Sinistra — numero */}
        <div className="w-1/2 flex flex-col items-center justify-center shrink-0">
          <div
            className="font-black tabular-nums leading-none"
            style={{ fontSize: 'clamp(8rem, 24vw, 22rem)', color: c.count }}
          >
            {stato.count}
          </div>
          <div className="text-zinc-500 text-sm font-medium tracking-[0.3em] uppercase mt-2">
            seriali in buffer
          </div>
        </div>

        {/* Divisore */}
        {commesse.length > 0 && (
          <div className="w-px self-stretch bg-zinc-700 shrink-0" />
        )}

        {/* Destra — griglia commesse */}
        {commesse.length > 0 && (
          <div className="w-1/2 shrink-0 flex flex-col min-h-0">
            <p className="text-zinc-500 text-xs font-medium tracking-widest uppercase mb-3">
              Commesse ({commesse.length})
            </p>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-4 gap-x-1 gap-y-3">
                {commesse.map((comm) => (
                  <span
                    key={comm}
                    className="text-zinc-200 font-semibold tabular-nums"
                    style={{ fontSize: 'clamp(1rem, 1.8vw, 1.6rem)' }}
                  >
                    {comm}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer: soglie */}
      <div className="flex items-center justify-center gap-8 px-10 pb-5 text-xs text-zinc-600">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          Verde ≥ {stato.soglie.soglia_verde}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />
          Giallo ≥ {stato.soglie.soglia_giallo}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
          Rosso &lt; {stato.soglie.soglia_giallo}
        </span>
      </div>
    </div>
  );
}
