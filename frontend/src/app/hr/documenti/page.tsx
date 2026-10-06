'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import type { HrDocument, HrDocumentPlaceholder, HrEmployee, HrEventType } from '@/types';
import { useToast } from '@/components/ui/Toast';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Stesse etichette della timeline, più l'aumento retributivo (riga nello storico retributivo,
// che non è un evento della timeline)
const EVENT_LABEL: Record<HrEventType | 'aumento_retributivo', string> = {
  assunzione: 'Assunzione', cambio_reparto: 'Cambio reparto', cambio_mansione: 'Cambio mansione',
  cambio_livello: 'Cambio livello', cambio_capo: 'Cambio responsabile',
  trasferimento: 'Trasferimento', promozione: 'Promozione', cessazione: 'Cessazione/Dimissioni',
  malattia: 'Malattia', maternita_paternita: 'Maternità/Paternità', infortunio: 'Infortunio',
  congedo: 'Congedo', rientro: 'Rientro', altro: 'Altro',
  aumento_retributivo: 'Aumento retributivo (nuova riga nello storico retributivo)',
};

const GROUP_LABEL: Record<HrDocumentPlaceholder['group'], string> = {
  anagrafica: 'Dati del dipendente (automatici)',
  evento: 'Dati del cambiamento (da timeline, correggibili)',
  retribuzione: 'Retribuzione (richiede permesso dati retributivi)',
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtSize(n: number | null): string {
  if (n == null) return '';
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const b = await res.json().catch(() => ({}));
  return b.message ?? b.error ?? fallback;
}

async function downloadFrom(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') ?? '';
  const m = disp.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface DocForm { name: string; description: string; kind: 'modello' | 'consultazione'; event_type: string }
const EMPTY_FORM: DocForm = { name: '', description: '', kind: 'modello', event_type: '' };

export default function DocumentiPage() {
  const { canManage } = useAuth();
  const manage = canManage('hr');
  const toast = useToast();

  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [generating, setGenerating] = useState<HrDocument | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${BACKEND}/api/hr/documents`, { credentials: 'include' });
    if (res.ok) setDocs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Vista di uso: solo ciò che è pronto (attivo e con file caricato)
  const ready = docs.filter(d => d.is_active && d.has_file);
  const modelli = ready.filter(d => d.kind === 'modello');
  const consultazione = ready.filter(d => d.kind === 'consultazione');
  const missing = docs.filter(d => d.is_active && !d.has_file).length;

  async function download(d: HrDocument, kind: 'file' | 'blank') {
    setBusyId(d.id);
    const res = await fetch(`${BACKEND}/api/hr/documents/${d.id}/${kind}`, { credentials: 'include' });
    setBusyId(null);
    if (!res.ok) { toast.error(await errorMessage(res, 'Errore durante il download')); return; }
    await downloadFrom(res, d.file_name ?? d.name);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Documenti</h1>
          <p className="text-xs text-gray-400 mt-0.5">Lettere e modelli: scaricali vuoti o compilali per un dipendente</p>
        </div>
        {manage && <button onClick={() => setShowConfig(true)} className="btn-secondary text-sm">Gestisci documenti</button>}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
      ) : (
        <>
          {manage && missing > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {missing} {missing === 1 ? 'documento è' : 'documenti sono'} ancora senza file: caricalo da &quot;Gestisci documenti&quot;.
            </p>
          )}

          {modelli.length === 0 && consultazione.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-sm text-gray-400">Nessun documento pronto.</p>
              {manage && <p className="text-xs text-gray-400 mt-1">Usa &quot;Gestisci documenti&quot; per caricare i modelli.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {modelli.map(d => {
                const busy = busyId === d.id;
                return (
                  <div key={d.id} className="card flex flex-col gap-3">
                    <div>
                      <h2 className="font-semibold text-gray-800">{d.name}</h2>
                      {d.description && <p className="text-xs text-gray-400 mt-1">{d.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 mt-auto flex-wrap">
                      {manage && <button disabled={busy} onClick={() => setGenerating(d)} className="btn-primary text-sm">Genera per dipendente</button>}
                      <button disabled={busy} onClick={() => download(d, 'blank')} className="btn-secondary text-sm">{busy ? 'Attendi…' : 'Scarica vuoto'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {consultazione.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">Documenti di consultazione</div>
              {consultazione.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-4 px-4 py-3 border-b border-gray-100 last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{d.name}</p>
                    {d.description && <p className="text-xs text-gray-400 mt-0.5">{d.description}</p>}
                  </div>
                  <button disabled={busyId === d.id} onClick={() => download(d, 'file')} className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap">Scarica</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showConfig && manage && <ConfigModal docs={docs} onChanged={load} onClose={() => setShowConfig(false)} />}
      {generating && <GenerateModal doc={generating} onClose={() => setGenerating(null)} />}
    </div>
  );
}

// ─── Configurazione: caricamento file, voci, segnaposto ──────────────────────

function ConfigModal({ docs, onChanged, onClose }: { docs: HrDocument[]; onChanged: () => void; onClose: () => void }) {
  const toast = useToast();
  const [placeholders, setPlaceholders] = useState<HrDocumentPlaceholder[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [editing, setEditing] = useState<HrDocument | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DocForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<HrDocument | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/hr/documents/placeholders`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPlaceholders);
  }, []);

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true); }
  function openEdit(d: HrDocument) {
    setEditing(d);
    setForm({ name: d.name, description: d.description ?? '', kind: d.kind, event_type: d.event_type ?? '' });
    setFormOpen(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      event_type: form.kind === 'modello' && form.event_type ? form.event_type : null,
      ...(editing ? {} : { sort_order: docs.length + 1 }),
    };
    const res = await fetch(editing ? `${BACKEND}/api/hr/documents/${editing.id}` : `${BACKEND}/api/hr/documents`, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) { setFormOpen(false); onChanged(); }
    else toast.error(await errorMessage(res, 'Errore durante il salvataggio'));
  }

  async function remove(d: HrDocument) {
    if (!window.confirm(`Eliminare "${d.name}"? Il file caricato andrà perso.`)) return;
    const res = await fetch(`${BACKEND}/api/hr/documents/${d.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) onChanged(); else toast.error(await errorMessage(res, "Errore durante l'eliminazione"));
  }

  async function toggleActive(d: HrDocument) {
    const res = await fetch(`${BACKEND}/api/hr/documents/${d.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ is_active: !d.is_active }),
    });
    if (res.ok) onChanged(); else toast.error(await errorMessage(res, 'Errore durante il salvataggio'));
  }

  function pickFile(d: HrDocument) {
    uploadTarget.current = d;
    fileInput.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const doc = uploadTarget.current;
    e.target.value = '';
    if (!file || !doc) return;
    setBusyId(doc.id);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BACKEND}/api/hr/documents/${doc.id}/file`, { method: 'PUT', credentials: 'include', body: fd });
    setBusyId(null);
    if (!res.ok) { toast.error(await errorMessage(res, 'Errore durante il caricamento')); return; }
    const out = await res.json();
    if (out.unknown_placeholders?.length) {
      toast.error(`Segnaposto non riconosciuti: ${out.unknown_placeholders.map((p: string) => `{${p}}`).join(', ')} — verranno lasciati vuoti`);
    } else {
      toast.success('File caricato');
    }
    onChanged();
  }

  async function downloadOriginal(d: HrDocument) {
    const res = await fetch(`${BACKEND}/api/hr/documents/${d.id}/file`, { credentials: 'include' });
    if (!res.ok) { toast.error(await errorMessage(res, 'Errore durante il download')); return; }
    await downloadFrom(res, d.file_name ?? d.name);
  }

  function copyTag(key: string) {
    navigator.clipboard?.writeText(`{${key}}`).then(() => toast.success(`Copiato {${key}}`), () => {});
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="card w-full max-w-5xl max-h-[95vh] overflow-y-auto space-y-4 relative" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={onClose} aria-label="Chiudi"
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">×</button>

          <div className="pr-8 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-gray-700">Gestisci documenti</p>
              <p className="text-xs text-gray-400 mt-1">
                Carica il file Word di ogni modello con i segnaposto tra graffe, ad esempio {'{nome}'} o {'{data_decorrenza}'}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowGuide(s => !s)} className="btn-secondary text-sm">{showGuide ? 'Nascondi segnaposto' : 'Segnaposto disponibili'}</button>
              <button onClick={openNew} className="btn-primary text-sm">Nuovo documento</button>
            </div>
          </div>

          <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />

          {showGuide && (
            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">Clicca un segnaposto per copiarlo, poi incollalo nel file Word. Il resto del testo e il logo restano come sono.</p>
              {(['anagrafica', 'evento', 'retribuzione'] as const).map(g => (
                <div key={g}>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">{GROUP_LABEL[g]}</p>
                  <div className="flex flex-wrap gap-2">
                    {placeholders.filter(p => p.group === g).map(p => (
                      <button key={p.key} type="button" onClick={() => copyTag(p.key)} title={p.label}
                        className="text-xs bg-white hover:bg-blue-50 border border-gray-200 rounded px-2 py-1 text-gray-700">
                        <span className="font-mono">{`{${p.key}}`}</span>
                        <span className="text-gray-400"> · {p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {docs.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">Nessun documento</p> : docs.map(d => {
              const busy = busyId === d.id;
              return (
                <div key={d.id} className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-b-0 flex-wrap ${d.is_active ? '' : 'opacity-50'}`}>
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="text-sm font-medium text-gray-800">
                      {d.name}
                      <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">{d.kind === 'modello' ? 'Modello' : 'Consultazione'}</span>
                    </p>
                    <p className="text-xs mt-1 text-gray-500">
                      {d.has_file
                        ? <>{d.file_name} · {fmtSize(d.file_size)} · caricato {fmtDate(d.uploaded_at)}{d.uploaded_by_name ? ` da ${d.uploaded_by_name}` : ''}</>
                        : <span className="text-amber-600">File non ancora caricato</span>}
                      {d.kind === 'modello' && d.has_file && <> · {d.placeholders.length} segnaposto</>}
                      {d.event_type && <> · proposto su: <span className="text-gray-700">{EVENT_LABEL[d.event_type] ?? d.event_type}</span></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap flex-wrap">
                    <button disabled={busy} onClick={() => pickFile(d)} className="text-xs text-blue-600 hover:text-blue-800">
                      {busy ? 'Attendi…' : d.has_file ? 'Sostituisci file' : 'Carica file'}
                    </button>
                    {d.has_file && <button onClick={() => downloadOriginal(d)} className="text-xs text-blue-600 hover:text-blue-800">Originale</button>}
                    <button onClick={() => openEdit(d)} className="text-xs text-gray-500 hover:text-gray-800">Modifica</button>
                    <button onClick={() => toggleActive(d)} className="text-xs text-gray-500 hover:text-gray-800">{d.is_active ? 'Disattiva' : 'Attiva'}</button>
                    <button onClick={() => remove(d)} className="text-xs text-red-400 hover:text-red-600">Elimina</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <form onSubmit={submitForm} className="card w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-700">{editing ? 'Modifica documento' : 'Nuovo documento'}</p>
            <div><label className="label">Nome</label>
              <input className="input text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div><label className="label">Descrizione (facoltativa)</label>
              <input className="input text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div><label className="label">Tipo</label>
              <select className="input text-sm" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as DocForm['kind'] }))}>
                <option value="modello">Modello compilabile (.docx con segnaposto)</option>
                <option value="consultazione">Documento di consultazione (PDF, Word, Excel…)</option>
              </select>
            </div>
            {form.kind === 'modello' && (
              <div><label className="label">Proponi quando si registra…</label>
                <select className="input text-sm" value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                  <option value="">Nessun evento (solo manuale)</option>
                  {Object.entries(EVENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setFormOpen(false)} className="btn-secondary text-sm">Annulla</button>
              <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary text-sm">Salva</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// ─── Compilazione per un dipendente ──────────────────────────────────────────

function GenerateModal({ doc, onClose }: { doc: HrDocument; onClose: () => void }) {
  const toast = useToast();
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [fields, setFields] = useState<{ key: string; label: string; value: string }[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: HrEmployee[]) => setEmployees(rows.filter(e => e.stato !== 'cessato')));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? employees.filter(e => `${e.cognome} ${e.nome} ${e.matricola ?? ''}`.toLowerCase().includes(q)) : employees;
    return list.slice(0, 50);
  }, [employees, search]);

  async function choose(id: number) {
    setEmployeeId(id);
    setLoadingPreview(true);
    const res = await fetch(`${BACKEND}/api/hr/documents/${doc.id}/preview/${id}`, { credentials: 'include' });
    setLoadingPreview(false);
    if (res.ok) setFields((await res.json()).editable);
    else { setFields([]); toast.error(await errorMessage(res, 'Impossibile leggere i dati del dipendente')); }
  }

  async function generate() {
    if (employeeId == null) return;
    setBusy(true);
    const res = await fetch(`${BACKEND}/api/hr/documents/${doc.id}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ employee_id: employeeId, values: Object.fromEntries(fields.map(f => [f.key, f.value])) }),
    });
    setBusy(false);
    if (!res.ok) { toast.error(await errorMessage(res, 'Errore durante la generazione')); return; }
    await downloadFrom(res, `${doc.name}.docx`);
    onClose();
  }

  const selected = employees.find(e => e.id === employeeId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-sm font-semibold text-gray-700">Genera: {doc.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">Scegli il dipendente. I campi vuoti restano come riga ________ da riempire a mano.</p>
        </div>

        <div>
          <label className="label">Dipendente</label>
          <input className="input text-sm" placeholder="Cerca per cognome, nome o matricola…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          <div className="border border-gray-200 rounded-lg mt-2 max-h-44 overflow-y-auto">
            {filtered.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">Nessun risultato</p> : filtered.map(e => (
              <button key={e.id} type="button" onClick={() => choose(e.id)}
                className={`w-full text-left px-3 py-1.5 text-sm border-b border-gray-50 last:border-b-0 hover:bg-gray-50 ${e.id === employeeId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
                {e.cognome} {e.nome}{e.matricola ? <span className="text-gray-400"> · {e.matricola}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {employeeId != null && (
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">Documento per <b>{selected ? `${selected.cognome} ${selected.nome}` : ''}</b></p>
            {loadingPreview ? <p className="text-xs text-gray-400">Caricamento…</p> : fields.length === 0
              ? <p className="text-xs text-gray-400">Questo modello non ha campi da verificare: usa solo i dati della scheda.</p>
              : fields.map((f, i) => (
                <div key={f.key}><label className="label">{f.label}</label>
                  <input className="input text-sm" value={f.value} placeholder="(vuoto → ________)"
                    onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                </div>
              ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annulla</button>
          <button type="button" onClick={generate} disabled={busy || employeeId == null || loadingPreview} className="btn-primary text-sm">
            {busy ? 'Generazione…' : 'Genera e scarica .docx'}
          </button>
        </div>
      </div>
    </div>
  );
}
