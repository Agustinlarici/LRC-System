'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Recepcion } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function backendUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

function fmtHora(ts: string): string {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtFecha(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

// ─── Badge confianza ─────────────────────────────────────────────────────────

function BadgeConfianza({ v }: { v: Recepcion['confianza_ia'] }) {
  if (!v) return <span className="text-xs text-gray-400">IA non disponibile</span>;
  const map: Record<string, string> = {
    alta:  'bg-green-100 text-green-700',
    media: 'bg-yellow-100 text-yellow-700',
    baja:  'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[v]}`}>
      IA {v}
    </span>
  );
}

// ─── Modal PDF + form conferma ─────────────────────────────────────────────

function ModalRevision({
  rec,
  onClose,
  onConfirm,
}: {
  rec:       Recepcion;
  onClose:   () => void;
  onConfirm: (id: number, data: Partial<Recepcion>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    proveedor:    rec.proveedor    ?? '',
    numero_ddt:   rec.numero_ddt   ?? '',
    fecha_ddt:    rec.fecha_ddt    ?? '',
    destinatario: rec.destinatario ?? '',
  });
  const [saving, setSaving] = useState(false);
  const url = `${backendUrl()}/api/recepciones/${rec.id_ddt}/pdf`;

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm(rec.id_ddt, form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-800">
            Revisione DDT — <span className="text-gray-500 text-sm">id #{rec.id_ddt}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* PDF preview */}
          <div className="flex-1 bg-gray-100 border-r">
            <iframe src={url} className="w-full h-full" title="PDF DDT" />
          </div>

          {/* Form */}
          <div className="w-80 flex flex-col p-6 gap-4 overflow-y-auto">
            <p className="text-sm text-gray-500">Verifica e correggi i dati estratti dall&#39;IA.</p>

            {[
              { label: 'Fornitore',     key: 'proveedor',    placeholder: 'Nome fornitore' },
              { label: 'Numero DDT',    key: 'numero_ddt',   placeholder: 'es. DDT-2024-001' },
              { label: 'Data (AAAA-MM-GG)', key: 'fecha_ddt', placeholder: '2024-01-15' },
              { label: 'Destinatario',  key: 'destinatario', placeholder: 'Nome destinatario' },
            ].map(({ label, key, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  type="text"
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}

            <BadgeConfianza v={rec.confianza_ia} />

            <button
              onClick={handleConfirm}
              disabled={saving}
              className="mt-auto bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Salvataggio…' : 'Conferma e archivia'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card confermata ──────────────────────────────────────────────────────────

function CardConfermata({ rec }: { rec: Recepcion }) {
  return (
    <div className="bg-white border border-green-200 rounded-xl p-4 flex items-start gap-4">
      <div className="w-2 h-full min-h-[40px] bg-green-400 rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800 truncate">{rec.proveedor ?? '—'}</span>
          <BadgeConfianza v={rec.confianza_ia} />
        </div>
        <div className="text-sm text-gray-500 mt-0.5">
          DDT&nbsp;<span className="font-mono">{rec.numero_ddt ?? '—'}</span>
          {rec.fecha_ddt && <span>&nbsp;·&nbsp;{fmtFecha(rec.fecha_ddt)}</span>}
        </div>
      </div>
      <div className="text-xs text-gray-400 shrink-0">{fmtHora(rec.creado_at)}</div>
    </div>
  );
}

// ─── Card revisione ───────────────────────────────────────────────────────────

function CardRevision({
  rec,
  onApri,
}: {
  rec:    Recepcion;
  onApri: (r: Recepcion) => void;
}) {
  return (
    <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-4">
      <div className="w-2 h-full min-h-[40px] bg-red-400 rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800 truncate">{rec.proveedor ?? 'Fornitore sconosciuto'}</span>
          <BadgeConfianza v={rec.confianza_ia} />
        </div>
        <div className="text-sm text-gray-500 mt-0.5">
          DDT&nbsp;<span className="font-mono">{rec.numero_ddt ?? '—'}</span>
          {rec.fecha_ddt && <span>&nbsp;·&nbsp;{fmtFecha(rec.fecha_ddt)}</span>}
        </div>
        <div className="text-xs text-red-500 mt-1">Arrivato alle {fmtHora(rec.creado_at)}</div>
      </div>
      <button
        onClick={() => onApri(rec)}
        className="shrink-0 bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors font-medium"
      >
        Rivedi
      </button>
    </div>
  );
}

// ─── Toast promemoria ─────────────────────────────────────────────────────────

function ToastPromemoria({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-40 bg-orange-600 text-white rounded-xl px-5 py-3 shadow-xl flex items-center gap-3">
      <span className="text-lg">⏰</span>
      <span className="text-sm font-medium">
        {count} DDT in attesa da oltre 30 minuti
      </span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecepcionesPage() {
  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [modalRec,    setModalRec]    = useState<Recepcion | null>(null);
  const [reminder,    setReminder]    = useState<number | null>(null);

  // Load today's data
  useEffect(() => {
    api.get<Recepcion[]>('/api/recepciones')
      .then(setRecepciones)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // SSE connection
  useEffect(() => {
    const base = backendUrl();
    if (!base) return;

    const es = new EventSource(`${base}/api/recepciones/sse`);

    const upsert = (payload: { data?: Recepcion }) => {
      if (!payload.data) return;
      const rec = payload.data;
      setRecepciones(prev => {
        const idx = prev.findIndex(r => r.id_ddt === rec.id_ddt);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = rec;
          return next;
        }
        return [rec, ...prev];
      });
    };

    es.addEventListener('recepcion:confirmada',      e => upsert(JSON.parse(e.data)));
    es.addEventListener('recepcion:revision_manual', e => upsert(JSON.parse(e.data)));
    es.addEventListener('recepcion:actualizada',     e => upsert(JSON.parse(e.data)));
    es.addEventListener('recordatorio',              e => {
      const { count } = JSON.parse(e.data) as { count: number };
      if (count > 0) setReminder(count);
    });

    return () => es.close();
  }, []);

  // When the modal rec gets updated via SSE, keep it in sync
  useEffect(() => {
    if (!modalRec) return;
    const updated = recepciones.find(r => r.id_ddt === modalRec.id_ddt);
    if (updated && updated.estado === 'confirmado') setModalRec(null);
  }, [recepciones, modalRec]);

  async function handleConfirm(id: number, data: Partial<Recepcion>) {
    await api.patch(`/api/recepciones/${id}`, data);
  }

  const pendientes  = recepciones.filter(r => r.estado === 'revision_manual');
  const confirmadas = recepciones.filter(r => r.estado === 'confirmado');

  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ricezione DDT</h1>
        <p className="text-sm text-gray-500 mt-1">
          Documenti di trasporto ricevuti oggi via scanner
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Sezione revisione manuale ── */}
      {!loading && pendientes.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h2 className="font-semibold text-red-700">
              Revisione manuale ({pendientes.length})
            </h2>
          </div>
          <div className="space-y-3">
            {pendientes.map(r => (
              <CardRevision key={r.id_ddt} rec={r} onApri={setModalRec} />
            ))}
          </div>
        </section>
      )}

      {/* ── Sezione confermate ── */}
      {!loading && (
        <section>
          <h2 className="font-semibold text-gray-700 mb-3">
            Confermate oggi ({confirmadas.length})
          </h2>
          {confirmadas.length === 0 ? (
            <p className="text-sm text-gray-400">Nessun documento ancora ricevuto.</p>
          ) : (
            <div className="space-y-2">
              {confirmadas.map(r => (
                <CardConfermata key={r.id_ddt} rec={r} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Modal revisione ── */}
      {modalRec && (
        <ModalRevision
          rec={modalRec}
          onClose={() => setModalRec(null)}
          onConfirm={handleConfirm}
        />
      )}

      {/* ── Toast promemoria ── */}
      {reminder !== null && (
        <ToastPromemoria count={reminder} onDismiss={() => setReminder(null)} />
      )}
    </div>
  );
}
