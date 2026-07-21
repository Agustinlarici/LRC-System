'use client';

import React, { useRef, useState } from 'react';

interface ImportResult {
  total_rows: number;
  upserted:   number;
  skipped:    number;
  warnings:   string[];
}

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

export function ExcelImportButton({ endpoint, onDone, label = 'Carica Excel' }: {
  endpoint: string;
  onDone:   () => void;
  label?:   string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setResult(null); setError(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND}${endpoint}`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
      setResult(json as ImportResult);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="inline-block">
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Importazione...' : `📥 ${label}`}
      </button>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {result && (
        <p className="mt-1 text-xs text-gray-500">
          Lette: {result.total_rows} · Caricate: <span className="text-green-600">{result.upserted}</span>
          {result.skipped > 0 && <> · Saltate: <span className="text-yellow-600">{result.skipped}</span></>}
          {result.warnings.length > 0 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-orange-600">{result.warnings.length} avvisi</summary>
              <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </p>
      )}
    </div>
  );
}
