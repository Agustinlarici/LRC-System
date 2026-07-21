'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface PoMapping {
  id:           number;
  article_code: string;
  po_number:    string;
  updated_at:   string;
}

function backendUrl() {
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export default function WebDdtImpostazioniPage() {
  const [rows,    setRows]    = useState<PoMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [articleCode, setArticleCode] = useState('');
  const [poNumber,    setPoNumber]    = useState('');

  const [uploading,    setUploading]    = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importError,  setImportError]  = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<PoMapping[]>('/api/webddt/po-mapping');
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!articleCode.trim() || !poNumber.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const row = await api.post<PoMapping>('/api/webddt/po-mapping', {
        article_code: articleCode.trim(),
        po_number:    poNumber.trim(),
      });
      setRows(prev => [...prev.filter(r => r.article_code !== row.article_code), row]
        .sort((a, b) => a.article_code.localeCompare(b.article_code)));
      setArticleCode('');
      setPoNumber('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questa associazione?')) return;
    try {
      await api.delete(`/api/webddt/po-mapping/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setImportError(null);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${backendUrl()}/api/webddt/po-mapping/import`, {
        method:      'POST',
        body:        form,
        credentials: 'include',
        signal:      AbortSignal.timeout(60_000),
      });
      const json = await res.json().catch(() => ({})) as { error?: string; message?: string; imported?: number; skipped?: number };
      if (!res.ok) throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
      setImportResult({ imported: json.imported ?? 0, skipped: json.skipped ?? 0 });
      await load();
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/webddt" className="text-sm text-gray-500 hover:text-gray-700">← WebDDT</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Impostazioni WebDDT</h1>
        <p className="text-sm text-gray-500 mt-1">
          Associa ogni codice articolo al PO number da usare quando la riga non ha una commessa.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Import Excel */}
      <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Importa da Excel</h2>
        <p className="text-xs text-gray-500 mb-3">
          File .xlsx/.xls/.csv con colonne &quot;Codice Articolo&quot; e &quot;PO Number&quot;. Gli articoli già presenti vengono aggiornati.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md transition-colors disabled:opacity-50"
        >
          {uploading ? 'Importazione...' : 'Scegli file'}
        </button>
        {importResult && (
          <span className="ml-3 text-sm text-green-700">
            {importResult.imported} importati, {importResult.skipped} saltati
          </span>
        )}
        {importError && (
          <span className="ml-3 text-sm text-red-700">{importError}</span>
        )}
      </div>

      {/* Add form */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Codice articolo</label>
          <input
            type="text"
            value={articleCode}
            onChange={e => setArticleCode(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">PO number</label>
          <input
            type="text"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>
        <button
          onClick={add}
          disabled={busy || !articleCode.trim() || !poNumber.trim()}
          className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Aggiungi
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-400">Caricamento...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nessuna associazione configurata.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">Codice articolo</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">PO number</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-900">{r.article_code}</td>
                  <td className="px-4 py-2 font-mono text-gray-700">{r.po_number}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => del(r.id)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
