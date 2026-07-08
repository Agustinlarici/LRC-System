'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { ImportExcelButton, type ImportResult } from '@/components/ui/ImportExcelButton';

// Parses a number from a string handling both dot and comma as decimal separator
function parseNum(v: string | undefined): number {
  if (!v) return NaN;
  return parseFloat(v.replace(',', '.'));
}

// Looks up a column value trying multiple possible header names
function col(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

// ─── BC Sync ──────────────────────────────────────────────────────────────────

const SYNC_TIMEOUT_MS = 120_000;

function SyncSection() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ inserted: number; bc_total: number; existing_in_pg: number } | null>(null);
  const [error,   setError]   = useState('');

  const [code,        setCode]        = useState('');
  const [description, setDescription] = useState('');
  const [family,       setFamily]      = useState('');
  const [adding,       setAdding]      = useState(false);
  const [addMsg,        setAddMsg]      = useState('');
  const [addError,      setAddError]    = useState('');

  async function runSync() {
    if (!confirm('Sincronizzare gli articoli da Business Central? L\'operazione può richiedere qualche minuto.')) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.post<{ ok: boolean; inserted: number; bc_total: number; existing_in_pg: number; error?: string }>(
        '/api/pack/articles/sync-from-bc',
        undefined,
        SYNC_TIMEOUT_MS
      );
      if (!data.ok) throw new Error(data.error || 'Errore sconosciuto');
      setResult(data);
      _articlesCache = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setAdding(true); setAddMsg(''); setAddError('');
    try {
      await api.post('/api/pack/articles', {
        code:        code.trim(),
        description: description.trim() || null,
        family:      family.trim()      || null,
      });
      setAddMsg(`Articolo "${code.trim().toUpperCase()}" aggiunto.`);
      setCode(''); setDescription(''); setFamily('');
      _articlesCache = null;
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Errore aggiunta articolo');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        {result && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex justify-between items-center">
            <div className="flex gap-4">
              <span><strong>Inseriti:</strong> {result.inserted}</span>
              <span><strong>Totale BC:</strong> {result.bc_total}</span>
              <span><strong>Già presenti:</strong> {result.existing_in_pg}</span>
            </div>
            <button onClick={() => setResult(null)} className="text-green-500 hover:text-green-700">✕</button>
          </div>
        )}
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="font-medium text-gray-800 text-sm">Sincronizza da Business Central</p>
            <p className="text-xs text-gray-500 mt-0.5">Inserisce solo i codici articolo mancanti. Automatico ogni giorno alle 03:00.</p>
          </div>
          <button onClick={runSync} disabled={loading} className="btn-primary whitespace-nowrap text-sm">
            {loading ? 'Sincronizzazione...' : 'Sincronizza ora'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-700 mb-3">Aggiungi articolo manualmente</h3>
        <p className="text-xs text-gray-500 mb-3">Per articoli non ancora presenti in Business Central o non sincronizzati.</p>
        {addError && <p className="text-red-600 text-sm mb-3">{addError}</p>}
        {addMsg && <p className="text-green-600 text-sm mb-3">{addMsg}</p>}
        <form onSubmit={addManual} className="grid grid-cols-1 md:grid-cols-[200px_1fr_180px_auto] gap-3">
          <input className="input" placeholder="Codice articolo" value={code} onChange={e => setCode(e.target.value)} />
          <input className="input" placeholder="Descrizione (opzionale)" value={description} onChange={e => setDescription(e.target.value)} />
          <input className="input" placeholder="Famiglia (opzionale)" value={family} onChange={e => setFamily(e.target.value)} />
          <button type="submit" disabled={adding || !code.trim()} className="btn btn-primary">
            {adding ? '...' : '+ Aggiungi'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Lista generica nome ──────────────────────────────────────────────────────

interface Voce { id: number; name: string; }

function ListaVoce({ titolo, voci, loading, errore, onAggiungi, onElimina, importEndpoint, importColumns }: {
  titolo: string; voci: Voce[]; loading: boolean; errore: string;
  onAggiungi: (nome: string) => Promise<void>; onElimina: (id: number) => Promise<void>;
  importEndpoint: string; importColumns: string[];
}) {
  const [nome, setNome] = useState('');
  const [invio, setInvio] = useState(false);

  const handleAggiungi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setInvio(true); await onAggiungi(nome.trim()); setNome(''); setInvio(false);
  };

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const nome = row['nome']?.trim();
      if (!nome) { skipped++; continue; }
      try {
        await api.post(importEndpoint, { name: nome });
        inserted++;
      } catch {
        skipped++; // duplicate
      }
    }
    return { inserted, skipped, errors };
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4">
        <form onSubmit={handleAggiungi} className="flex gap-2 flex-1">
          <input className="input flex-1 max-w-xs" value={nome} onChange={e => setNome(e.target.value)} placeholder={`Nuovo ${titolo.toLowerCase()}...`} />
          <button type="submit" className="btn btn-primary" disabled={invio || !nome.trim()}>{invio ? '...' : '+ Aggiungi'}</button>
        </form>
        <ImportExcelButton
          columns={importColumns}
          processRows={processImportRows}
          onDone={async () => { /* parent refreshes on next render */ }}
        />
      </div>
      {errore && <div className="text-sm text-red-600 mb-3">{errore}</div>}
      {loading ? <p className="text-sm text-gray-400">Caricamento...</p> : voci.length === 0 ? <p className="text-sm text-gray-400">Nessun {titolo.toLowerCase()} presente.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-gray-200"><th className="pb-2 w-12 text-gray-400 font-normal">#</th><th className="pb-2 font-medium text-gray-700">{titolo}</th><th className="pb-2 w-20" /></tr></thead>
          <tbody>
            {voci.map(v => (
              <tr key={v.id} className="border-b border-gray-100 last:border-0">
                <td className="py-2 text-gray-400">{v.id}</td>
                <td className="py-2">{v.name}</td>
                <td className="py-2 text-right"><button className="text-xs text-red-500 hover:text-red-700" onClick={() => { if (confirm(`Eliminare "${v.name}"?`)) onElimina(v.id); }}>Elimina</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Scatole (Contenitori) ────────────────────────────────────────────────────

interface Container {
  id: number; name: string;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
  tare_kg: number | null; active: boolean;
}

function ScatoleSection() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading]       = useState(true);
  const [form, setForm]             = useState({ name: '', length_mm: '', width_mm: '', height_mm: '', tare_kg: '' });
  const [editId, setEditId]         = useState<number | null>(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    const data = await api.get<Container[]>('/api/pack/containers').catch(() => []);
    setContainers(data); setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  function startEdit(c: Container) {
    setEditId(c.id);
    setForm({ name: c.name, length_mm: c.length_mm?.toString() ?? '', width_mm: c.width_mm?.toString() ?? '', height_mm: c.height_mm?.toString() ?? '', tare_kg: c.tare_kg?.toString() ?? '' });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/pack/containers/upsert', {
        ...(editId ? { id: editId } : {}),
        name: form.name.trim(),
        length_mm: form.length_mm ? Number(form.length_mm) : null,
        width_mm:  form.width_mm  ? Number(form.width_mm)  : null,
        height_mm: form.height_mm ? Number(form.height_mm) : null,
        tare_kg:   form.tare_kg   ? Number(form.tare_kg)   : null,
        active: true,
      });
      setForm({ name: '', length_mm: '', width_mm: '', height_mm: '', tare_kg: '' });
      setEditId(null);
      fetch();
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(false); }
  }

  async function elimina(id: number, name: string) {
    if (!confirm(`Eliminare la scatola "${name}"?`)) return;
    await api.delete(`/api/pack/containers/${id}`).catch(() => setError('Errore eliminazione'));
    fetch();
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    const existingNames = new Set(containers.map(c => c.name.toLowerCase()));
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const nome = row['nome']?.trim();
      if (!nome) { skipped++; continue; }
      if (existingNames.has(nome.toLowerCase())) { skipped++; continue; }
      const lmm  = row['lunghezza_mm'] ? Number(row['lunghezza_mm']) : null;
      const wmm  = row['larghezza_mm'] ? Number(row['larghezza_mm']) : null;
      const hmm  = row['altezza_mm']   ? Number(row['altezza_mm'])   : null;
      const tare = row['tara_kg']      ? Number(row['tara_kg'])      : null;
      try {
        await api.post('/api/pack/containers/upsert', { name: nome, length_mm: lmm, width_mm: wmm, height_mm: hmm, tare_kg: tare, active: true });
        existingNames.add(nome.toLowerCase());
        inserted++;
      } catch { errors++; }
    }
    return { inserted, skipped, errors };
  }

  const inp = (field: keyof typeof form, placeholder: string, type = 'text') => (
    <input
      type={type}
      className="input w-full"
      placeholder={placeholder}
      value={form[field]}
      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
    />
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1">
          <div className="col-span-2 md:col-span-3">{inp('name', 'Nome scatola (es. Scatola grande)')}</div>
          {inp('length_mm', 'Lunghezza (mm)', 'number')}
          {inp('width_mm',  'Larghezza (mm)', 'number')}
          {inp('height_mm', 'Altezza (mm)',   'number')}
          {inp('tare_kg',   'Tara scatola (kg)', 'number')}
          <button type="submit" disabled={saving || !form.name.trim()} className="btn btn-primary col-span-2">
            {saving ? '...' : editId ? 'Aggiorna' : '+ Aggiungi'}
          </button>
          {editId && <button type="button" className="btn" onClick={() => { setEditId(null); setForm({ name: '', length_mm: '', width_mm: '', height_mm: '', tare_kg: '' }); }}>Annulla</button>}
        </form>
        <ImportExcelButton
          columns={['nome', 'lunghezza_mm', 'larghezza_mm', 'altezza_mm', 'tara_kg']}
          processRows={processImportRows}
          onDone={fetch}
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> : containers.length === 0 ? <p className="text-gray-400 text-sm">Nessuna scatola configurata.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
            <th className="py-2">Nome</th><th className="py-2">L×W×H (mm)</th><th className="py-2">Tara</th><th className="py-2 w-24"></th>
          </tr></thead>
          <tbody>
            {containers.map(c => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="py-2 font-medium">{c.name}</td>
                <td className="py-2 text-gray-500">
                  {c.length_mm && c.width_mm && c.height_mm ? `${c.length_mm}×${c.width_mm}×${c.height_mm}` : '–'}
                </td>
                <td className="py-2 text-gray-500">{c.tare_kg != null ? `${c.tare_kg} kg` : '–'}</td>
                <td className="py-2 text-right flex gap-2 justify-end">
                  <button className="text-xs text-blue-500 hover:text-blue-700" onClick={() => startEdit(c)}>Modifica</button>
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={() => elimina(c.id, c.name)}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Article autocomplete ─────────────────────────────────────────────────────

let _articlesCache: string[] | null = null;

function useArticles() {
  const [articles, setArticles] = useState<string[]>(_articlesCache ?? []);
  useEffect(() => {
    if (_articlesCache) return;
    api.get<string[]>('/api/pack/articles').catch(() => []).then(data => {
      _articlesCache = data;
      setArticles(data);
    });
  }, []);
  return articles;
}

function ArticleInput({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const articles = useArticles();
  const listId = 'article-autocomplete-list';

  return (
    <>
      <datalist id={listId}>
        {articles.map(code => <option key={code} value={code} />)}
      </datalist>
      <input
        className="input w-full"
        list={listId}
        placeholder="Codice articolo"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </>
  );
}

// ─── Pesi e Prezzi articoli ───────────────────────────────────────────────────

interface ArticleWeight { article_code: string; description: string | null; unit_weight_kg: number; }
interface ArticlePrice  { article_code: string; description: string | null; currency: string; unit_cost: number; }

function PesiSection() {
  const [rows,    setRows]    = useState<ArticleWeight[]>([]);
  const [loading, setLoading] = useState(true);
  const [code,    setCode]    = useState('');
  const [weight,  setWeight]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    const data = await api.get<ArticleWeight[]>('/api/pack/article-weights').catch(() => []);
    setRows(data); setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !weight) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/pack/article-weight/upsert', { article_code: code.trim().toUpperCase(), unit_weight_kg: Number(weight) });
      setCode(''); setWeight(''); fetch();
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(false); }
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const code   = col(row, 'codice_articolo', 'codice')?.trim().toUpperCase();
      const weight = parseNum(col(row, 'peso_kg', 'peso'));
      if (!code || isNaN(weight)) { skipped++; continue; }
      try {
        await api.post('/api/pack/article-weight/upsert', { article_code: code, unit_weight_kg: weight });
        inserted++;
      } catch { errors++; }
    }
    const detail = inserted === 0 && skipped > 0
      ? `Colonne lette: ${Object.keys(rows[0] ?? {}).join(', ')}. Attese: codice_articolo, peso_kg`
      : undefined;
    return { inserted, skipped, errors, detail };
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_180px_auto] gap-3 flex-1">
          <ArticleInput value={code} onChange={setCode} />
          <input className="input" type="number" step="0.0001" placeholder="Peso unitario (kg)" value={weight} onChange={e => setWeight(e.target.value)} />
          <button type="submit" disabled={saving || !code.trim() || !weight} className="btn btn-primary">
            {saving ? '...' : 'Salva'}
          </button>
        </form>
        <ImportExcelButton
          columns={['codice_articolo', 'peso_kg']}
          processRows={processImportRows}
          onDone={fetch}
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> : rows.length === 0 ? <p className="text-gray-400 text-sm">Nessun peso configurato.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
            <th className="py-2">Codice</th><th className="py-2">Descrizione</th><th className="py-2">Peso (kg)</th><th className="py-2 w-20"></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.article_code} className="border-b border-gray-100">
                <td className="py-2 font-mono">{r.article_code}</td>
                <td className="py-2 text-gray-500">{r.description || '–'}</td>
                <td className="py-2">{r.unit_weight_kg} kg</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={async () => { if (!confirm(`Eliminare il peso per "${r.article_code}"?`)) return; await api.delete(`/api/pack/article-weight/${r.article_code}`).catch(() => setError('Errore eliminazione')); fetch(); }}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PrezziSection() {
  const [rows,    setRows]    = useState<ArticlePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [code,    setCode]    = useState('');
  const [cost,    setCost]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    const data = await api.get<ArticlePrice[]>('/api/pack/article-prices').catch(() => []);
    setRows(data); setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !cost) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/pack/article-prices/upsert', { article_code: code.trim().toUpperCase(), currency: 'EUR', unit_cost: Number(cost) });
      setCode(''); setCost(''); fetch();
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(false); }
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const code    = col(row, 'codice_articolo', 'codice')?.trim().toUpperCase();
      const costStr = col(row, 'prezzo_eur', 'prezzo_eu', 'prezzo', 'unit_cost');
      const cost    = parseNum(costStr);
      if (!code) { skipped++; continue; }
      if (isNaN(cost)) { skipped++; continue; }
      try {
        await api.post('/api/pack/article-prices/upsert', { article_code: code, currency: 'EUR', unit_cost: cost });
        inserted++;
      } catch { errors++; }
    }
    const detail = inserted === 0 && skipped > 0
      ? `Colonne lette: ${Object.keys(rows[0] ?? {}).join(', ')}. Attese: codice_articolo, prezzo_eur`
      : undefined;
    return { inserted, skipped, errors, detail };
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_180px_auto] gap-3 flex-1">
          <ArticleInput value={code} onChange={setCode} />
          <input className="input" type="number" step="0.0001" placeholder="Prezzo EUR" value={cost} onChange={e => setCost(e.target.value)} />
          <button type="submit" disabled={saving || !code.trim() || !cost} className="btn btn-primary">
            {saving ? '...' : 'Salva'}
          </button>
        </form>
        <ImportExcelButton
          columns={['codice_articolo', 'prezzo_eur']}
          processRows={processImportRows}
          onDone={fetch}
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> : rows.length === 0 ? <p className="text-gray-400 text-sm">Nessun prezzo configurato.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
            <th className="py-2">Codice</th><th className="py-2">Descrizione</th><th className="py-2">Prezzo EUR</th><th className="py-2 w-20"></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.article_code} className="border-b border-gray-100">
                <td className="py-2 font-mono">{r.article_code}</td>
                <td className="py-2 text-gray-500">{r.description || '–'}</td>
                <td className="py-2">€ {Number(r.unit_cost).toFixed(4)}</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={async () => { if (!confirm(`Eliminare il prezzo per "${r.article_code}"?`)) return; await api.delete(`/api/pack/article-prices/${r.article_code}`).catch(() => setError('Errore eliminazione')); fetch(); }}>Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Associazioni articolo → scatola ─────────────────────────────────────────

