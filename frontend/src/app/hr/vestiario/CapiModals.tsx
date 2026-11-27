'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

export interface Capo { id: number; nome: string; colore: string; n_taglie: number }

interface ImportRiepilogo {
  applicato: boolean;
  capi: { nome: string; colore: string; nuovo: boolean; n_taglie: number }[];
  n_dipendenti: number;
  n_taglie: number;
  gilet_si: number;
  gilet_no: number;
  non_trovati: { riga: number; nome: string; motivo: string }[];
  avvisi: { riga: number; nome: string; capo: string; valore: string; motivo: string }[];
}

const capoLabel = (k: { nome: string; colore: string }) => (k.colore ? `${k.nome} (${k.colore})` : k.nome);

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-card bg-white p-6 shadow-float" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Import da Excel: il file si legge qui, ma l'abbinamento e le regole stanno nel backend.
// Prima un'anteprima (nulla viene salvato), poi «Importa» scrive davvero.
export function ImportCapiModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<{ header: string[]; rows: string[][] } | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportRiepilogo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(''); setPreview(null); setData(null); setFileName(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
      const lines = grid.map(r => r.map(v => String(v ?? '').trim())).filter(r => r.some(v => v !== ''));
      if (lines.length < 2) { setError('Il file non ha righe di dati'); return; }
      const width = lines[0].length;
      const parsed = { header: lines[0], rows: lines.slice(1).map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')) };
      setData(parsed);
      setBusy(true);
      setPreview(await api.post<ImportRiepilogo>('/api/hr/vestiario/import', { apply: false, ...parsed }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore nella lettura del file');
    } finally { setBusy(false); }
  }

  async function applica() {
    if (!data) return;
    setBusy(true); setError('');
    try {
      await api.post<ImportRiepilogo>('/api/hr/vestiario/import', { apply: true, ...data }, 60_000);
      toast.success('Taglie importate');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante l\'import');
    } finally { setBusy(false); }
  }

  return (
    <Shell title="Importa taglie da Excel" onClose={onClose}>
      <p className="text-sm text-muted">
        Prima colonna: <b>COGNOME E NOME</b>. Le altre colonne sono i capi; il colore va tra parentesi nell&apos;intestazione
        (es. <i>FELPA BCWG004 (GRIGIA)</i>). Nelle celle basta la taglia (XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL); se c&apos;è altro testo
        (es. «L uomo») si prende solo la taglia. La colonna <b>GILET</b> è SI/NO: chi ha SI non entra nella somma degli altri capi. I capi e i colori che non esistono vengono creati. Le celle vuote non cancellano le taglie già inserite.
      </p>
      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn-secondary text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>Scegli file</button>
        <span className="truncate text-sm text-muted">{fileName || 'Nessun file'}</span>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {busy && !preview && <p className="text-sm text-muted">Lettura in corso…</p>}

      {preview && (
        <div className="space-y-3 text-sm">
          <p className="text-ink-900">
            <b>{preview.n_taglie}</b> taglie per <b>{preview.n_dipendenti}</b> dipendenti, su <b>{preview.capi.length}</b> capi.
          </p>
          {(preview.gilet_si > 0 || preview.gilet_no > 0) && (
            <p className="text-ink-900">Gilet: <b>{preview.gilet_si}</b> sì, <b>{preview.gilet_no}</b> no. Chi ha il gilet non conta negli altri capi da ordinare.</p>
          )}
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {preview.capi.map(k => (
              <li key={`${k.nome}|${k.colore}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span>{capoLabel(k)}</span>
                <span className="whitespace-nowrap text-muted">
                  {k.n_taglie} taglie{k.nuovo && <span className="ml-2 badge-info">nuovo</span>}
                </span>
              </li>
            ))}
          </ul>
          {preview.non_trovati.length > 0 && (
            <div>
              <p className="font-medium text-warning">{preview.non_trovati.length} righe non importate</p>
              <ul className="mt-1 max-h-32 overflow-y-auto text-muted">
                {preview.non_trovati.map(n => <li key={n.riga}>Riga {n.riga}: {n.nome} — {n.motivo}</li>)}
              </ul>
            </div>
          )}
          {preview.avvisi.length > 0 && (
            <div>
              <p className="font-medium text-warning">{preview.avvisi.length} celle ignorate</p>
              <ul className="mt-1 max-h-32 overflow-y-auto text-muted">
                {preview.avvisi.map((a, i) => <li key={i}>Riga {a.riga}: {a.nome} · {a.capo} «{a.valore}» — {a.motivo}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary text-sm" onClick={onClose}>Chiudi</button>
        <button className="btn-primary text-sm" onClick={applica} disabled={busy || !preview || (preview.n_taglie === 0 && preview.gilet_si + preview.gilet_no === 0)}>Importa</button>
      </div>
    </Shell>
  );
}

// Rinomina capo e colore (o elimina un capo creato per errore)
export function GestisciCapiModal({ capi, onClose, onChanged }: { capi: Capo[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Record<number, { nome: string; colore: string }>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function salva(k: Capo) {
    const v = edit[k.id];
    if (!v || !v.nome.trim()) return;
    setBusy(k.id);
    try {
      await api.patch(`/api/hr/vestiario/capi/${k.id}`, { nome: v.nome, colore: v.colore });
      setEdit(e => Object.fromEntries(Object.entries(e).filter(([id]) => Number(id) !== k.id)));
      toast.success('Capo aggiornato');
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Errore'); }
    finally { setBusy(null); }
  }

  async function elimina(k: Capo) {
    if (!window.confirm(`Eliminare «${capoLabel(k)}»? Si perdono anche le ${k.n_taglie} taglie assegnate.`)) return;
    setBusy(k.id);
    try {
      await api.delete(`/api/hr/vestiario/capi/${k.id}`);
      toast.success('Capo eliminato');
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Errore'); }
    finally { setBusy(null); }
  }

  return (
    <Shell title="Capi e colori" onClose={onClose}>
      {capi.length === 0 ? (
        <p className="text-sm text-muted">Nessun capo: importa un Excel per crearli.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_9rem_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span>Capo</span><span>Colore</span><span />
          </div>
          {capi.map(k => {
            const v = edit[k.id] ?? { nome: k.nome, colore: k.colore };
            const dirty = !!edit[k.id] && (v.nome !== k.nome || v.colore !== k.colore);
            return (
              <div key={k.id} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
                <input className="input" maxLength={120} value={v.nome} onChange={e => setEdit(s => ({ ...s, [k.id]: { ...v, nome: e.target.value } }))} />
                <input className="input" maxLength={60} value={v.colore} onChange={e => setEdit(s => ({ ...s, [k.id]: { ...v, colore: e.target.value } }))} />
                <div className="flex gap-1">
                  <button className="btn-primary text-sm" disabled={!dirty || busy === k.id} onClick={() => salva(k)}>Salva</button>
                  <button className="btn-secondary text-sm" disabled={busy === k.id} onClick={() => elimina(k)}>Elimina</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex justify-end">
        <button className="btn-secondary text-sm" onClick={onClose}>Chiudi</button>
      </div>
    </Shell>
  );
}
