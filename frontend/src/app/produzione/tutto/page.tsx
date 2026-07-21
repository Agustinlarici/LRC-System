'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';

interface SheetResponse {
  rows: ProdSheetRow[];
}

export default function ProduzioneTuttoPage() {
  const [rows,    setRows]    = useState<ProdSheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    api.get<SheetResponse>('/api/prod/foglio')
      .then(d => setRows(d.rows))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="print-a4" style={{ fontSize: '0.78rem' }}>
      <div className="d-print-none mb-4 flex items-center justify-between">
        <Link href="/produzione" className="text-sm text-gray-500 hover:text-gray-700">← Programma Produzione</Link>
        <button
          onClick={() => window.print()}
          className="text-sm bg-gray-700 text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
        >
          🖨️ Stampa
        </button>
      </div>

      <div className="mb-4 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Programma Produzione</h1>
        <p className="text-gray-500">Tutti gli ordini — nessuna area di montaggio richiesta</p>
      </div>

      {loading ? (
        <p className="text-gray-400 text-center">Caricamento in corso...</p>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      ) : (
        <SheetTable rows={rows} />
      )}
    </div>
  );
}
