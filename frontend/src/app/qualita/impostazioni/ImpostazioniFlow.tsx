'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { QualitaComponent } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const emptyForm = { name: '', code: '', sort_order: '0' };

function Thumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-12 h-12 flex items-center justify-center border border-gray-200 rounded bg-gray-50 text-gray-300">
        🖼️
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="w-12 h-12 object-contain border border-gray-200 rounded bg-white"
    />
  );
}

export function ImpostazioniFlow() {
  const [components, setComponents] = useState<QualitaComponent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  const [form, setForm]     = useState(emptyForm);
  const [image, setImage]   = useState<File | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchComponents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/qualita/components`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      setComponents(await res.json());
    } catch {
      setError('Errore nel caricamento del catalogo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchComponents(); }, [fetchComponents]);

  function startEdit(c: QualitaComponent) {
    setEditId(c.id);
    setForm({ name: c.name, code: c.code ?? '', sort_order: String(c.sort_order) });
    setImage(null);
    setWarning('');
  }

  function resetForm() {
    setEditId(null);
    setForm(emptyForm);
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!editId && !image) { setError('Immagine richiesta per un nuovo componente'); return; }

    setSaving(true); setError(''); setWarning('');
    try {
      const body = new FormData();
      body.append('name', form.name.trim());
      if (form.code.trim()) body.append('code', form.code.trim());
      body.append('sort_order', form.sort_order || '0');
      if (image) body.append('image', image);

      const url    = editId ? `${BACKEND}/api/qualita/components/${editId}` : `${BACKEND}/api/qualita/components`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, body, credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Errore durante il salvataggio');
      }
      const saved = await res.json();
      if (saved.warning) setWarning(saved.warning);
      resetForm();
      fetchComponents();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: QualitaComponent) {
    setError('');
    try {
      const body = new FormData();
      body.append('is_active', String(!c.is_active));
      const res = await fetch(`${BACKEND}/api/qualita/components/${c.id}`, { method: 'PATCH', body, credentials: 'include' });
      if (!res.ok) throw new Error();
      fetchComponents();
    } catch {
      setError('Errore aggiornamento stato');
    }
  }

  return (
    <div className="card max-w-4xl mx-auto">
      <h2 className="font-semibold text-gray-700 mb-3">{editId ? 'Modifica componente' : 'Nuovo componente'}</h2>

      {error   && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-3">{error}</p>}
      {warning && <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-3">{warning}</p>}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_160px_100px_auto] gap-3 items-start mb-8">
        <input className="input" placeholder="Nome (es. Capot 167)" value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <input className="input" placeholder="Codice (opzionale)" value={form.code}
          onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
        <input className="input" type="number" placeholder="Ordine" value={form.sort_order}
          onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !form.name.trim()} className="btn btn-primary whitespace-nowrap">
            {saving ? '...' : editId ? 'Aggiorna' : '+ Aggiungi'}
          </button>
          {editId && <button type="button" className="btn" onClick={resetForm}>Annulla</button>}
        </div>
        <div className="md:col-span-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={e => setImage(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-xs text-gray-400 mt-1">
            {editId ? 'Lascia vuoto per mantenere l\'immagine attuale — PNG o JPG' : 'Immagine di riferimento richiesta — PNG o JPG'}
          </p>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400">Caricamento...</p>
      ) : components.length === 0 ? (
        <p className="text-sm text-gray-400">Nessun componente configurato.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 text-gray-500">
              <th className="pb-2 w-16"></th>
              <th className="pb-2 font-medium">Nome</th>
              <th className="pb-2 font-medium">Codice</th>
              <th className="pb-2 font-medium w-20">Ordine</th>
              <th className="pb-2 font-medium w-24">Stato</th>
              <th className="pb-2 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {components.map(c => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="py-2">
                  <Thumb src={`${BACKEND}/api/qualita/components/${c.id}/image`} alt={c.name} />
                </td>
                <td className="py-2 font-medium text-gray-800">{c.name}</td>
                <td className="py-2 text-gray-500">{c.code || '–'}</td>
                <td className="py-2 text-gray-500">{c.sort_order}</td>
                <td className="py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.is_active ? 'Attivo' : 'Disattivato'}
                  </span>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="text-xs text-blue-500 hover:text-blue-700 mr-3" onClick={() => startEdit(c)}>Modifica</button>
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={() => toggleActive(c)}>
                    {c.is_active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
