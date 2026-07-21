'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ProdArea, ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';

interface SheetResponse {
  area: ProdArea | null;
  rows: ProdSheetRow[];
}

export default function ProduzioneAreaSheetPage() {
  const params = useParams<{ areaId: string }>();
  const areaId = params.areaId;

  const [data,    setData]    = useState<SheetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    api.get<SheetResponse>(`/api/prod/aree/${areaId}/foglio`)
      .then(setData)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [areaId]);

  if (loading) {
    return <p className="text-gray-400 pt-10 text-center">Caricamento in corso...</p>;
  }
  if (error) {
    return <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>;
  }
  if (!data) return null;

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
        <p className="text-gray-500">
          Area di montaggio: <span className="text-red-600 font-medium">{data.area?.description}</span>
        </p>
      </div>

      <SheetTable rows={data.rows} />
    </div>
  );
}
