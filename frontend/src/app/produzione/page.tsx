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
        <h1 className="text-3xl font-bold text-gray-900">Programma Produzione</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/produzione/sync"
            className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Sincronizza
          </Link>
          <Link href="/produzione/conflitti"
            className="flex items-center gap-1.5 text-sm bg-yellow-100 text-yellow-800 px-3 py-2 rounded-lg hover:bg-yellow-200 transition-colors">
            Duplicati
          </Link>
          <Link href="/spma/import"
            className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            Import Planning
          </Link>
          <Link href="/produzione/impostazioni"
            className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            Impostazioni
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400">Caricamento aree...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Link
            href="/produzione/tutto"
            className="bg-gray-900 rounded-xl p-5 text-center hover:bg-gray-800 transition-colors"
          >
            <p className="font-semibold text-white">Vedi tutto</p>
            <p className="text-xs text-gray-300 mt-1">Foglio completo, senza filtro per area</p>
          </Link>
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
