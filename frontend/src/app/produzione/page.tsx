'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProdArea } from '@/types';

export default function ProduzionePage() {
  const [aree,    setAree]    = useState<ProdArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    api.get<ProdArea[]>('/api/prod/aree')
      .then(setAree)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Programma Produzione</h1>
          <p className="mt-1 text-gray-500">
            Ordini Business Central + Forecast EDI, caratteristiche derivate e foglio di lavoro per area di montaggio.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/produzione/tutto"
            className="flex items-center gap-1.5 text-sm bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
            📋 Vedi tutto
          </Link>
          <Link href="/produzione/sync"
            className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            🔄 Sincronizza
          </Link>
          <Link href="/produzione/impostazioni"
            className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            ⚙ Impostazioni
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <h2 className="text-sm font-medium text-gray-500 mb-3">
        Aree di montaggio (opzionale — usa &quot;Vedi tutto&quot; per il foglio completo senza filtrare per area)
      </h2>

      {loading ? (
        <p className="text-gray-400">Caricamento aree...</p>
      ) : aree.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          Nessuna area di montaggio configurata — non è necessaria per usare &quot;Vedi tutto&quot;.{' '}
          <Link href="/produzione/impostazioni" className="text-blue-600 underline">Puoi crearne una qui</Link>{' '}
          se vuoi fogli filtrati per zona.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {aree.map(area => (
            <Link
              key={area.id}
              href={`/produzione/${area.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 text-center hover:shadow-md hover:border-blue-200 transition-all"
            >
              <p className="font-semibold text-gray-900">{area.description}</p>
              <p className="text-xs text-gray-400 mt-1">{area.code}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
