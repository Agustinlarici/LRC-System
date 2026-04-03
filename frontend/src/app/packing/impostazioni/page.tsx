'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

// ─── BC Sync ──────────────────────────────────────────────────────────────────

function SyncSection() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ inserted: number; bc_total: number; existing_in_pg: number } | null>(null);
  const [error,   setError]   = useState('');

  async function runSync() {
    if (!confirm('Sincronizzare gli articoli da Business Central?')) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await api.post<{ ok: boolean; inserted: number; bc_total: number; existing_in_pg: number; error?: string }>(
        '/api/pack/articles/sync-from-bc'
      );
      if (!data.ok) throw new Error(data.error || 'Errore sconosciuto');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  }

  return (
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
  );
}

// ─── Lista generica nome ──────────────────────────────────────────────────────

interface Voce { id: number; name: string; }

function ListaVoce({ titolo, voci, loading, errore, onAggiungi, onElimina }: {
  titolo: string; voci: Voce[]; loading: boolean; errore: string;
  onAggiungi: (nome: string) => Promise<void>; onElimina: (id: number) => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [invio, setInvio] = useState(false);
  const handleAggiungi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setInvio(true); await onAggiungi(nome.trim()); setNome(''); setInvio(false);
  };
  return (
    <div>
      <form onSubmit={handleAggiungi} className="flex gap-2 mb-4">
        <input className="input flex-1 max-w-xs" value={nome} onChange={e => setNome(e.target.value)} placeholder={`Nuovo ${titolo.toLowerCase()}...`} />
        <button type="submit" className="btn btn-primary" disabled={invio || !nome.trim()}>{invio ? '...' : '+ Aggiungi'}</button>
      </form>
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
      <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
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

  return (
    <div>
      <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_180px_auto] gap-3 mb-4">
        <ArticleInput value={code} onChange={setCode} />
        <input className="input" type="number" step="0.0001" placeholder="Peso unitario (kg)" value={weight} onChange={e => setWeight(e.target.value)} />
        <button type="submit" disabled={saving || !code.trim() || !weight} className="btn btn-primary">
          {saving ? '...' : 'Salva'}
        </button>
      </form>
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

  return (
    <div>
      <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_180px_auto] gap-3 mb-4">
        <ArticleInput value={code} onChange={setCode} />
        <input className="input" type="number" step="0.0001" placeholder="Prezzo EUR" value={cost} onChange={e => setCost(e.target.value)} />
        <button type="submit" disabled={saving || !code.trim() || !cost} className="btn btn-primary">
          {saving ? '...' : 'Salva'}
        </button>
      </form>
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

  return (
    <div>
      <form onSubmit={save} className="grid grid-cols-[1fr_200px_auto] gap-3 mb-4">
        <ArticleInput value={code} onChange={setCode} />
        <select className="input" value={contId} onChange={e => setContId(e.target.value)}>
          <option value="">Seleziona scatola...</option>
          {containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" disabled={saving || !code.trim() || !contId} className="btn btn-primary">
          {saving ? '...' : 'Associa'}
        </button>
      </form>
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

  // Group rules by article
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
      <form onSubmit={save} className="grid grid-cols-[minmax(0,400px)_200px_auto] gap-3 mb-4">
        <ArticleInput value={code} onChange={setCode} />
        <select className="input" value={destId} onChange={e => setDestId(e.target.value)}>
          <option value="">Seleziona destinazione...</option>
          {dests.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="submit" disabled={saving || !code.trim() || !destId} className="btn btn-primary">
          {saving ? '...' : 'Aggiungi'}
        </button>
      </form>
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

// ─── Pagina principale ────────────────────────────────────────────────────────

type Tab = 'operatori' | 'destinazioni' | 'articoli' | 'scatole' | 'pesi' | 'prezzi' | 'associazioni' | 'dest_articoli';

const TAB_LABELS: Record<Tab, string> = {
  operatori:    'Magazzinieri',
  destinazioni: 'Destinazioni',
  articoli:     'Articoli BC',
  scatole:      'Scatole',
  pesi:         'Pesi',
  prezzi:       'Prezzi',
  associazioni: 'Art. → Scatola',
  dest_articoli: 'Art. → Destinazioni',
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

        {tab === 'operatori'    && <ListaVoce titolo="Magazziniere" voci={operatori}    loading={loadingOp}   errore={erroreOp}   onAggiungi={aggiungiOperatore}   onElimina={eliminaOperatore} />}
        {tab === 'destinazioni' && <ListaVoce titolo="Destinazione" voci={destinazioni} loading={loadingDest} errore={erroreDest} onAggiungi={aggiungiDestinazione} onElimina={eliminaDestinazione} />}
        {tab === 'articoli'     && <SyncSection />}
        {tab === 'scatole'      && <ScatoleSection />}
        {tab === 'pesi'         && <PesiSection />}
        {tab === 'prezzi'       && <PrezziSection />}
        {tab === 'associazioni'  && <AssociazioniSection />}
        {tab === 'dest_articoli' && <ArticoloDestinazioniSection />}
      </div>
    </div>
  );
}
