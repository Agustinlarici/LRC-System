'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import type { MonitorLinea } from '@/types';

export default function MonitorPage() {
  const [linee, setLinee] = useState<MonitorLinea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Andon — STR'; }, []);

  useEffect(() => {
    api.get<MonitorLinea[]>('/api/monitor/linee')
      .then(setLinee)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Andon</h1>
        <div className="flex gap-2">
          <Link href="/monitor/turni" className="btn-secondary">Turni</Link>
          <Link href="/monitor/impostazioni" className="btn-primary">Impostazioni</Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : linee.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-5xl mb-4">🖥️</div>
          <p className="text-lg font-medium text-gray-600 mb-1">Nessun andon configurato</p>
          <p className="text-sm mb-5">Aggiungi una linea di produzione per iniziare il monitoraggio</p>
          <Link href="/monitor/impostazioni" className="btn-primary inline-block">
            Vai alle impostazioni
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {linee.filter(l => l.attivo).map(linea => (
            <div key={linea.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl font-bold text-gray-800">{linea.nome}</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Attivo</span>
              </div>
              <div className="space-y-1 text-sm text-gray-600 mb-4">
                <div><span className="label">Fase:</span> {linea.fase}</div>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/monitor/${linea.id}`}
                  target="_blank"
                  className="flex-1 text-center text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-lg py-2 transition-colors"
                >
                  Apri andon →
                </Link>
                <Link
                  href={`/monitor/parate/${linea.id}`}
                  target="_blank"
                  className="flex-1 text-center text-sm font-medium text-red-600 hover:text-red-800 border border-red-200 hover:border-red-400 rounded-lg py-2 transition-colors"
                >
                  Fermate
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
