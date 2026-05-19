'use client';

import { useRef, useState } from 'react';

export interface ImportResult { inserted: number; skipped: number; errors: number; detail?: string; }
export type ImportProcessFn = (rows: Record<string, string>[]) => Promise<ImportResult>;

interface Props {
  columns: string[];
  processRows: ImportProcessFn;
  onDone?: () => void;
  label?: string;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const unquote = (s: string) => s.replace(/^"[\s\S]*"$/, m => m.slice(1, -1)).trim();
  const headers = lines[0].split(sep).map(h => unquote(h).toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = line.split(sep).map(unquote);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  }).filter(r => Object.values(r).some(v => v !== ''));
}

export function ImportExcelButton({ columns, processRows, onDone, label = 'Importa CSV' }: Props) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [hint,    setHint]    = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRunning(true); setResult(null);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setResult({ inserted: 0, skipped: 0, errors: 0, detail: 'File vuoto o formato non riconosciuto.' });
        return;
      }
      const res = await processRows(rows);
      setResult(res);
      onDone?.();
    } catch (err) {
      setResult({ inserted: 0, skipped: 0, errors: 1, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const hasIssue = result && (result.errors > 0 || result.skipped > 0);

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary text-sm"
          disabled={running}
          title={`Colonne attese: ${columns.join(', ')}`}
          onClick={() => { setResult(null); fileRef.current?.click(); }}
        >
          {running ? 'Importazione...' : label}
        </button>
        <button
          type="button"
          className="text-gray-400 hover:text-gray-600 text-sm leading-none"
          title="Come esportare da Excel"
          onClick={() => setHint(h => !h)}
        >
          ?
        </button>
      </div>

      {hint && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-w-xs leading-snug">
          Da Excel: <strong>File → Salva con nome → CSV UTF-8</strong> (o CSV separato da virgole).
          <br />Colonne attese: <span className="font-mono">{columns.join(', ')}</span>
        </div>
      )}

      {result && (
        <div className={`text-xs px-2.5 py-1.5 rounded-lg flex flex-col gap-1 max-w-sm ${hasIssue ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          <div className="flex items-center gap-3">
            {result.inserted > 0 && <span>✓ {result.inserted} inseriti</span>}
            {result.skipped  > 0 && <span>⚠ {result.skipped} saltati</span>}
            {result.errors   > 0 && <span>✕ {result.errors} errori</span>}
            {result.inserted === 0 && result.skipped === 0 && result.errors === 0 && <span>Nessuna riga trovata</span>}
            <button onClick={() => setResult(null)} className="opacity-40 hover:opacity-100 font-bold ml-auto">×</button>
          </div>
          {result.detail && <span className="opacity-80 leading-snug">{result.detail}</span>}
        </div>
      )}
    </div>
  );
}
