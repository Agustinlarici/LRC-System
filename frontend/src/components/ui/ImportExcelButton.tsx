'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

// Un caso da controllare (non trovato, ambiguo, rifiutato…): finisce nella tabella "Dettaglio"
// Azione proposta per un caso (es. "Collega", "Crea nuovo"): run() fa il lavoro e restituisce l'esito da mostrare
export interface ImportIssueAction { label: string; needsChoice?: boolean; run: (choice?: string) => Promise<string>; }
export interface ImportIssue {
  type: string; name: string; note?: string;
  choices?: { value: string; label: string }[];   // se presente: campo di ricerca per scegliere (es. il dipendente)
  actions?: ImportIssueAction[];
}
export interface ImportResult { inserted: number; skipped: number; errors: number; warnings?: number; updated?: number; detail?: string; issues?: ImportIssue[]; }
// variant: valore passato a open() (es. la modalità scelta da un menu); assente se si usa il pulsante
export type ImportProcessFn = (rows: Record<string, string>[], variant?: string) => Promise<ImportResult>;

// Per aprire la scelta del file da fuori (es. da una voce di menu) con hideButton
export interface ImportExcelHandle { open: (variant?: string) => void; }

interface Props {
  columns: string[];
  processRows: ImportProcessFn;
  onDone?: () => void;
  label?: string;
  iconOnly?: boolean;
  hideButton?: boolean;   // niente pulsante: si apre con ref.open(); resta solo il riquadro dell'esito
}

// Legge il file come UTF-8; se non lo è (CSV esportati da vecchi gestionali, Windows-1252) lo rilegge così
function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

// CSV con campi tra virgolette (che possono contenere separatore, doppie virgolette e a capo)
function parseCSV(text: string): Record<string, string>[] {
  const sep = (text.split(/\r?\n/, 1)[0] ?? '').includes(';') ? ';' : ',';
  const records: string[][] = [];
  let row: string[] = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (text[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur.trim()); cur = '';
      if (row.some(v => v !== '')) records.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some(v => v !== '')) records.push(row);
  if (records.length < 2) return [];
  const headers = records[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  return records.slice(1).map(vals => Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])));
}