interface ArticleContainer {
  article_code: string; description: string | null;
  container_id: number | null; container_name: string | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null; tare_kg: number | null;
}

function AssociazioniSection() {
  const [rows,       setRows]       = useState<ArticleContainer[]>([]);
  const [containers, setContainers] = useState<{ id: number; name: string }[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [code,       setCode]       = useState('');
  const [contId,     setContId]     = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [r, c] = await Promise.all([
      api.get<ArticleContainer[]>('/api/pack/article-containers').catch(() => []),
      api.get<{ id: number; name: string }[]>('/api/pack/containers').catch(() => []),
    ]);
    setRows(r); setContainers(c); setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !contId) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/pack/article-container/map', { article_code: code.trim().toUpperCase(), container_id: Number(contId) });
      setCode(''); setContId(''); fetchAll();
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(false); }
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    const contMap = new Map(containers.map(c => [c.name.toLowerCase(), c.id]));
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const code     = row['codice_articolo']?.trim().toUpperCase();
      const contName = row['nome_scatola']?.trim();
      if (!code || !contName) { skipped++; continue; }
      const contId = contMap.get(contName.toLowerCase());
      if (!contId) { errors++; continue; }
      try {
        await api.post('/api/pack/article-container/map', { article_code: code, container_id: contId });
        inserted++;
      } catch { errors++; }
    }
    return { inserted, skipped, errors };
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <form onSubmit={save} className="grid grid-cols-[1fr_200px_auto] gap-3 flex-1">
          <ArticleInput value={code} onChange={setCode} />
          <select className="input" value={contId} onChange={e => setContId(e.target.value)}>
            <option value="">Seleziona scatola...</option>
            {containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" disabled={saving || !code.trim() || !contId} className="btn btn-primary">
            {saving ? '...' : 'Associa'}
          </button>
        </form>
        <ImportExcelButton
          columns={['codice_articolo', 'nome_scatola']}
          processRows={processImportRows}
          onDone={fetchAll}
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> : rows.length === 0 ? <p className="text-gray-400 text-sm">Nessuna associazione configurata.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
            <th className="py-2">Codice</th><th className="py-2">Descrizione</th><th className="py-2">Scatola</th><th className="py-2">L×W×H</th><th className="py-2 w-20"></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.article_code} className="border-b border-gray-100">
                <td className="py-2 font-mono">{r.article_code}</td>
                <td className="py-2 text-gray-500">{r.description || '–'}</td>
                <td className="py-2">{r.container_name || '–'}</td>
                <td className="py-2 text-gray-500">
                  {r.length_mm && r.width_mm && r.height_mm ? `${r.length_mm}×${r.width_mm}×${r.height_mm} mm` : '–'}
                </td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={async () => { if (!confirm(`Rimuovere associazione scatola per "${r.article_code}"?`)) return; await api.delete(`/api/pack/article-container/${r.article_code}`).catch(() => setError('Errore eliminazione')); fetchAll(); }}>Rimuovi</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Art. → Destinazioni ─────────────────────────────────────────────────────

