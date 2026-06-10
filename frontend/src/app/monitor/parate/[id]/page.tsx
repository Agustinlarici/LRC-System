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

// Colonne della tabella — stessa definizione in header e righe
const COLS = '140px 100px 100px 1fr 1fr 200px 200px';

// ─── Header tabella ───────────────────────────────────────────────────────────

function TableHeader() {
  const headers = ['Durata', 'Inizio', 'Fine', 'Categoria', 'Motivo', 'Note', 'Nome'];
  return (
    <div
      className="grid bg-gray-50 border-b-2 border-gray-200"
      style={{ gridTemplateColumns: COLS }}
    >
      {headers.map((h, i) => (
        <div
          key={h}
          className={`px-5 py-3 text-sm font-bold text-gray-400 uppercase tracking-widest ${i < headers.length - 1 ? 'border-r border-gray-200' : ''}`}
        >
          {h}
        </div>
      ))}
    </div>
  );
}

// ─── Riga tabella ─────────────────────────────────────────────────────────────

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
      } catch { setError('Errore salvataggio'); }
      finally  { setSaving(false); }
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, reasonId, note, operatore]);

  const filteredReasons = catId ? reasons.filter(r => r.category_id === catId) : reasons;
  const durationDisplay = open
    ? (elapsed !== null ? fmtDuration(elapsed) : '0m 00s')
    : fmtDuration(event.duration_sec ?? 0);

  const rowBg     = open ? 'bg-red-50' : 'bg-white';
  const accentClr = open ? '#ef4444' : event.reason_id ? '#22c55e' : '#f59e0b';
  const cellBorder = 'border-r border-gray-200';

  return (
    <div
      className={`grid border-b border-gray-200 ${rowBg}`}
      style={{ gridTemplateColumns: COLS, borderLeft: `5px solid ${accentClr}` }}
    >

      {/* Durata */}
      <div className={`px-5 py-5 flex flex-col justify-center gap-1 ${cellBorder}`}>
        {open && (
          <span className="text-xs font-bold text-red-500 uppercase tracking-widest">● In corso</span>
        )}
        <p className={`text-3xl font-bold tabular-nums leading-none ${open ? 'text-red-500' : 'text-gray-700'}`}>
          {durationDisplay}
        </p>
      </div>

      {/* Inizio */}
      <div className={`px-5 py-5 flex items-center ${cellBorder}`}>
        <p className="text-2xl font-bold tabular-nums text-gray-900">
          {fmtTime(event.started_at)}
        </p>
      </div>

      {/* Fine */}
      <div className={`px-5 py-5 flex items-center ${cellBorder}`}>
        <p className="text-2xl font-bold tabular-nums text-gray-900">
          {event.ended_at ? fmtTime(event.ended_at) : '—'}
        </p>
      </div>

      {/* Categoria */}
      <div className={`px-5 py-4 flex flex-col justify-center ${cellBorder}`}>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setCatId(cat.id); setReasonId(null); }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border-2"
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
              className="px-3 py-2.5 rounded-xl text-sm border-2 bg-white text-gray-400 border-gray-200 hover:border-gray-400"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Motivo */}
      <div className={`px-5 py-4 flex flex-col justify-center ${cellBorder}`}>
        <div className="flex flex-wrap gap-2">
          {filteredReasons.map(r => (
            <button
              key={r.id}
              onClick={() => setReasonId(r.id)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                reasonId === r.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-blue-300'
              }`}
            >
              {r.descrizione}
            </button>
          ))}
          {filteredReasons.length === 0 && (
            <span className="text-sm text-gray-300 italic">Seleziona categoria</span>
          )}
        </div>
      </div>

      {/* Note */}
      <div className={`px-5 py-4 flex items-center ${cellBorder}`}>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Note opzionali..."
        />
      </div>

      {/* Nome + stato */}
      <div className="px-5 py-4 flex flex-col justify-center gap-2">
        <input
          type="text"
          value={operatore}
          onChange={e => setOperatore(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Nome operatore *"
        />
        <div className="text-sm font-semibold h-5 leading-none">
          {saving                          && <span className="text-gray-400">Salvataggio...</span>}
          {saved   && !saving              && <span className="text-green-500">● Salvato</span>}
          {error   && !saving              && <span className="text-red-500">{error}</span>}
          {!saving && !saved && !error && operatore.trim()  && <span className="text-gray-300">Salva automatico</span>}
          {!operatore.trim()               && <span className="text-amber-400">Inserisci nome</span>}
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

  async function toggleFermata() {
    setOpening(true);
    try {
      const open = stops.find(isOpen);
      if (open) {
        await api.post(`/api/monitor/parate/${open.id}/chiudi`, {});
      } else {
        await api.post(`/api/monitor/parate/${lineaId}/apri`, {});
      }
      await loadStops();
    } finally { setOpening(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <p className="text-gray-400 text-xl">Caricamento...</p>
    </div>
  );

  const openStops   = stops.filter(isOpen);
  const closedStops = stops.filter(e => !isOpen(e));
  const lineaFerma  = openStops.length > 0;

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5 sticky top-0 z-10 shadow-sm">
        <h1 className="text-3xl font-bold text-gray-900">Fermate — {lineaNome}</h1>
      </div>

      <div className="px-8 py-8 space-y-8">
        {error && <p className="text-red-500 text-center text-lg">{error}</p>}

        {/* Card pulsante */}
        <div className={`rounded-2xl p-8 shadow border-2 transition-colors ${
          lineaFerma ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between gap-8">
            <div>
              <p className={`text-xl font-bold uppercase tracking-widest ${lineaFerma ? 'text-red-500' : 'text-gray-400'}`}>
                {lineaFerma ? '● Linea ferma' : '○ Linea in produzione'}
              </p>
              {lineaFerma && openStops[0] && (
                <p className="text-base text-red-400 mt-2">
                  Iniziata alle {fmtTime(openStops[0].started_at)}
                </p>
              )}
            </div>
            <button
              onClick={toggleFermata}
              disabled={opening}
              className={`flex items-center gap-4 px-12 py-5 font-bold rounded-2xl text-xl disabled:opacity-50 transition-colors shadow text-white ${
                lineaFerma ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              <span className="text-2xl leading-none">{lineaFerma ? '▶' : '⏹'}</span>
              {opening ? '...' : lineaFerma ? 'Riprendi linea' : 'Ferma linea'}
            </button>
          </div>
        </div>

        {/* Tabella fermate */}
        {stops.length > 0 && (
          <div className="rounded-2xl shadow overflow-hidden border border-gray-200">
            <TableHeader />

            {/* Fermate in corso */}
            {openStops.map(e => (
              <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
            ))}

            {/* Separatore storico */}
            {closedStops.length > 0 && (
              <>
                {openStops.length > 0 && (
                  <div className="px-5 py-2 bg-gray-50 border-b border-t border-gray-200">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                      Fermate del giorno
                    </p>
                  </div>
                )}
                {closedStops.map(e => (
                  <StopRow key={e.id} event={e} categories={categories} reasons={reasons} onSaved={loadStops} />
                ))}
              </>
            )}
          </div>
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
