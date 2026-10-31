'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { ProdSyncLog } from '@/types';

interface SyncButtonProps {
  label:    string;
  busyText: string;
  onRun:    () => Promise<unknown>;
  primary?: boolean;
}

function SyncButton({ label, busyText, onRun, primary }: SyncButtonProps) {
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
    <div className="bg-white rounded-card shadow-card p-4">
      <Button variant={primary ? 'primary' : 'secondary'} onClick={run} disabled={busy} className="w-full !py-2.5">
        {busy ? busyText : label}
      </Button>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {result && <p className="mt-2 text-xs text-muted break-all">{result}</p>}
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
  forecast_chiusi:  'Forecast spediti',
};

export default function ProduzioneSyncPage() {
  const [log, setLog] = useState<ProdSyncLog[]>([]);

  function refreshLog() {
    api.get<ProdSyncLog[]>('/api/prod/sync/log').then(setLog).catch(() => {});
  }

  useEffect(() => { refreshLog(); }, []);

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma Produzione', href: '/produzione' }}
        title="Sincronizza"
        description="Ordini da Business Central, Forecast EDI (automatico), motore parole chiave e rilevazione colore."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <SyncButton
          primary
          label="Tutto in sequenza"
          busyText="Sincronizzazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/all', undefined, SYNC_ALL_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="Ordini da Business Central"
          busyText="Importazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/orders', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="Attributi articolo (BC)"
          busyText="Lettura attributi..."
          onRun={async () => { const r = await api.post('/api/prod/sync/item-attributes', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="Genera caratteristiche (parole chiave)"
          busyText="Generazione in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/keywords', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="Rileva colore"
          busyText="Analisi in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/colors', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
        <SyncButton
          label="Chiudi Forecast già spediti"
          busyText="Verifica spedizioni in corso..."
          onRun={async () => { const r = await api.post('/api/prod/sync/forecast-chiusi', undefined, SYNC_TIMEOUT_MS); refreshLog(); return r; }}
        />
      </div>

      <p className="text-xs text-muted mb-6 max-w-3xl">
        Il Forecast EDI (edi_ferrari_delins) si sincronizza dal modulo <Link href="/edi" className="underline">EDI</Link> —
        qui viene solo letto e unito agli ordini confermati (un ordine confermato prevale sempre sul suo forecast).
        &quot;Chiudi Forecast già spediti&quot; controlla in Business Central (spedizioni EOS CWS) se un Forecast
        che non è mai diventato un ordine è comunque già stato spedito — in quel caso passa a storico invece di
        restare per sempre nel foglio.
      </p>

      <h2 className="text-sm font-semibold text-ink-900 mb-3">Storico sincronizzazioni</h2>
      <div className="bg-white rounded-card shadow-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
              <th className="py-2.5 px-4 text-left font-medium">Iniziato</th>
              <th className="py-2.5 px-4 text-right font-medium">Righe</th>
              <th className="py-2.5 px-4 text-right font-medium">Assenti</th>
              <th className="py-2.5 px-4 text-left font-medium">Stato</th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted py-6">Nessuna sincronizzazione ancora</td></tr>
            ) : log.map(l => (
              <tr key={l.id} className="border-b border-stone-100 hover:bg-accent-soft/50">
                <td className="py-2 px-4">{SYNC_TYPE_LABEL[l.sync_type] ?? l.sync_type}</td>
                <td className="py-2 px-4 text-muted">
                  {new Date(l.started_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-2 px-4 text-right">{l.rows_upserted ?? '–'}</td>
                <td className="py-2 px-4 text-right">{l.rows_marked_absent ?? '–'}</td>
                <td className="py-2 px-4">
                  <StatusBadge tone={l.status === 'done' ? 'success' : l.status === 'error' ? 'danger' : 'warning'}>
                    {l.status}
                  </StatusBadge>
                  {l.error_message && <p className="text-xs text-danger mt-0.5">{l.error_message}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
