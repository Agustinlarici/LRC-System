'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface ImportResult {
  sheets:          string[];
  total_rows_seen: number;
  upserts:         number;
  skipped:         number;
  deleted_stale:   number;
  warnings:        string[];
  plan?: {
    upserted: number;
    deleted:  number;
    warnings: string[];
  };
}

interface PollFileDetail {
  name:         string;
  result?:      ImportResult;
  error?:       string;
  skippedHtml?: boolean;
}

interface PollResult {
  count:   number;
  details: PollFileDetail[];
  error?:  string;
}

interface ImportLog {
  id:            number;
  file_name:     string;
  imported_at:   string;
  total_rows:    number;
  upserts:       number;
  skipped:       number;
  deleted_stale: number;
  sheets:        string[];
}

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

export default function SpmaImportPage() {
  const [file,       setFile]       = useState<File | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [history,    setHistory]    = useState<ImportLog[]>([]);
  const [polling,    setPolling]    = useState(false);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);
  const [pollError,  setPollError]  = useState<string | null>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/spma/import-history`, { credentials: 'include' })
      .then(r => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;

    setLoading(true); setResult(null); setError(null);
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch(`${BACKEND}/api/spma/import`, {
        method:      'POST',
        body:        form,
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json as ImportResult);
      // Refresh history
      fetch(`${BACKEND}/api/spma/import-history`, { credentials: 'include' })
        .then(r => r.json())
        .then(setHistory)
        .catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  async function handlePoll() {
    setPolling(true); setPollResult(null); setPollError(null);
    try {
      const res = await fetch(`${BACKEND}/api/spma/onedrive-poll`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPollResult(json as PollResult);
      fetch(`${BACKEND}/api/spma/import-history`, { credentials: 'include' })
        .then(r => r.json())
        .then(setHistory)
        .catch(() => {});
    } catch (err) {
      setPollError((err as Error).message);
    } finally {
      setPolling(false);
    }
  }

  return (
    <div className="flex gap-6 items-start">
      {/* ── Main form ── */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <div className="mb-6">
          <Link href="/spma" className="text-sm text-gray-500 hover:text-gray-700">← Avanzamento Prod</Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Importa Sequenza Excel</h1>
          <p className="mt-1 text-gray-500">
            Carica il file Excel del cliente. Ogni foglio = una linea di produzione.
            Colonne richieste: <strong>Commessa/Ordine</strong>, <strong>Data</strong>.
            Colonne opzionali: <em>Ora, Modello, Linea, Posizione, Stato</em>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${file ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <p className="font-medium text-blue-700">{file.name}</p>
                <p className="text-sm text-blue-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setFile(null); }}
                  className="mt-2 text-xs text-gray-500 underline"
                >
                  Rimuovi
                </button>
              </div>
            ) : (
              <div className="text-gray-400">
                <p className="text-lg">Trascina il file qui</p>
                <p className="text-sm mt-1">oppure clicca per sfogliare</p>
                <p className="text-xs mt-2">.xlsx · .xls · .csv</p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!file || loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Elaborazione in corso...' : 'Importa'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ── Import automatico OneDrive ── */}
        <div className="mt-8 border-t border-gray-100 pt-6">
          <h2 className="font-semibold text-gray-900 mb-1">Import automatico (OneDrive)</h2>
          <p className="text-sm text-gray-500 mb-3">
            Controlla la cartella OneDrive configurata e importa eventuali file nuovi o aggiornati.
            Lo scheduler esegue questo controllo automaticamente ogni 10 minuti.
          </p>
          <button
            type="button"
            onClick={handlePoll}
            disabled={polling}
            className="bg-gray-700 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {polling ? 'Controllo in corso...' : 'Poll OneDrive ora'}
          </button>

          {pollError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {pollError}
            </div>
          )}

          {pollResult && (
            <div className="mt-3 space-y-3">
              {pollResult.count === 0 && pollResult.details.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  Nessun file nuovo o aggiornato trovato nella cartella OneDrive.
                </p>
              ) : (
                pollResult.details.map((d, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="font-medium text-gray-800 text-sm mb-2 truncate" title={d.name}>{d.name}</p>
                    {d.error ? (
                      <p className="text-sm text-red-600">{d.error}</p>
                    ) : d.result ? (
                      <>
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          <Stat label="Righe lette"  value={d.result.total_rows_seen} />
                          <Stat label="Aggiornate"   value={d.result.upserts}          color="text-green-600" />
                          <Stat label="Saltate"      value={d.result.skipped}          color="text-yellow-600" />
                          <Stat label="Rimosse"      value={d.result.deleted_stale}    color="text-red-600" />
                        </div>
                        {d.result.warnings.length > 0 && (
                          <ul className="text-xs text-orange-600 space-y-0.5 mt-2 max-h-40 overflow-y-auto">
                            {d.result.warnings.map((w, j) => <li key={j}>⚠ {w}</li>)}
                          </ul>
                        )}
                      </>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="mt-6 space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Risultato importazione</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Righe lette"  value={result.total_rows_seen} />
                <Stat label="Aggiornate"   value={result.upserts} color="text-green-600" />
                <Stat label="Saltate"      value={result.skipped} color="text-yellow-600" />
                <Stat label="Rimosse"      value={result.deleted_stale} color="text-red-600" />
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Fogli: {result.sheets.join(', ')}
              </p>
            </div>

            {result.plan && (
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Piano ricalcolato</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Righe piano"   value={result.plan.upserted} color="text-blue-600" />
                  <Stat label="Righe rimosse" value={result.plan.deleted} />
                </div>
                {result.plan.warnings.length > 0 && (
                  <ul className="mt-3 text-xs text-orange-600 space-y-0.5">
                    {result.plan.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                  </ul>
                )}
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <h3 className="font-medium text-yellow-800 mb-2">Avvisi ({result.warnings.length})</h3>
                <ul className="text-xs text-yellow-700 space-y-0.5 max-h-48 overflow-y-auto">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <Link href="/spma"
              className="block text-center text-sm text-blue-600 underline mt-2">
              Visualizza il piano →
            </Link>
          </div>
        )}
      </div>

      {/* ── Import history ── */}
      <div className="w-72 shrink-0">
        <div className="bg-white border border-gray-200 rounded-xl p-4 sticky top-6">
          <h2 className="font-semibold text-gray-900 mb-3 text-sm">Storico importazioni</h2>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400">Nessuna importazione ancora.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((log, i) => (
                <li
                  key={log.id}
                  className={`rounded-lg px-3 py-2.5 text-xs border ${i === 0 ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}
                >
                  <p className={`font-medium truncate ${i === 0 ? 'text-blue-800' : 'text-gray-800'}`} title={log.file_name}>
                    {i === 0 && <span className="mr-1 text-blue-500">•</span>}
                    {log.file_name}
                  </p>
                  <p className="text-gray-500 mt-0.5">
                    {new Date(log.imported_at).toLocaleString('it-IT', {
                      day:    '2-digit',
                      month:  '2-digit',
                      year:   'numeric',
                      hour:   '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-gray-400 mt-0.5">
                    {log.total_rows} righe · {log.upserts} agg · {log.skipped} salt · {log.deleted_stale} rim
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