// Tabella dei casi da controllare. Se un caso ha azioni (collega a un dipendente, crea…) le mostra accanto
// alla riga; l'esito resta visibile (anche chiudendo e riaprendo) finché non si fa un nuovo import.
function IssuesDialog({ issues, done, setDone, onClose }: {
  issues: ImportIssue[];
  done: Record<number, string>;
  setDone: (fn: (d: Record<number, string>) => Record<number, string>) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState('');
  const types = Array.from(new Set(issues.map(i => i.type)));
  const list = issues.map((issue, idx) => ({ issue, idx })).filter(x => !type || x.issue.type === type);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-medium text-gray-900">Dettaglio ({list.length})</h2>
          <div className="flex items-center gap-2">
            <select value={type} onChange={e => setType(e.target.value)} className="input text-sm">
              <option value="">Tutti i tipi</option>
              {types.map(t => <option key={t} value={t}>{t} ({issues.filter(i => i.type === t).length})</option>)}
            </select>
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Chiudi</button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-5 py-2">Tipo</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Nota</th><th className="px-3 py-2">Azione</th></tr>
            </thead>
            <tbody>
              {list.map(({ issue, idx }) => (
                <IssueRow key={idx} issue={issue} listId={`issue-choices-${idx}`} done={done[idx]} onDone={msg => setDone(d => ({ ...d, [idx]: msg }))} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IssueRow({ issue, listId, done, onDone }: { issue: ImportIssue; listId: string; done?: string; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choice = issue.choices?.find(c => c.label === text.trim())?.value;

  async function run(a: ImportIssueAction) {
    setBusy(true); setError('');
    try { onDone(await a.run(choice)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-5 py-1.5 whitespace-nowrap text-gray-600">{issue.type}</td>
      <td className="px-3 py-1.5 font-medium text-gray-900">{issue.name}</td>
      <td className="px-3 py-1.5 text-gray-500">{issue.note ?? ''}</td>
      <td className="px-3 py-1.5">
        {done ? <span className="text-green-700">✓ {done}</span> : issue.actions && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {issue.choices && (
                <>
                  <input list={listId} value={text} onChange={e => setText(e.target.value)} placeholder="Cerca dipendente…" className="input text-sm w-56" />
                  <datalist id={listId}>{issue.choices.map(c => <option key={c.value} value={c.label} />)}</datalist>
                </>
              )}
              {issue.actions.map(a => (
                <button key={a.label} type="button" disabled={busy || (a.needsChoice && !choice)} onClick={() => run(a)} className="btn-secondary text-sm">
                  {busy ? '…' : a.label}
                </button>
              ))}
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        )}
      </td>
    </tr>
  );
}

export const ImportExcelButton = forwardRef<ImportExcelHandle, Props>(function ImportExcelButton(
  { columns, processRows, onDone, label = 'Importa CSV', iconOnly = false, hideButton = false }, ref,
) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const variantRef = useRef<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [hint,    setHint]    = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [issueDone, setIssueDone] = useState<Record<number, string>>({});

  useImperativeHandle(ref, () => ({
    open: (variant?: string) => { variantRef.current = variant; setResult(null); setShowIssues(false); setIssueDone({}); fileRef.current?.click(); },
  }));

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRunning(true); setResult(null);
    try {
      const rows = parseCSV(decodeText(await file.arrayBuffer()));
      if (rows.length === 0) {
        setResult({ inserted: 0, skipped: 0, errors: 0, detail: 'File vuoto o formato non riconosciuto.' });
        return;
      }
      const res = await processRows(rows, variantRef.current);
      setResult(res);
      onDone?.();
    } catch (err) {
      setResult({ inserted: 0, skipped: 0, errors: 1, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
      variantRef.current = undefined;
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const hasIssue = result && (result.errors > 0 || result.skipped > 0 || !!result.warnings);

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      {!hideButton && <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary text-sm"
          disabled={running}
          title={iconOnly
            ? `${label} — da Excel: File → Salva con nome → CSV UTF-8. Colonne attese: ${columns.join(', ')}`
            : `Colonne attese: ${columns.join(', ')}`}
          aria-label={label}
          onClick={() => { setResult(null); fileRef.current?.click(); }}
        >
          {iconOnly ? (
            running ? '…' : (
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />
              </svg>
            )
          ) : (running ? 'Importazione...' : label)}
        </button>
        {!iconOnly && (
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 text-sm leading-none"
            title="Come esportare da Excel"
            onClick={() => setHint(h => !h)}
          >
            ?
          </button>
        )}
      </div>}

      {hint && !hideButton && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-w-xs leading-snug">
          Da Excel: <strong>File → Salva con nome → CSV UTF-8</strong> (o CSV separato da virgole).
          <br />Colonne attese: <span className="font-mono">{columns.join(', ')}</span>
        </div>
      )}

      {running && (
        <div role="status" className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 bg-blue-50 text-blue-700 border border-blue-200">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Importazione in corso… non chiudere la pagina
        </div>
      )}

      {result && (
        <div className={`text-xs px-2.5 py-1.5 rounded-lg flex flex-col gap-1 max-w-sm ${hasIssue ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          <div className="flex items-center gap-3">
            {result.inserted > 0 && <span>✓ {result.inserted} inseriti</span>}
            {!!result.updated && <span>✓ {result.updated} aggiornati</span>}
            {!!result.warnings && result.warnings > 0 && <span>⚠ {result.warnings} con avvisi (caricati comunque)</span>}
            {result.skipped  > 0 && <span>⊘ {result.skipped} saltati</span>}
            {result.errors   > 0 && <span>✕ {result.errors} errori</span>}
            {result.inserted === 0 && !result.updated && result.skipped === 0 && result.errors === 0 && <span>Nessuna riga trovata</span>}
            <button onClick={() => setResult(null)} className="opacity-40 hover:opacity-100 font-bold ml-auto">×</button>
          </div>
          {result.detail && <span className="opacity-80 leading-snug">{result.detail}</span>}
          {!!result.issues?.length && (
            <button type="button" onClick={() => setShowIssues(true)} className="self-start font-medium underline">
              Vedi dettaglio ({result.issues.length})
            </button>
          )}
        </div>
      )}

      {showIssues && result?.issues && (
        <IssuesDialog issues={result.issues} done={issueDone} setDone={setIssueDone} onClose={() => setShowIssues(false)} />
      )}
    </div>
  );
});
