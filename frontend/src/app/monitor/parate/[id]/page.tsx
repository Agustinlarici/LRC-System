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

// ─── Form inline registrazione motivo ────────────────────────────────────────

function MotivoForm({
  event, categories, reasons, onSaved,
}: {
  event:      StopEvent;
  categories: StopCategory[];
  reasons:    StopReason[];
  onSaved:    () => void;
}) {
  const [catId,     setCatId]     = useState<number | null>(() => {
    if (!event.reason_id) return null;
    return reasons.find(r => r.id === event.reason_id)?.category_id ?? null;
  });
  const [reasonId,  setReasonId]  = useState<number | null>(event.reason_id);
  const [note,      setNote]      = useState(event.note ?? '');
  const [operatore, setOperatore] = useState(event.operatore ?? '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const filteredReasons = catId ? reasons.filter(r => r.category_id === catId) : reasons;

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
    <div className="bg-gray-50 border-t border-gray-200 px-6 py-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Categoria + Motivo */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Categoria</p>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button key={cat.id}
                  onClick={() => { setCatId(cat.id); setReasonId(null); }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-all border-2"
                  style={catId === cat.id
                    ? { background: cat.colore, color: '#fff', borderColor: cat.colore }
                    : { background: '#fff', color: '#374151', borderColor: '#e5e7eb' }}
                >
                  {cat.nome}
                </button>
              ))}
              {catId !== null && (
                <button onClick={() => { setCatId(null); setReasonId(null); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium border-2 bg-white text-gray-500 border-gray-200 hover:border-gray-400">
                  Tutte
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Motivo</p>
            <div className="flex flex-wrap gap-2">
              {filteredReasons.map(r => (
                <button key={r.id} onClick={() => setReasonId(r.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                    reasonId === r.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}>
                  {r.descrizione}
                </button>
              ))}
              {filteredReasons.length === 0 && (
                <p className="text-sm text-gray-400">Nessun motivo — seleziona una categoria</p>
              )}
            </div>
          </div>
        </div>

        {/* Note + Nome + Salva */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Note</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Dettagli aggiuntivi..." />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Il tuo nome *</p>
            <input type="text" value={operatore} onChange={e => setOperatore(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nome e cognome" />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio...' : 'Salva motivo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Riga fermata ─────────────────────────────────────────────────────────────

function StopRow({
  event, categories, reasons, onSaved,
}: {
  event:      StopEvent;
  categories: StopCategory[];
  reasons:    StopReason[];
  onSaved:    () => void;
}) {
  const [expanded, setExpanded] = useState(isOpen(event) && !event.reason_id);
  const open      = isOpen(event);
  const hasMotivo = !!event.reason_id;

  const borderColor = open ? '#ef4444' : hasMotivo ? '#22c55e' : '#f59e0b';

  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100"
      style={{ borderLeft: `4px solid ${borderColor}` }}>

      {/* Riga principale */}
      <div className="flex items-center gap-4 px-5 py-4">

        {/* Status */}
        <div className="shrink-0 w-24">
          <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full ${
            open ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
          }`}>
            {open ? '● In corso' : 'Terminata'}
          </span>
        </div>

        {/* Orario */}
        <div className="shrink-0 w-40">
          <p className="font-semibold text-gray-800 tabular-nums">
            {fmtTime(event.started_at)}
            {event.ended_at ? ` → ${fmtTime(event.ended_at)}` : ' → ora'}
          </p>
        </div>

        {/* Durata */}
        <div className="shrink-0 w-24">
          <p className={`font-mono text-sm font-semibold ${open ? 'text-red-600' : 'text-gray-700'}`}>
            {fmtDuration(event.duration_sec)}
          </p>
        </div>

        {/* Categoria · Motivo */}
        <div className="flex-1 min-w-0">
          {hasMotivo ? (
            <div className="flex items-center gap-2 flex-wrap">
              {event.categoria_nome && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: event.categoria_colore + '20', color: event.categoria_colore ?? '#6b7280' }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: event.categoria_colore ?? '#6b7280' }} />
                  {event.categoria_nome}
                </span>
              )}
              <span className="text-sm text-gray-700 font-medium">{event.reason_descrizione}</span>
            </div>
          ) : (
            <span className="text-sm text-yellow-600 font-medium">Senza motivo</span>
          )}
          {event.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{event.note}</p>}
        </div>

        {/* Operatore */}
        <div className="shrink-0 w-32 text-right">
          <p className="text-sm text-gray-500">{event.operatore ?? '—'}</p>
        </div>

        {/* Azione */}
        <div className="shrink-0">
          <button onClick={() => setExpanded(v => !v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              expanded
                ? 'bg-gray-100 text-gray-600 border-gray-200'
                : hasMotivo
                  ? 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
                  : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
            }`}>
            {expanded ? 'Chiudi' : hasMotivo ? 'Modifica' : 'Registra'}
          </button>
        </div>
      </div>

      {/* Form inline */}
      {expanded && (
        <MotivoForm event={event} categories={categories} reasons={reasons}
          onSaved={() => { setExpanded(false); onSaved(); }} />
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
            <button onClick={loadStops} className="text-sm text-gray-500 hover:text-gray-700 font-medium px-3 py-1.5 border border-gray-200 rounded-lg">
              Aggiorna
            </button>
            <button onClick={apriManuale} disabled={opening}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition-colors shadow-sm">
              <span className="text-lg leading-none">⏹</span>
              {opening ? 'Apertura...' : 'Segna linea ferma'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {error && <p className="text-red-500 text-center">{error}</p>}

        {/* Intestazioni colonne */}
        {stops.length > 0 && (
          <div className="flex items-center gap-4 px-5 text-xs font-bold text-gray-400 uppercase tracking-widest">
            <div className="w-24">Stato</div>
            <div className="w-40">Orario</div>
            <div className="w-24">Durata</div>
            <div className="flex-1">Motivo</div>
            <div className="w-32 text-right">Operatore</div>
            <div className="w-24" />
          </div>
        )}

        {/* Fermate aperte */}
        {openStops.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-bold text-red-500 uppercase tracking-widest px-1">In corso</p>
            {openStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}
          </section>
        )}

        {/* Fermate chiuse */}
        {closedStops.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Storico oggi</p>
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
