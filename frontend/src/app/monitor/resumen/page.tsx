'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import type { MonitorResumen } from '@/types';

export default function ResumenPage() {
  const [gruppi, setGruppi] = useState<MonitorResumen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Riepilogo Andon — STR'; }, []);

  useEffect(() => {
    api.get<MonitorResumen[]>('/api/monitor/resumen')
      .then(setGruppi)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Riepilogo Andon</h1>
        <Link href="/monitor/resumen/impostazioni" className="btn-primary">
          Impostazioni
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : gruppi.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-medium text-gray-600 mb-1">Nessun riepilogo configurato</p>
          <p className="text-sm mb-5">Crea un gruppo selezionando le linee da monitorare insieme</p>
          <Link href="/monitor/resumen/impostazioni" className="btn-primary inline-block">
            Vai alle impostazioni
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {gruppi.map(g => (
            <Link
              key={g.id}
              href={`/monitor/resumen/${g.id}`}
              target="_blank"
              className="card hover:shadow-md transition-shadow cursor-pointer block"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl font-bold text-gray-800">{g.nome}</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  {g.linea_count} {g.linea_count === 1 ? 'linea' : 'linee'}
                </span>
              </div>
              <div className="mt-3 text-xs text-blue-600">Apri riepilogo →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
