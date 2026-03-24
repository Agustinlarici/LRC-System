'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import type { BufferLinea } from '@/types';

type Combo = { modello: string; componente: string };

const EMPTY_FORM = {
  nome: '', fasi: [] as string[],
  soglia_verde: 10, soglia_giallo: 5, combos: [] as Combo[],
};

export default function BufferImpostazioniPage() {
  const toast = useToast();
  const [linee, setLinee]           = useState<BufferLinea[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);
  const [allFasi, setAllFasi]       = useState<string[]>([]);
  const [fasiLoaded, setFasiLoaded] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [newCombo, setNewCombo]     = useState<Combo>({ modello: '', componente: '' });
  const [modelli, setModelli]       = useState<Combo[]>([]);

  useEffect(() => { document.title = 'Impostazioni Buffer — STR'; }, []);

  useEffect(() => {
    fetchLinee();
    api.get<string[]>('/api/buffer/fasi')
      .then(f => { setAllFasi(f); setFasiLoaded(true); })
      .catch(() => setFasiLoaded(true));
    api.get<Combo[]>('/api/buffer/modelli').then(setModelli).catch(() => {});
  }, []);

  async function fetchLinee() {
    setLoading(true);
    try {
      setLinee(await api.get<BufferLinea[]>('/api/buffer'));
    } catch {
      toast.error('Errore caricamento buffer');
    } finally {
      setLoading(false);
    }
  }

  function selectLinea(linea: BufferLinea) {
    setSelectedId(linea.id);
    setForm({
      nome:          linea.nome,
      fasi:          [...linea.fasi],
      soglia_verde:  linea.soglie.soglia_verde,
      soglia_giallo: linea.soglie.soglia_giallo,
      combos:        linea.combos.map(c => ({ modello: c.modello, componente: c.componente })),
    });
  }

  function resetForm() { setSelectedId(null); setForm(EMPTY_FORM); }

  function toggleFase(fase: string) {
    setForm(p => ({
      ...p,
      fasi: p.fasi.includes(fase) ? p.fasi.filter(f => f !== fase) : [...p.fasi, fase],
    }));
  }

  function addCombo() {
    if (!newCombo.modello.trim() || !newCombo.componente.trim()) return;
    setForm(p => ({ ...p, combos: [...p.combos, { modello: newCombo.modello.trim(), componente: newCombo.componente.trim() }] }));
    setNewCombo({ modello: '', componente: '' });
  }

  function removeCombo(idx: number) {
    setForm(p => ({ ...p, combos: p.combos.filter((_, i) => i !== idx) }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (form.fasi.length === 0) { toast.error('Seleziona almeno una fase'); return; }
    setSaving(true);
    try {
      if (selectedId) {
        await api.put(`/api/buffer/${selectedId}`, form);
        toast.success('Buffer aggiornato');
      } else {
        await api.post('/api/buffer', form);
        toast.success('Buffer aggiunto');
        resetForm();
      }
      await fetchLinee();
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, nome: string) {
    if (!confirm(`Eliminare il buffer "${nome}"?`)) return;
    try {
      await api.delete(`/api/buffer/${id}`);
      resetForm();
      await fetchLinee();
      toast.success(`Buffer "${nome}" eliminato`);
    } catch {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Impostazioni Buffer</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configura buffer, soglie colore e combinazioni</p>
        </div>
        <Link href="/buffer" className="btn-secondary text-sm">Torna ai buffer</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Form ── */}
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-700">
                {selectedId ? 'Modifica buffer' : 'Nuovo buffer'}
              </h2>
              {selectedId && (
                <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">+ Nuovo</button>
              )}
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="label">Nome buffer</label>
                <input className="input w-full" placeholder="es. Buffer Linea 1"
                  value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} required />
              </div>

              {/* Fasi — selezione multipla con checkbox */}
              <div>
                <label className="label">Fasi ({form.fasi.length} selezionate)</label>
                {!fasiLoaded ? (
                  <p className="text-xs text-gray-400 py-2">Caricamento fasi...</p>
                ) : allFasi.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                    {allFasi.map(fase => (
                      <label key={fase} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                        <input type="checkbox" checked={form.fasi.includes(fase)}
                          onChange={() => toggleFase(fase)} className="accent-blue-600" />
                        <span className="text-sm text-gray-700">{fase}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input flex-1 text-sm" placeholder="Scrivi una fase e premi +"
                      id="fase-manual"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { toggleFase(v); (e.target as HTMLInputElement).value = ''; } } }}
                    />
                    <button type="button" className="btn-secondary text-sm shrink-0"
                      onClick={() => { const el = document.getElementById('fase-manual') as HTMLInputElement; const v = el.value.trim(); if (v) { toggleFase(v); el.value = ''; } }}>+</button>
                  </div>
                )}
                {form.fasi.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {form.fasi.map(f => (
                      <span key={f} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                        {f}
                        <button type="button" onClick={() => toggleFase(f)} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Soglie */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">Soglia verde (min)</label>
                  <input type="number" className="input w-full" min={1} value={form.soglia_verde}
                    onChange={e => setForm(p => ({ ...p, soglia_verde: parseInt(e.target.value) || 1 }))} required />
                </div>
                <div className="flex-1">
                  <label className="label">Soglia giallo (min)</label>
                  <input type="number" className="input w-full" min={1} value={form.soglia_giallo}
                    onChange={e => setForm(p => ({ ...p, soglia_giallo: parseInt(e.target.value) || 1 }))} required />
                </div>
              </div>

              {/* Combos */}
              <div>
                <label className="label">Combinazioni Modello / Componente</label>
                <div className="flex gap-2 mb-2">
                  {modelli.length > 0 ? (
                    <select className="input flex-1 text-sm"
                      value={`${newCombo.modello}||${newCombo.componente}`}
                      onChange={e => {
                        const [m, comp] = e.target.value.split('||');
                        setNewCombo({ modello: m ?? '', componente: comp ?? '' });
                      }}>
                      <option value="||">Seleziona...</option>
                      {modelli.map((c, i) => (
                        <option key={i} value={`${c.modello}||${c.componente}`}>{c.modello} · {c.componente}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input className="input flex-1 text-sm" placeholder="Modello"
                        value={newCombo.modello} onChange={e => setNewCombo(p => ({ ...p, modello: e.target.value }))} />
                      <input className="input flex-1 text-sm" placeholder="Componente"
                        value={newCombo.componente} onChange={e => setNewCombo(p => ({ ...p, componente: e.target.value }))} />
                    </>
                  )}
                  <button type="button" onClick={addCombo} className="btn-secondary text-sm shrink-0">+</button>
                </div>
                {form.combos.length > 0 ? (
                  <ul className="space-y-1">
                    {form.combos.map((c, i) => (
                      <li key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                        <span><span className="font-medium">{c.modello}</span> · {c.componente}</span>
                        <button type="button" onClick={() => removeCombo(i)} className="text-red-400 hover:text-red-600 ml-2">×</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-2 bg-gray-50 rounded">Nessuna combinazione</p>
                )}
              </div>

              <button type="submit" className="btn-primary w-full" disabled={saving}>
                {saving ? 'Salvataggio...' : selectedId ? 'Aggiorna' : 'Aggiungi buffer'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Lista buffer ── */}
        <div className="lg:col-span-2">
          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-3">Buffer configurati</h2>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : linee.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nessun buffer ancora</p>
            ) : (
              <ul className="space-y-2">
                {linee.map(linea => (
                  <li key={linea.id}
                    className={`flex items-start justify-between px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                      selectedId === linea.id ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-transparent hover:border-gray-200'
                    }`}
                    onClick={() => selectLinea(linea)}
                  >
                    <div>
                      <span className="font-medium text-sm">{linea.nome}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {linea.fasi.length} {linea.fasi.length === 1 ? 'fase' : 'fasi'} · {linea.combos.length} combo
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {linea.fasi.map(f => (
                          <span key={f} className="text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">{f}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={ev => { ev.stopPropagation(); handleDelete(linea.id, linea.nome); }}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 shrink-0 ml-2"
                    >
                      Elimina
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
