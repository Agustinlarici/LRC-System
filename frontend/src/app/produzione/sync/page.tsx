'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProdSyncLog } from '@/types';

interface SyncButtonProps {
  label:    string;
  busyText: string;
  onRun:    () => Promise<unknown>;
}

function SyncButton({ label, busyText, onRun }: SyncButtonProps) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  async function run() {
    setBusy(true); setResult(null); setError(null);
    try {
      const res = await onRun();
      setResult(JSON.stringify(res));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <button
        onClick={run}
        disabled={busy}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {busy ? busyText : label}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && <p className="mt-2 text-xs text-gray-500 break-all">{result}</p>}
    </div>
  );
}

// Le sync leggono/rigenerano decine di migliaia di righe (BC + EDI Forecast)
// — il timeout di default dell'api client (15s) è troppo corto.
const SYNC_TIMEOUT_MS     = 120_000;
const SYNC_ALL_TIMEOUT_MS = 300_000; // incatena tutte e 4 le sync in sequenza

const SYNC_TYPE_LABEL: Record<string, string> = {
  bc_orders:        'Ordini BC',
  item_attributes:  'Attributi BC',
  keywords:         'Parole chiave',
  colors:           'Colore',
};

export default function ProduzioneSyncPage() {
  const [log, setLog] = useState<ProdSyncLog[]>([]);

  function refreshLog() {
    api.get<ProdSyncLog[]>('/api/prod/sync/log').then(setLog).catch(() => {});
  }

  useEffect(() => { refreshLog(); }, []);

  return (
    <div>
      <div className="mb-6">
        <Link href="/produzione" className="text-sm text-gray-500 hover:text-gray-700">← Programma Produzione</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Sincronizza</h1>
        <p className="mt-1 text-gray-500">
          Ordini da Business Central, Forecast EDI (automatico), motore parole chiave e rilevazione colore.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <SyncButton
          label="🌀 Tutto in sequenza"
          busyText="Sincronizzazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/all', undefined, SYNC_ALL_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="📥 Ordini da Business Central"
          busyText="Importazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/orders', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="🏷️ Attributi articolo (BC)"
          busyText="Lettura attributi..."
          onRun={async () => { const r = await api.post('/api/prod/sync/item-attributes', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="✨ Genera caratteristiche (parole chiave)"
          busyText="Generazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/keywords', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="🎨 Rileva colore"
          busyText="Analisi in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/colors', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
      </div>

      <p className="text-xs text-gray-400 mb-2">
        Il Forecast EDI (edi_ferrari_delins) si sincronizza dal modulo <Link href="/edi" className="underline">EDI</Link> —
        qui viene solo letto e unito agli ordini confermati (un ordine confermato prevale sempre sul suo forecast).
      </p>

      <h2 className="font-semibold text-gray-900 mb-3">Storico sincronizzazioni</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
              <th className="py-2.5 px-4 text-left font-medium">Iniziato</th>
              <th className="py-2.5 px-4 text-right font-medium">Righe</th>
              <th className="py-2.5 px-4 text-right font-medium">Assenti</th>
              <th className="py-2.5 px-4 text-left font-medium">Stato</th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">Nessuna sincronizzazione ancora</td></tr>
            ) : log.map(l => (
              <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4">{SYNC_TYPE_LABEL[l.sync_type] ?? l.sync_type}</td>
                <td className="py-2 px-4 text-gray-500">
                  {new Date(l.started_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-2 px-4 text-right">{l.rows_upserted ?? '–'}</td>
                <td className="py-2 px-4 text-right">{l.rows_marked_absent ?? '–'}</td>
                <td className="py-2 px-4">
                  <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
                    l.status === 'done' ? 'bg-green-100 text-green-700'
                      : l.status === 'error' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {l.status}
                  </span>
                  {l.error_message && <p className="text-xs text-red-500 mt-0.5">{l.error_message}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
