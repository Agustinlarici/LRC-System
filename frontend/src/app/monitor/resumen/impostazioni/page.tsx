'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import type { MonitorLinea, MonitorResumen, MonitorResumenLinea } from '@/types';

export default function ResumenImpostazioniPage() {
  const toast = useToast();

  const [gruppi, setGruppi]       = useState<MonitorResumen[]>([]);
  const [lineeDisp, setLineeDisp] = useState<MonitorLinea[]>([]);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [lineeGruppo, setLineeGruppo] = useState<number[]>([]);
  const [loading, setLoading]         = useState(true);
  const [savingLinee, setSavingLinee] = useState(false);

  // Form nuovo gruppo
  const [nomeForm, setNomeForm]   = useState('');
  const [savingNew, setSavingNew] = useState(false);

  // Modalità rename
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [editNome, setEditNome]       = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);

  useEffect(() => { document.title = 'Impostazioni Riepilogo — STR'; }, []);

  useEffect(() => {
    Promise.all([
      api.get<MonitorResumen[]>('/api/monitor/resumen'),
      api.get<MonitorLinea[]>('/api/monitor/linee'),
    ]).then(([g, l]) => {
      setGruppi(g);
      setLineeDisp(l.filter(ll => ll.attivo));
    }).catch(() => {
      toast.error('Errore caricamento dati');
    }).finally(() => setLoading(false));
  }, []);

  async function reloadGruppi() {
    const g = await api.get<MonitorResumen[]>('/api/monitor/resumen');
    setGruppi(g);
  }

  async function selectGruppo(id: number) {
    setSelectedId(id);
    try {
      const data = await api.get<{ linee: MonitorResumenLinea[] }>(`/api/monitor/resumen/${id}`);
      setLineeGruppo(data.linee.map(l => l.linea_id));
    } catch {
      toast.error('Errore caricamento linee');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeForm.trim()) return;
    setSavingNew(true);
    try {
      await api.post('/api/monitor/resumen', { nome: nomeForm.trim() });
      setNomeForm('');
      await reloadGruppi();
      toast.success('Gruppo creato');
    } catch {
      toast.error('Errore durante la creazione');
    } finally {
      setSavingNew(false);
    }
  }

  async function handleRename(id: number) {
    if (!editNome.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch(`/api/monitor/resumen/${id}`, { nome: editNome.trim() });
      setEditingId(null);
      await reloadGruppi();
      toast.success('Nome aggiornato');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: number, nome: string) {
    if (!confirm(`Eliminare il gruppo "${nome}"?`)) return;
    try {
      await api.delete(`/api/monitor/resumen/${id}`);
      if (selectedId === id) { setSelectedId(null); setLineeGruppo([]); }
      await reloadGruppi();
      toast.success(`Gruppo "${nome}" eliminato`);
    } catch {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  function toggleLinea(lineaId: number) {
    setLineeGruppo(prev =>
      prev.includes(lineaId) ? prev.filter(id => id !== lineaId) : [...prev, lineaId]
    );
  }

  async function saveLinee() {
    if (selectedId === null) return;
    setSavingLinee(true);
    try {
      await api.put(`/api/monitor/resumen/${selectedId}/linee`, { linea_ids: lineeGruppo });
      await reloadGruppi();
      toast.success('Linee salvate');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSavingLinee(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Impostazioni Riepilogo</h1>
          <p className="text-sm text-gray-500 mt-1">Configura i gruppi di monitor da visualizzare insieme</p>
        </div>
        <Link href="/monitor/resumen" className="btn-secondary">← Torna al riepilogo</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Colonna sinistra: lista gruppi ─────────────────────────────────── */}
        <div className="space-y-4">

          {/* Form nuovo gruppo */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-3">Nuovo gruppo</h2>
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={nomeForm}
                onChange={e => setNomeForm(e.target.value)}
                placeholder="Nome del gruppo..."
                className="input flex-1"
                required
              />
              <button type="submit" disabled={savingNew} className="btn-primary">
                {savingNew ? 'Creazione...' : 'Crea'}
              </button>
            </form>
          </div>

          {/* Lista gruppi */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-3">Gruppi esistenti</h2>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : gruppi.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nessun gruppo creato</p>
            ) : (
              <div className="space-y-2">
                {gruppi.map(g => (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors
                      ${selectedId === g.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'}`}
                    onClick={() => { if (editingId !== g.id) selectGruppo(g.id); }}
                  >
                    <div className="flex-1 min-w-0">
                      {editingId === g.id ? (
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            type="text"
                            value={editNome}
                            onChange={e => setEditNome(e.target.value)}
                            className="input flex-1 py-1 text-sm"
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(g.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button
                            disabled={savingEdit}
                            onClick={() => handleRename(g.id)}
                            className="btn-primary py-1 px-2 text-xs"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="btn-secondary py-1 px-2 text-xs"
                          >
                            Annulla
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="font-medium text-gray-800 truncate">{g.nome}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {g.linea_count} {g.linea_count === 1 ? 'linea' : 'linee'}
                          </p>
                        </>
                      )}
                    </div>
                    {editingId !== g.id && (
                      <div className="flex gap-1 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          title="Rinomina"
                          onClick={() => { setEditingId(g.id); setEditNome(g.nome); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          title="Elimina"
                          onClick={() => handleDelete(g.id, g.nome)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Colonna destra: selezione linee ────────────────────────────────── */}
        <div className="card">
          {selectedId === null ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">←</div>
              <p className="text-sm">Seleziona un gruppo per configurare le linee</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-700">
                  Linee — {gruppi.find(g => g.id === selectedId)?.nome}
                </h2>
                <span className="text-xs text-gray-500">
                  {lineeGruppo.length} selezionate
                </span>
              </div>

              {lineeDisp.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  Nessuna linea attiva disponibile
                </p>
              ) : (
                <div className="space-y-2 mb-4">
                  {lineeDisp.map(linea => {
                    const selected = lineeGruppo.includes(linea.id);
                    return (
                      <label
                        key={linea.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                          ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleLinea(linea.id)}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{linea.nome}</p>
                          {linea.fase && (
                            <p className="text-xs text-gray-500">{linea.fase}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <button
                onClick={saveLinee}
                disabled={savingLinee}
                className="btn-primary w-full"
              >
                {savingLinee ? 'Salvataggio...' : 'Salva selezione'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
