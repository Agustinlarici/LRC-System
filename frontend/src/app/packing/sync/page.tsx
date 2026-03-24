'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export default function SyncArticlesPage() {
  useEffect(() => { document.title = 'Sync Articoli — STR'; }, []);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ inserted: number; bc_total: number; existing_in_mysql: number } | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function runSync() {
    if (!confirm('Sicuro di voler sincronizzare gli articoli da BC?')) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<{ ok: boolean; inserted: number; bc_total: number; existing_in_mysql: number; error?: string }>(
        '/api/pack/articles/sync-from-bc'
      );
      if (!data.ok) throw new Error(data.error || 'Errore sconosciuto');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Sync articoli da BC</h1>
        <p className="mt-1 text-gray-500">
          Inserisce in <code>pack_article</code> solo i codici mancanti, usando BC Item + UDF 22 (family).
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex justify-between items-start">
          <div><strong>Errore:</strong> {error}</div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {result && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg flex justify-between items-start">
          <div className="flex gap-6 text-sm">
            <span><strong>Inseriti:</strong> {result.inserted}</span>
            <span><strong>Totale BC:</strong> {result.bc_total}</span>
            <span><strong>Già esistenti:</strong> {result.existing_in_mysql}</span>
          </div>
          <button onClick={() => setResult(null)} className="text-green-500 hover:text-green-700">✕</button>
        </div>
      )}

      <div className="card flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800">Aggiungi articoli mancanti</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Esegue la sincronizzazione contro Business Central e aggiunge solo i codici inesistenti.
          </p>
        </div>
        <button
          onClick={runSync}
          disabled={loading}
          className="btn-primary whitespace-nowrap"
        >
          {loading ? 'Sincronizzazione...' : 'Sincronizza ora'}
        </button>
      </div>
    </div>
  );
}