interface DispatchRule {
  article_code:     string;
  description:      string | null;
  destination_id:   number;
  destination_name: string;
}

function ArticoloDestinazioniSection() {
  const [rules,      setRules]      = useState<DispatchRule[]>([]);
  const [dests,      setDests]      = useState<{ id: number; name: string }[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [code,       setCode]       = useState('');
  const [destId,     setDestId]     = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [r, d] = await Promise.all([
      api.get<DispatchRule[]>('/api/pack/article-dispatch-rules').catch(() => []),
      api.get<{ id: number; name: string }[]>('/api/pack/dispatch-destinations').catch(() => []),
    ]);
    setRules(r); setDests(d); setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !destId) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/pack/article-dispatch-rules', {
        article_code:   code.trim().toUpperCase(),
        destination_id: Number(destId),
      });
      setCode(''); setDestId(''); fetchAll();
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(false); }
  }

  async function remove(code: string, destId: number, destName: string) {
    if (!confirm(`Rimuovere destinazione "${destName}" per "${code}"?`)) return;
    await api.delete(`/api/pack/article-dispatch-rules/${code}/${destId}`).catch(() => setError('Errore eliminazione'));
    fetchAll();
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    const destMap = new Map(dests.map(d => [d.name.toLowerCase(), d.id]));
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      const code     = row['codice_articolo']?.trim().toUpperCase();
      const destName = row['nome_destinazione']?.trim();
      if (!code || !destName) { skipped++; continue; }
      const destId = destMap.get(destName.toLowerCase());
      if (!destId) { errors++; continue; }
      try {
        await api.post('/api/pack/article-dispatch-rules', { article_code: code, destination_id: destId });
        inserted++;
      } catch { errors++; }
    }
    return { inserted, skipped, errors };
  }

  const grouped = rules.reduce<Record<string, DispatchRule[]>>((acc, r) => {
    if (!acc[r.article_code]) acc[r.article_code] = [];
    acc[r.article_code].push(r);
    return acc;
  }, {});

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Se un articolo ha destinazioni configurate, può essere scansionato <strong>solo</strong> per quelle destinazioni.
        Se non ha nessuna configurazione, è permesso ovunque.
      </p>
      <div className="flex items-start justify-between gap-4 mb-4">
        <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_200px_auto] gap-3 flex-1">
          <ArticleInput value={code} onChange={setCode} />
          <select className="input" value={destId} onChange={e => setDestId(e.target.value)}>
            <option value="">Seleziona destinazione...</option>
            {dests.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="submit" disabled={saving || !code.trim() || !destId} className="btn btn-primary">
            {saving ? '...' : 'Aggiungi'}
          </button>
        </form>
        <ImportExcelButton
          columns={['codice_articolo', 'nome_destinazione']}
          processRows={processImportRows}
          onDone={fetchAll}
        />
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> :
       Object.keys(grouped).length === 0 ? <p className="text-gray-400 text-sm">Nessuna regola configurata — tutti gli articoli sono permessi ovunque.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
            <th className="py-2">Articolo</th>
            <th className="py-2">Descrizione</th>
            <th className="py-2">Destinazioni permesse</th>
          </tr></thead>
          <tbody>
            {Object.entries(grouped).map(([art, artRules]) => (
              <tr key={art} className="border-b border-gray-100 align-top">
                <td className="py-2 font-mono">{art}</td>
                <td className="py-2 text-gray-500">{artRules[0].description || '–'}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {artRules.map(r => (
                      <span key={r.destination_id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">
                        {r.destination_name}
                        <button
                          onClick={() => remove(art, r.destination_id, r.destination_name)}
                          className="text-blue-400 hover:text-red-500 leading-none font-bold"
                        >×</button>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Gruppi Commessa ─────────────────────────────────────────────────────────

interface CommessaGroup { id: number; name: string; }
interface ArticleGroup  { article_code: string; description: string | null; group_id: number; group_name: string; }

function GruppiSection() {
  const [gruppi,  setGruppi]  = useState<CommessaGroup[]>([]);
  const [assoc,   setAssoc]   = useState<ArticleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [nome,    setNome]    = useState('');
  const [code,    setCode]    = useState('');
  const [groupId, setGroupId] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [g, a] = await Promise.all([
      api.get<CommessaGroup[]>('/api/pack/commessa-groups').catch(() => []),
      api.get<ArticleGroup[]>('/api/pack/article-groups').catch(() => []),
    ]);
    setGruppi(g); setAssoc(a); setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true); setError('');
    try { await api.post('/api/pack/commessa-groups', { name: nome.trim() }); setNome(''); fetchAll(); }
    catch { setError('Errore aggiunta gruppo'); }
    finally { setSaving(false); }
  }

  async function delGroup(id: number, name: string) {
    if (!confirm(`Eliminare gruppo "${name}"? Gli articoli associati verranno scollegati.`)) return;
    await api.delete(`/api/pack/commessa-groups/${id}`).catch(() => setError('Errore eliminazione'));
    fetchAll();
  }

  async function mapArticle(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !groupId) return;
    setSaving(true); setError('');
    try { await api.post('/api/pack/article-group/map', { article_code: code.trim().toUpperCase(), group_id: Number(groupId) }); setCode(''); setGroupId(''); fetchAll(); }
    catch { setError('Errore associazione'); }
    finally { setSaving(false); }
  }

  async function unmapArticle(articleCode: string) {
    if (!confirm(`Rimuovere il gruppo per "${articleCode}"?`)) return;
    await api.delete(`/api/pack/article-group/${articleCode}`).catch(() => setError('Errore rimozione'));
    fetchAll();
  }

  async function processImportRows(rows: Record<string, string>[]): Promise<ImportResult> {
    // Fetch fresh list to build mutable map (handles groups created in this session)
    const freshGruppi = await api.get<CommessaGroup[]>('/api/pack/commessa-groups').catch(() => gruppi);
    const gruppoMap   = new Map(freshGruppi.map(g => [g.name.toLowerCase(), g.id]));
    let inserted = 0, skipped = 0, errors = 0;

    for (const row of rows) {
      const nomeGruppo = row['nome_gruppo']?.trim();
      const codiceArt  = row['codice_articolo']?.trim().toUpperCase() || null;
      if (!nomeGruppo) { skipped++; continue; }

      let gId = gruppoMap.get(nomeGruppo.toLowerCase());
      if (!gId) {
        try {
          const g = await api.post<{ id: number; name: string }>('/api/pack/commessa-groups', { name: nomeGruppo });
          gId = g.id;
          gruppoMap.set(nomeGruppo.toLowerCase(), gId);
        } catch { errors++; continue; }
      }

      if (codiceArt) {
        try {
          await api.post('/api/pack/article-group/map', { article_code: codiceArt, group_id: gId });
        } catch { errors++; continue; }
      }
      inserted++;
    }
    return { inserted, skipped, errors };
  }

  return (
    <div className="space-y-8">
      {/* Gestione gruppi */}
      <div>
        <h3 className="font-semibold text-gray-700 mb-3">Gruppi</h3>
        <form onSubmit={addGroup} className="flex gap-3 mb-4">
          <input className="input flex-1 max-w-xs" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome gruppo (es. Spoiler)..." />
          <button type="submit" disabled={saving || !nome.trim()} className="btn btn-primary">Aggiungi</button>
        </form>
        {loading ? <p className="text-gray-400 text-sm">Caricamento...</p> : gruppi.length === 0 ? (
          <p className="text-gray-400 text-sm">Nessun gruppo configurato.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {gruppi.map(g => (
              <span key={g.id} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 border border-gray-200 rounded-full px-3 py-1 text-sm">
                {g.name}
                <button onClick={() => delGroup(g.id, g.name)} className="text-gray-400 hover:text-red-500 font-bold leading-none ml-1">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Associazione articoli → gruppo */}
      <div>
        <h3 className="font-semibold text-gray-700 mb-3">Articoli → Gruppo</h3>
        <div className="flex items-start justify-between gap-4 mb-4">
          <form onSubmit={mapArticle} className="grid grid-cols-[1fr_200px_auto] gap-3 flex-1">
            <ArticleInput value={code} onChange={setCode} />
            <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)}>
              <option value="">Seleziona gruppo...</option>
              {gruppi.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="submit" disabled={saving || !code.trim() || !groupId} className="btn btn-primary">
              {saving ? '...' : 'Associa'}
            </button>
          </form>
          <ImportExcelButton
            columns={['nome_gruppo', 'codice_articolo']}
            processRows={processImportRows}
            onDone={fetchAll}
          />
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {!loading && assoc.length === 0 ? <p className="text-gray-400 text-sm">Nessun articolo associato a un gruppo.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 text-gray-500 text-left">
              <th className="py-2">Codice</th><th className="py-2">Descrizione</th><th className="py-2">Gruppo</th><th className="py-2 w-20"></th>
            </tr></thead>
            <tbody>
              {assoc.map(r => (
                <tr key={r.article_code} className="border-b border-gray-100">
                  <td className="py-2 font-mono">{r.article_code}</td>
                  <td className="py-2 text-gray-500">{r.description || '–'}</td>
                  <td className="py-2">
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 text-xs">{r.group_name}</span>
                  </td>
                  <td className="py-2 text-right">
                    <button className="text-xs text-red-500 hover:text-red-700" onClick={() => unmapArticle(r.article_code)}>Rimuovi</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

type Tab = 'operatori' | 'destinazioni' | 'articoli' | 'scatole' | 'pesi' | 'prezzi' | 'associazioni' | 'dest_articoli' | 'gruppi';

const TAB_LABELS: Record<Tab, string> = {
  operatori:    'Magazzinieri',
  destinazioni: 'Destinazioni',
  articoli:     'Articoli BC',
  scatole:      'Scatole',
  pesi:         'Pesi',
  prezzi:       'Prezzi',
  associazioni: 'Art. → Scatola',
  dest_articoli: 'Art. → Destinazioni',
  gruppi:        'Gruppi Commessa',
};

export default function PackingImpostazioniPage() {
  const [tab, setTab] = useState<Tab>('operatori');
  const [operatori,    setOperatori]    = useState<Voce[]>([]);
  const [destinazioni, setDestinazioni] = useState<Voce[]>([]);
  const [loadingOp,    setLoadingOp]    = useState(true);
  const [loadingDest,  setLoadingDest]  = useState(true);
  const [erroreOp,     setErroreOp]     = useState('');
  const [erroreDest,   setErroreDest]   = useState('');

  const fetchOperatori = useCallback(async () => {
    setLoadingOp(true);
    try { const data = await api.get<Voce[]>('/api/pack/operators'); setOperatori(data); }
    finally { setLoadingOp(false); }
  }, []);

  const fetchDestinazioni = useCallback(async () => {
    setLoadingDest(true);
    try { const data = await api.get<Voce[]>('/api/pack/dispatch-destinations'); setDestinazioni(data); }
    finally { setLoadingDest(false); }
  }, []);

  useEffect(() => { document.title = 'Impostazioni Packing — STR'; }, []);
  useEffect(() => { fetchOperatori(); fetchDestinazioni(); }, [fetchOperatori, fetchDestinazioni]);

  const aggiungiOperatore   = async (n: string) => { setErroreOp(''); try { await api.post('/api/pack/operators', { name: n }); fetchOperatori(); } catch { setErroreOp('Errore durante l\'aggiunta.'); } };
  const eliminaOperatore    = async (id: number) => { setErroreOp(''); try { await api.delete(`/api/pack/operators/${id}`); setOperatori(p => p.filter(o => o.id !== id)); } catch { setErroreOp('Errore durante l\'eliminazione.'); } };
  const aggiungiDestinazione = async (n: string) => { setErroreDest(''); try { await api.post('/api/pack/dispatch-destinations', { name: n }); fetchDestinazioni(); } catch { setErroreDest('Errore durante l\'aggiunta.'); } };
  const eliminaDestinazione  = async (id: number) => { setErroreDest(''); try { await api.delete(`/api/pack/dispatch-destinations/${id}`); setDestinazioni(p => p.filter(d => d.id !== id)); } catch { setErroreDest('Errore durante l\'eliminazione.'); } };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Impostazioni Packing</h1>
        <p className="mt-1 text-gray-500">Gestisci magazzinieri, destinazioni, scatole, pesi e prezzi</p>
      </div>

      <div className="card max-w-4xl mx-auto">
        <div className="flex flex-wrap gap-0 border-b border-gray-200 mb-6">
          {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {tab === 'operatori'    && (
          <ListaVoce
            titolo="Magazziniere" voci={operatori} loading={loadingOp} errore={erroreOp}
            onAggiungi={aggiungiOperatore} onElimina={eliminaOperatore}
            importEndpoint="/api/pack/operators" importColumns={['nome']}
          />
        )}
        {tab === 'destinazioni' && (
          <ListaVoce
            titolo="Destinazione" voci={destinazioni} loading={loadingDest} errore={erroreDest}
            onAggiungi={aggiungiDestinazione} onElimina={eliminaDestinazione}
            importEndpoint="/api/pack/dispatch-destinations" importColumns={['nome']}
          />
        )}
        {tab === 'articoli'     && <SyncSection />}
        {tab === 'scatole'      && <ScatoleSection />}
        {tab === 'pesi'         && <PesiSection />}
        {tab === 'prezzi'       && <PrezziSection />}
        {tab === 'associazioni'  && <AssociazioniSection />}
        {tab === 'dest_articoli' && <ArticoloDestinazioniSection />}
        {tab === 'gruppi'        && <GruppiSection />}
      </div>
    </div>
  );
}
