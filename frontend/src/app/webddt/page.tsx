'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { EdiShipment } from '@/types';

type WebDdtShipment = EdiShipment & { downloaded_at: string | null; missing_po: boolean };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CLIENT_LABELS: Record<string, string> = {
  C558:  'Ferrari',
  C3027: 'SMR',
};
const CLIENT_COLORS: Record<string, string> = {
  C558:  'bg-sky-50 text-sky-700 border-sky-200',
  C3027: 'bg-amber-100 text-amber-800 border-amber-300',
};

function ClientBadge({ account }: { account: string }) {
  const cls = CLIENT_COLORS[account] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {CLIENT_LABELS[account] ?? account}
    </span>
  );
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('it-IT');
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function backendUrl() {
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

async function downloadExcel(shipmentIds: string[]): Promise<void> {
  const res = await fetch(`${backendUrl()}/api/webddt/download`, {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ shipment_ids: shipmentIds }),
    credentials: 'include',
    signal:      AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `WebDDT_Ferrari_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebDdtPage() {
  const [shipments,    setShipments]    = useState<WebDdtShipment[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [downloading,  setDownloading]  = useState(false);
  const [dlError,      setDlError]      = useState<string | null>(null);
  const [from,         setFrom]         = useState('');
  const [to,           setTo]           = useState('');
  const [search,       setSearch]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from)   params.set('from',   from);
      if (to)     params.set('to',     to);
      if (search) params.set('search', search);
      const data = await api.get<WebDdtShipment[]>(`/api/webddt/shipments?${params}`, 60_000);
      setShipments(data);
      setSelected(new Set());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, search]);

  useEffect(() => { load(); }, [load]);

  function toggleAll() {
    if (selected.size === shipments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(shipments.map(s => s.shipment_id)));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDownload() {
    if (selected.size === 0) return;
    setDownloading(true);
    setDlError(null);
    try {
      await downloadExcel([...selected]);
      // Aggiorna il flag downloaded_at localmente senza ricaricare tutto
      const now = new Date().toISOString();
      setShipments(prev => prev.map(s =>
        selected.has(s.shipment_id) ? { ...s, downloaded_at: now } : s
      ));
    } catch (e: unknown) {
      setDlError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  const allSelected = shipments.length > 0 && selected.size === shipments.length;
  const anySelected = selected.size > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WebDDT Ferrari</h1>
          <p className="text-sm text-gray-500 mt-1">
            Seleziona le spedizioni e scarica il documento di trasporto in formato Excel.
          </p>
        </div>
        <Link
          href="/webddt/impostazioni"
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md transition-colors whitespace-nowrap"
        >
          ⚙ Impostazioni
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Da</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">A</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cerca documento</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="es. SPCW26-021525"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
          />
        </div>
        <button
          onClick={load}
          className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md transition-colors"
        >
          Cerca
        </button>

        <div className="ml-auto flex items-center gap-3">
          {anySelected && (
            <span className="text-sm text-gray-600">
              {selected.size} selezionat{selected.size === 1 ? 'a' : 'e'}
            </span>
          )}
          <button
            onClick={handleDownload}
            disabled={!anySelected || downloading}
            className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              anySelected && !downloading
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {downloading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Download...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                Scarica Excel
              </>
            )}
          </button>
        </div>
      </div>

      {dlError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {dlError}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <svg className="animate-spin w-8 h-8 text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          Errore: {error}
        </div>
      ) : shipments.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Nessuna spedizione trovata.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Documento</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Data spedizione</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Righe</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Scaricato</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, idx) => {
                const isSelected = selected.has(s.shipment_id);
                return (
                  <tr
                    key={s.shipment_id}
                    onClick={() => toggleOne(s.shipment_id)}
                    title={s.missing_po ? 'Manca commessa e PO number su almeno una riga' : undefined}
                    className={`border-b border-gray-100 cursor-pointer transition-colors ${
                      s.missing_po
                        ? isSelected ? 'bg-red-100 hover:bg-red-200' : 'bg-red-50 hover:bg-red-100'
                        : isSelected
                        ? 'bg-blue-50 hover:bg-blue-100'
                        : idx % 2 === 0
                        ? 'bg-white hover:bg-gray-50'
                        : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(s.shipment_id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-900">{s.document_number}</td>
                    <td className="px-4 py-3"><ClientBadge account={s.customer_account} /></td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(s.shipment_date)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{s.line_count}</td>
                    <td className="px-4 py-3 text-center">
                      {s.downloaded_at ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
                            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                          </svg>
                          {fmtDateTime(s.downloaded_at)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-2">
            <span>{shipments.length} spedizion{shipments.length === 1 ? 'e' : 'i'} · Clienti:</span>
            <ClientBadge account="C558" />
            <ClientBadge account="C3027" />
          </div>
        </div>
      )}
    </div>
  );
}
