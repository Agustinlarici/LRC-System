'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { StopCategory, StopReason } from '@/types';

const COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280','#1d4ed8',
];

function ColorDot({ color }: { color: string }) {
  return <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />;
}

// ─── Gestione Categorie ───────────────────────────────────────────────────────

function CategoriePanel({ onReload }: { onReload: () => void }) {
  const [categorie,  setCategorie]  = useState<StopCategory[]>([]);
  const [editId,     setEditId]     = useState<number | 'new' | null>(null);
  const [nome,       setNome]       = useState('');
  const [colore,     setColore]     = useState(COLORS[0]);
  const [ordine,     setOrdine]     = useState(0);
  const [saving,     setSaving]     = useState(false);

  async function load() {
    const d = await api.get<{ categorie: StopCategory[]; motivi: StopReason[] }>('/api/monitor/motivi/admin');
    setCategorie(d.categorie);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditId('new'); setNome(''); setColore(COLORS[0]); setOrdine(0);
  }
  function openEdit(c: StopCategory) {
    setEditId(c.id); setNome(c.nome); setColore(c.colore); setOrdine(c.ordine);
  }
  function cancel() { setEditId(null); }

  async function save() {
    if (!nome.trim()) return;
    setSaving(true);
    try {
      if (editId === 'new') {
        await api.post('/api/monitor/motivi/categorie', { nome, colore, ordine });
      } else {
        await api.put(`/api/monitor/motivi/categorie/${editId}`, { nome, colore, ordine });
      }
      setEditId(null); await load(); onReload();
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questa categoria? I motivi associati perderanno la categoria.')) return;
    await api.delete(`/api/monitor/motivi/categorie/${id}`);
    await load(); onReload();
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Categorie</h2>
        <button onClick={openNew} className="btn-primary text-sm">+ Nuova</button>
      </div>

      {editId !== null && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="label">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="input w-full" placeholder="Es. Logistica" />
          </div>
          <div>
            <label className="label">Colore</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColore(c)}
                  className={`w-7 h-7 rounded-full transition-all ${colore === c ? 'ring-2 ring-offset-2 ring-gray-600 scale-110' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div>
            <label className="label">Ordine</label>
            <input type="number" value={ordine} onChange={e => setOrdine(Number(e.target.value))}
              className="input w-24" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
            <button onClick={cancel} className="btn-secondary text-sm">Annulla</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {categorie.map(cat => (
          <div key={cat.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
            <div className="flex items-center gap-3">
              <ColorDot color={cat.colore} />
              <span className="font-medium text-gray-800">{cat.nome}</span>
              <span className="text-xs text-gray-400">ordine {cat.ordine}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(cat)} className="text-sm text-blue-600 hover:text-blue-800">Modifica</button>
              <button onClick={() => del(cat.id)}   className="text-sm text-red-500 hover:text-red-700">Elimina</button>
            </div>
          </div>
        ))}
        {categorie.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nessuna categoria</p>}
      </div>
    </div>
  );
}

// ─── Gestione Motivi ──────────────────────────────────────────────────────────

function MotiviPanel({ categorie }: { categorie: StopCategory[] }) {
  const [motivi,  setMotivi]  = useState<StopReason[]>([]);
  const [editId,  setEditId]  = useState<number | 'new' | null>(null);
  const [desc,    setDesc]    = useState('');
  const [catId,   setCatId]   = useState<number | null>(null);
  const [ordine,  setOrdine]  = useState(0);
  const [saving,  setSaving]  = useState(false);

  async function load() {
    const d = await api.get<{ categorie: StopCategory[]; motivi: StopReason[] }>('/api/monitor/motivi/admin');
    setMotivi(d.motivi);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [categorie.length]);

  function openNew() { setEditId('new'); setDesc(''); setCatId(null); setOrdine(0); }
  function openEdit(r: StopReason) { setEditId(r.id); setDesc(r.descrizione); setCatId(r.category_id); setOrdine(r.ordine); }
  function cancel() { setEditId(null); }

  async function save() {
    if (!desc.trim()) return;
    setSaving(true);
    try {
      if (editId === 'new') {
        await api.post('/api/monitor/motivi/reasons', { category_id: catId, descrizione: desc, ordine });
      } else {
        await api.put(`/api/monitor/motivi/reasons/${editId}`, { category_id: catId, descrizione: desc, ordine });
      }
      setEditId(null); await load();
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questo motivo?')) return;
    await api.delete(`/api/monitor/motivi/reasons/${id}`);
    await load();
  }

  // Group by category
  const grouped = new Map<string, StopReason[]>();
  for (const m of motivi) {
    const key = m.categoria_nome ?? '(senza categoria)';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Motivi</h2>
        <button onClick={openNew} className="btn-primary text-sm">+ Nuovo</button>
      </div>

      {editId !== null && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="label">Descrizione</label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              className="input w-full" placeholder="Es. Attesa materiale" />
          </div>
          <div>
            <label className="label">Categoria</label>
            <select value={catId ?? ''} onChange={e => setCatId(e.target.value ? Number(e.target.value) : null)}
              className="input w-full">
              <option value="">— Nessuna —</option>
              {categorie.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ordine</label>
            <input type="number" value={ordine} onChange={e => setOrdine(Number(e.target.value))}
              className="input w-24" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
            <button onClick={cancel} className="btn-secondary text-sm">Annulla</button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {[...grouped.entries()].map(([catName, items]) => {
          const cat = categorie.find(c => c.nome === catName);
          return (
            <div key={catName}>
              <div className="flex items-center gap-2 mb-1">
                {cat && <ColorDot color={cat.colore} />}
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{catName}</span>
              </div>
              <div className="space-y-1 pl-5">
                {items.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-1.5 px-3 rounded bg-gray-50">
                    <span className="text-sm text-gray-700">{m.descrizione}</span>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(m)} className="text-xs text-blue-600 hover:text-blue-800">Modifica</button>
                      <button onClick={() => del(m.id)}   className="text-xs text-red-500 hover:text-red-700">Elimina</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {motivi.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nessun motivo configurato</p>}
      </div>
    </div>
  );
}

// ─── Pagina ───────────────────────────────────────────────────────────────────

export default function MotiviPage() {
  const [categorie, setCategorie] = useState<StopCategory[]>([]);

  useEffect(() => { document.title = 'Motivi fermate — STR'; }, []);

  async function reloadCategorie() {
    const d = await api.get<{ categorie: StopCategory[] }>('/api/monitor/motivi/admin');
    setCategorie(d.categorie);
  }
  useEffect(() => { reloadCategorie(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Motivi fermate</h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoriePanel onReload={reloadCategorie} />
        <MotiviPanel    categorie={categorie} />
      </div>
    </div>
  );
}
