'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import type { BufferLinea, BufferStato } from '@/types';

// ─── Color helpers ────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, string> = {
  verde:  'border-green-500 bg-green-50',
  giallo: 'border-yellow-400 bg-yellow-50',
  rosso:  'border-red-500 bg-red-50',
};

const COLOR_TEXT: Record<string, string> = {
  verde:  'text-green-600',
  giallo: 'text-yellow-600',
  rosso:  'text-red-600',
};

// ─── Single buffer card ───────────────────────────────────────────────────────

function BufferCard({ linea }: { linea: BufferLinea }) {
  const [stato, setStato] = useState<BufferStato | null>(null);

  const fetchStato = useCallback(async () => {
    try {
      const data = await api.get<BufferStato>(`/api/buffer/${linea.id}/stato`);
      setStato(data);
    } catch {
      // silent
    }
  }, [linea.id]);

  useEffect(() => {
    fetchStato();
    const interval = setInterval(fetchStato, 60_000);
    return () => clearInterval(interval);
  }, [fetchStato]);

  const colore  = stato?.colore ?? 'verde';
  const count   = stato?.count ?? 0;
  const commesse = stato?.commesse ?? [];

  return (
    <div className={`card border-2 ${COLOR_CLASSES[colore]} transition-colors`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg font-bold text-gray-800">{linea.nome}</span>
        <span className={`text-3xl font-black tabular-nums ${COLOR_TEXT[colore]}`}>{count}</span>
      </div>
      <div className="text-xs text-gray-500 mb-1">
        <span className="label">Fasi:</span> {linea.fasi.join(', ')}
      </div>
      {commesse.length > 0 && (
        <div className="text-xs text-gray-600 mb-3">
          <span className="label">Commesse:</span>{' '}
          {commesse.slice(0, 5).join(', ')}
          {commesse.length > 5 && ` +${commesse.length - 5}`}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <Link
          href={`/buffer/${linea.id}`}
          target="_blank"
          className="btn-primary text-xs"
        >
          Apri
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BufferPage() {
  const [linee, setLinee] = useState<BufferLinea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Buffer — STR'; }, []);

  useEffect(() => {
    api.get<BufferLinea[]>('/api/buffer')
      .then(setLinee)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Buffer</h1>
        <Link href="/buffer/impostazioni" className="btn-primary">Impostazioni</Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      ) : linee.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-5xl mb-4">📦</div>
          <p className="text-lg font-medium text-gray-600 mb-1">Nessun buffer configurato</p>
          <p className="text-sm mb-5">Aggiungi un buffer per monitorare le pre-aree di produzione</p>
          <Link href="/buffer/impostazioni" className="btn-primary inline-block">
            Vai alle impostazioni
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {linee.filter(l => l.attivo).map(linea => (
            <BufferCard key={linea.id} linea={linea} />
          ))}
        </div>
      )}
    </div>
  );
}
