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

// ─── Form registrazione motivo ────────────────────────────────────────────────

function MotivoForm({
  event, categories, reasons, onSaved,
}: {
  event:      StopEvent;
  categories: StopCategory[];
  reasons:    StopReason[];
  onSaved:    () => void;
}) {
  const [catId,     setCatId]     = useState<number | null>(null);
  const [reasonId,  setReasonId]  = useState<number | null>(event.reason_id);
  const [note,      setNote]      = useState(event.note ?? '');
  const [operatore, setOperatore] = useState(event.operatore ?? '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Pre-select category based on existing reason
  useEffect(() => {
    if (event.reason_id) {
      const r = reasons.find(r => r.id === event.reason_id);
      if (r) setCatId(r.category_id);
    }
  }, [event.reason_id, reasons]);

  const filteredReasons = catId
    ? reasons.filter(r => r.category_id === catId)
    : reasons;

  async function save() {
    if (!operatore.trim()) { setError('Inserisci il tuo nome'); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/api/monitor/parate/${event.id}/motivo`, {
        reason_id: reasonId,
        note:      note.trim() || null,
        operatore: operatore.trim(),
      });
      onSaved();
    } catch { setError('Errore salvataggio'); }
    finally  { setSaving(false); }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">

      {/* Categoria */}
      <div>
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Categoria</p>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setCatId(cat.id); setReasonId(null); }}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all border-2"
              style={catId === cat.id
                ? { background: cat.colore, color: '#fff', borderColor: cat.colore }
                : { background: '#f9fafb', color: '#374151', borderColor: '#e5e7eb' }}
            >
              {cat.nome}
            </button>
          ))}
          <button
            onClick={() => { setCatId(null); setReasonId(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${catId === null ? 'bg-gray-700 text-white border-gray-700' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
          >
            Tutte
          </button>
        </div>
      </div>

      {/* Motivo */}
      <div>
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Motivo</p>
        <div className="flex flex-wrap gap-2">
          {filteredReasons.map(r => (
            <button
              key={r.id}
              onClick={() => setReasonId(r.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                reasonId === r.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-blue-300'
              }`}
            >
              {r.descrizione}
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <div>
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Note (opzionale)</p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Dettagli aggiuntivi..."
        />
      </div>

      {/* Nome operatore */}
      <div>
        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Il tuo nome *</p>
        <input
          type="text"
          value={operatore}
          onChange={e => setOperatore(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Nome e cognome"
        />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-base disabled:opacity-50 transition-colors"
      >
        {saving ? 'Salvataggio...' : 'Salva'}
      </button>
    </div>
  );
}

// ─── Card fermata ─────────────────────────────────────────────────────────────

function StopCard({
  event, categories, reasons, onSaved,
}: {
  event:      StopEvent;
  categories: StopCategory[];
  reasons:    StopReason[];
  onSaved:    () => void;
}) {
  const [expanded, setExpanded] = useState(isOpen(event) && !event.reason_id);

  const open     = isOpen(event);
  const hasMotivo = !!event.reason_id;

  return (
    <div className={`rounded-xl border-2 p-4 transition-all ${
      open
        ? 'border-red-400 bg-red-50'
        : hasMotivo
          ? 'border-green-300 bg-green-50'
          : 'border-yellow-300 bg-yellow-50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
              open ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'
            }`}>
              {open ? 'In corso' : 'Terminata'}
            </span>
            {hasMotivo && (
              <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                Motivo registrato
              </span>
            )}
          </div>
          <p className="font-semibold text-gray-800">
            {fmtTime(event.started_at)}
            {event.ended_at && ` → ${fmtTime(event.ended_at)}`}
            <span className="ml-2 text-gray-500 font-normal text-sm">({fmtDuration(event.duration_sec)})</span>
          </p>
          {hasMotivo && (
            <p className="text-sm text-gray-600 mt-0.5">
              {event.categoria_nome && <span className="font-medium">{event.categoria_nome} · </span>}
              {event.reason_descrizione}
              {event.operatore && <span className="text-gray-400"> — {event.operatore}</span>}
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          {expanded ? 'Chiudi' : hasMotivo ? 'Modifica' : 'Registra motivo'}
        </button>
      </div>

      {expanded && (
        <MotivoForm
          event={event}
          categories={categories}
          reasons={reasons}
          onSaved={() => { setExpanded(false); onSaved(); }}
        />
      )}
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

  useEffect(() => { document.title = 'Parate — STR'; }, []);

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

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-lg">Caricamento...</p>
    </div>
  );

  const openStops   = stops.filter(isOpen);
  const closedStops = stops.filter(e => !isOpen(e));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Fermate — {lineaNome}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Aggiornato: {lastRefresh.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
          <button onClick={loadStops} className="text-sm text-blue-600 font-medium">Aggiorna</button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && <p className="text-red-500 text-center">{error}</p>}

        {/* Fermate aperte */}
        {openStops.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3">In corso</h2>
            <div className="space-y-3">
              {openStops.map(e => (
                <StopCard key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
              ))}
            </div>
          </section>
        )}

        {/* Fermate chiuse */}
        {closedStops.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Storico oggi</h2>
            <div className="space-y-3">
              {closedStops.map(e => (
                <StopCard key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
              ))}
            </div>
          </section>
        )}

        {stops.length === 0 && !error && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">✓</p>
            <p className="font-medium text-gray-600">Nessuna fermata nelle ultime 24 ore</p>
          </div>
        )}
      </div>
    </div>
  );
}
