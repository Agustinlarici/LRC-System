'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';

const PAGE_SIZE = 500;

interface SheetResponse {
  rows:  ProdSheetRow[];
  total: number;
}

export default function ProduzioneTuttoPage() {
  const [rows,       setRows]       = useState<ProdSheetRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const loadPage = useCallback(async (offset: number) => {
    const d = await api.get<SheetResponse>(`/api/prod/foglio?limit=${PAGE_SIZE}&offset=${offset}`);
    setTotal(d.total);
    setRows(prev => offset === 0 ? d.rows : [...prev, ...d.rows]);
  }, []);

  useEffect(() => {
    loadPage(0)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [loadPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      await loadPage(rows.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

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
        <>
          <SheetTable rows={rows} />
          {rows.length < total && (
            <div className="d-print-none mt-4 text-center">
              <p className="text-sm text-gray-500 mb-2">Mostrando {rows.length} di {total}</p>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? 'Caricamento...' : `Carica altri ${Math.min(PAGE_SIZE, total - rows.length)}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
