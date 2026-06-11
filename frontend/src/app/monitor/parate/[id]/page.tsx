'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { StopEvent, StopReason, StopCategory } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function isOpen(e: StopEvent) { return e.ended_at === null; }

const LABEL = 'text-xs font-bold text-gray-400 uppercase tracking-widest';

function SourceBadge({ source }: { source: string }) {
  if (source === 'attesa') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">In attesa picking</span>;
  if (source === 'manuale') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Manuale</span>;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Overtime</span>;
}

// ─── Card fermata ─────────────────────────────────────────────────────────────

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

  // Timer live
  const [elapsed, setElapsed] = useState(() =>
    open ? Math.floor((Date.now() - new Date(event.started_at).getTime()) / 1000) : null,
  );
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(event.started_at).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [open, event.started_at]);

  // Auto-save 2s dopo l'ultima modifica
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirst   = useRef(true);

  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (!operatore.trim()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true); setError(null);
      try {
        await api.post(`/api/monitor/parate/${event.id}/motivo`, {
          reason_id: reasonId,
          note:      note.trim() || null,
          operatore: operatore.trim(),
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onSaved();
      } catch { setError('Errore'); }
      finally  { setSaving(false); }
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, reasonId, note, operatore]);

  const filteredReasons = catId ? reasons.filter(r => r.category_id === catId) : reasons;
  const durationDisplay = open
    ? (elapsed !== null ? fmtDuration(elapsed) : '0m 00s')
    : fmtDuration(event.duration_sec ?? 0);
  const accentColor = open ? '#ef4444' : event.reason_id ? '#22c55e' : '#f59e0b';

  return (
    <div
      className="bg-white rounded-2xl shadow-sm overflow-hidden"
      style={{ borderLeft: `6px solid ${accentColor}` }}
    >
      {/* Riga interna tipo tabella — divide-x crea i divisori verticali */}
      <div className="grid divide-x divide-gray-100" style={{ gridTemplateColumns: '9rem 8rem 8rem 1fr 1fr 14rem 14rem' }}>

        {/* Durata */}
        <div className="px-5 py-5 flex flex-col gap-2">
          <span className={`${LABEL} ${open ? 'text-red-500' : 'text-gray-400'}`}>
            {open ? '● In corso' : 'Chiusa'}
          </span>
          <p className={`text-2xl font-bold tabular-nums ${open ? 'text-red-500' : 'text-gray-700'}`}>
            {durationDisplay}
          </p>
          <SourceBadge source={event.source} />
        </div>

        {/* Inizio */}
        <div className="px-5 py-5 flex flex-col gap-2">
          <span className={LABEL}>Inizio</span>
          <p className="text-2xl font-bold tabular-nums text-gray-900">
            {fmtTime(event.started_at)}
          </p>
        </div>

        {/* Fine */}
        <div className="px-5 py-5 flex flex-col gap-2">
          <span className={LABEL}>Fine</span>
          <p className="text-2xl font-bold tabular-nums text-gray-900">
            {event.ended_at ? fmtTime(event.ended_at) : '—'}
          </p>
        </div>

        {/* Categoria */}
        <div className="px-5 py-5 flex flex-col gap-3">
          <span className={LABEL}>Categoria</span>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setCatId(cat.id); setReasonId(null); }}
                className="px-4 py-2 rounded-xl text-base font-semibold transition-all border-2"
                style={catId === cat.id
                  ? { background: cat.colore, color: '#fff', borderColor: cat.colore }
                  : { background: '#f9fafb', color: '#374151', borderColor: '#e5e7eb' }}
              >
                {cat.nome}
              </button>
            ))}
            {catId !== null && (
              <button
                onClick={() => { setCatId(null); setReasonId(null); }}
                className="px-3 py-2 rounded-xl text-base border-2 text-gray-400 border-gray-200 hover:border-gray-400"
              >✕</button>
            )}
          </div>
        </div>

        {/* Motivo */}
        <div className="px-5 py-5 flex flex-col gap-3">
          <span className={LABEL}>Motivo</span>
          <div className="flex flex-wrap gap-2">
            {filteredReasons.map(r => (
              <button
                key={r.id}
                onClick={() => setReasonId(r.id)}
                className={`px-4 py-2 rounded-xl text-base font-semibold border-2 transition-all ${
                  reasonId === r.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-blue-300'
                }`}
              >
                {r.descrizione}
              </button>
            ))}
            {filteredReasons.length === 0 && (
              <span className="text-base text-gray-300 italic">Seleziona categoria</span>
            )}
          </div>
        </div>

        {/* Note */}
        <div className="px-5 py-5 flex flex-col gap-3">
          <span className={LABEL}>Note</span>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Note opzionali..."
          />
        </div>

        {/* Nome + stato */}
        <div className="px-5 py-5 flex flex-col gap-3">
          <span className={LABEL}>Nome *</span>
          <input
            type="text"
            value={operatore}
            onChange={e => setOperatore(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Nome operatore"
          />
          <p className="text-sm font-semibold leading-none h-4">
            {saving                                   && <span className="text-gray-400">Salvataggio...</span>}
            {saved   && !saving                       && <span className="text-green-500">● Salvato</span>}
            {error   && !saving                       && <span className="text-red-500">{error}</span>}
            {!saving && !saved && !error && !operatore.trim() && <span className="text-amber-400">Inserisci nome</span>}
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export default function ParatePage() {
  const params  = useParams();
  const lineaId = params.id as string;

  const [lineaNome,  setLineaNome]  = useState('');
  const [stops,      setStops]      = useState<StopEvent[]>([]);
  const [categories, setCategories] = useState<StopCategory[]>([]);
  const [reasons,    setReasons]    = useState<StopReason[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [opening,    setOpening]    = useState(false);

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
      setError(null);
    } catch { setError('Errore caricamento'); }
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

  async function chiudiManuale(id: number) {
    setOpening(true);
    try {
      await api.post(`/api/monitor/parate/${id}/chiudi`, {});
      await loadStops();
    } finally { setOpening(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400 text-xl">Caricamento...</p>
    </div>
  );

  const openStops    = stops.filter(isOpen);
  const closedStops  = stops.filter(e => !isOpen(e));
  const openManuale  = openStops.find(s => s.source === 'manuale');
  const openAuto     = openStops.find(s => s.source === 'auto');
  const openAttesa   = openStops.find(s => s.source === 'attesa');
  const lineaFerma   = openStops.length > 0;

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5 sticky top-0 z-10 shadow-sm">
        <h1 className="text-3xl font-bold text-gray-900">Fermate — {lineaNome}</h1>
      </div>

      <div className="px-8 py-8 space-y-8">
        {error && <p className="text-red-500 text-center text-lg">{error}</p>}

        {/* Card stato + pulsante */}
        <div className={`rounded-xl px-6 py-4 shadow-sm border transition-colors ${
          lineaFerma ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`text-sm font-bold uppercase tracking-widest ${lineaFerma ? 'text-red-500' : 'text-gray-400'}`}>
                {lineaFerma ? '● Linea ferma' : '○ Linea in produzione'}
              </p>
              {lineaFerma && openStops[0] && (
                <p className="text-xs text-red-400 mt-1">
                  Iniziata alle {fmtTime(openStops[0].started_at)}
                  {openAttesa && !openManuale && ' — in attesa di picking'}
                  {openAuto   && !openManuale && !openAttesa && ' — rilevata automaticamente'}
                </p>
              )}
            </div>

            {/* Nessun stop aperto → mostra "Ferma linea" */}
            {!lineaFerma && (
              <button
                onClick={apriManuale}
                disabled={opening}
                className="flex items-center gap-2 px-6 py-2.5 font-bold rounded-xl text-sm disabled:opacity-50 transition-colors shadow-sm text-white bg-red-600 hover:bg-red-700"
              >
                <span className="leading-none">⏹</span>
                {opening ? '...' : 'Ferma linea'}
              </button>
            )}

            {/* Stop manuale aperto → mostra "Riprendi linea" */}
            {openManuale && (
              <button
                onClick={() => chiudiManuale(openManuale.id)}
                disabled={opening}
                className="flex items-center gap-2 px-6 py-2.5 font-bold rounded-xl text-sm disabled:opacity-50 transition-colors shadow-sm text-white bg-green-600 hover:bg-green-700"
              >
                <span className="leading-none">▶</span>
                {opening ? '...' : 'Riprendi linea'}
              </button>
            )}

            {/* Solo stop auto (overtime) → nessun pulsante */}
          </div>
        </div>

        {/* Fermate in corso */}
        {openStops.length > 0 && (
          <section className="space-y-4">
            <p className="text-sm font-bold text-red-500 uppercase tracking-widest">In corso</p>
            {openStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}
          </section>
        )}

        {/* Storico */}
        {closedStops.length > 0 && (
          <section className="space-y-4">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Fermate del giorno</p>
            {closedStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}
          </section>
        )}

        {stops.length === 0 && !error && (
          <div className="text-center py-32 text-gray-400">
            <p className="text-6xl mb-6">✓</p>
            <p className="text-2xl font-medium text-gray-500">Nessuna fermata nelle ultime 24 ore</p>
          </div>
        )}
      </div>
    </div>
  );
}
