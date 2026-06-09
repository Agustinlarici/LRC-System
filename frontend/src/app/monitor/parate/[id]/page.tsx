'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { StopEvent, StopReason, StopCategory } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec: number | null) {
  if (sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function isOpen(e: StopEvent) { return e.ended_at === null; }

// ─── Riga fermata (tutto visibile, nessun expand) ─────────────────────────────

function StopRow({
  event, categories, reasons, onSaved,
}: {
  event:      StopEvent;
  categories: StopCategory[];
  reasons:    StopReason[];
  onSaved:    () => void;
}) {
  const open = isOpen(event);

  const initCatId = event.reason_id
    ? (reasons.find(r => r.id === event.reason_id)?.category_id ?? null)
    : null;

  const [catId,     setCatId]     = useState<number | null>(initCatId);
  const [reasonId,  setReasonId]  = useState<number | null>(event.reason_id);
  const [note,      setNote]      = useState(event.note ?? '');
  const [operatore, setOperatore] = useState(event.operatore ?? '');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const filteredReasons = catId ? reasons.filter(r => r.category_id === catId) : reasons;
  const borderColor = open ? '#ef4444' : event.reason_id ? '#22c55e' : '#f59e0b';

  async function save() {
    if (!operatore.trim()) { setError('Inserisci il tuo nome'); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/api/monitor/parate/${event.id}/motivo`, {
        reason_id: reasonId,
        note:      note.trim() || null,
        operatore: operatore.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch { setError('Errore salvataggio'); }
    finally  { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"
      style={{ borderLeft: `5px solid ${borderColor}` }}>
      <div className="grid grid-cols-[200px_1fr] divide-x divide-gray-100">

        {/* ── Colonna sinistra: info fermata ── */}
        <div className="p-5 flex flex-col justify-center gap-3">
          <div>
            <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full ${
              open ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {open ? '● In corso' : 'Terminata'}
            </span>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-gray-800">
              {fmtTime(event.started_at)}
            </p>
            {event.ended_at
              ? <p className="text-sm text-gray-500">→ {fmtTime(event.ended_at)}</p>
              : <p className="text-sm text-gray-400">→ ora</p>
            }
          </div>
          <p className={`text-xl font-mono font-semibold ${open ? 'text-red-500' : 'text-gray-600'}`}>
            {fmtDuration(event.duration_sec)}
          </p>
        </div>

        {/* ── Colonna destra: form sempre visibile ── */}
        <div className="p-5 space-y-4">

          {/* Categoria */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Categoria</p>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button key={cat.id}
                  onClick={() => { setCatId(cat.id); setReasonId(null); }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border-2"
                  style={catId === cat.id
                    ? { background: cat.colore, color: '#fff', borderColor: cat.colore }
                    : { background: '#f9fafb', color: '#374151', borderColor: '#e5e7eb' }}>
                  {cat.nome}
                </button>
              ))}
              {catId !== null && (
                <button onClick={() => { setCatId(null); setReasonId(null); }}
                  className="px-3 py-1.5 rounded-lg text-sm border-2 bg-white text-gray-400 border-gray-200 hover:border-gray-400">
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Motivo</p>
            <div className="flex flex-wrap gap-2">
              {filteredReasons.map(r => (
                <button key={r.id} onClick={() => setReasonId(r.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all ${
                    reasonId === r.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}>
                  {r.descrizione}
                </button>
              ))}
              {filteredReasons.length === 0 && (
                <span className="text-sm text-gray-300 italic">Seleziona una categoria</span>
              )}
            </div>
          </div>

          {/* Note + Nome + Salva */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Note</p>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Note opzionali..." />
            </div>
            <div className="w-44">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Nome *</p>
              <input type="text" value={operatore} onChange={e => setOperatore(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Tuo nome" />
            </div>
            <div className="shrink-0">
              {error && <p className="text-red-500 text-xs mb-1">{error}</p>}
              <button onClick={save} disabled={saving}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 ${
                  saved
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}>
                {saved ? '✓ Salvato' : saving ? '...' : 'Salva'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export default function ParatePage() {
  const params  = useParams();
  const lineaId = params.id as string;

  const [lineaNome,   setLineaNome]   = useState('');
  const [stops,       setStops]       = useState<StopEvent[]>([]);
  const [categories,  setCategories]  = useState<StopCategory[]>([]);
  const [reasons,     setReasons]     = useState<StopReason[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [opening,     setOpening]     = useState(false);

  useEffect(() => { document.title = 'Fermate — STR'; }, []);

  const loadMotivi = useCallback(async () => {
    const data = await api.get<{ categorie: StopCategory[]; motivi: StopReason[] }>('/api/monitor/motivi');
    setCategories(data.categorie);
    setReasons(data.motivi);
  }, []);

  const loadStops = useCallback(async () => {
    try {
      const data = await api.get<{ linea: { nome: string }; stops: StopEvent[] }>(
        `/api/monitor/parate/${lineaId}`,
      );
      setLineaNome(data.linea.nome);
      setStops(data.stops);
      setLastRefresh(new Date());
      setError(null);
    } catch { setError('Errore caricamento fermate'); }
  }, [lineaId]);

  useEffect(() => {
    Promise.all([loadMotivi(), loadStops()]).finally(() => setLoading(false));
    const interval = setInterval(loadStops, 30_000);
    return () => clearInterval(interval);
  }, [loadMotivi, loadStops]);

  async function apriManuale() {
    setOpening(true);
    try {
      await api.post(`/api/monitor/parate/${lineaId}/apri`, {});
      await loadStops();
    } finally { setOpening(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400 text-lg">Caricamento...</p>
    </div>
  );

  const openStops   = stops.filter(isOpen);
  const closedStops = stops.filter(e => !isOpen(e));

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fermate — {lineaNome}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Aggiornato alle {lastRefresh.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadStops}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium px-3 py-1.5 border border-gray-200 rounded-lg">
              Aggiorna
            </button>
            <button onClick={apriManuale} disabled={opening}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition-colors shadow-sm">
              <span className="text-base leading-none">⏹</span>
              {opening ? 'Apertura...' : 'Segna linea ferma'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {error && <p className="text-red-500 text-center">{error}</p>}

        {openStops.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs font-bold text-red-500 uppercase tracking-widest">In corso</p>
            {openStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}
          </section>
        )}

        {closedStops.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Storico oggi</p>
            {closedStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}
          </section>
        )}

        {stops.length === 0 && !error && (
          <div className="text-center py-24 text-gray-400">
            <p className="text-5xl mb-4">✓</p>
            <p className="text-lg font-medium text-gray-500">Nessuna fermata nelle ultime 24 ore</p>
          </div>
        )}
      </div>
    </div>
  );
}
