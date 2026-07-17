'use client';

import { useState, useEffect, useRef } from 'react';
import type { QualitaComponent } from '@/types';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Step = 'component' | 'commessa' | 'draw';

const SEVERITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta' };

interface Props {
  /** Ingrandisce immagini, testi e riquadro di disegno per l'uso su tablet. */
  tablet?: boolean;
}

export function NuovaSegnalazioneFlow({ tablet = false }: Props) {
  const [step, setStep] = useState<Step>('component');

  const [components, setComponents] = useState<QualitaComponent[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [component, setComponent] = useState<QualitaComponent | null>(null);
  const [commessa, setCommessa]   = useState('');

  const [defectType, setDefectType] = useState('');
  const [severity, setSeverity]     = useState('');
  const [note, setNote]             = useState('');
  const [photo, setPhoto]           = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [justSaved, setJustSaved]   = useState(false);

  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/qualita/components`, { credentials: 'include' })
      .then(r => r.json())
      .then((data: QualitaComponent[]) => setComponents(data.filter(c => c.is_active)))
      .catch(() => setError('Errore nel caricamento dei componenti'))
      .finally(() => setLoadingComponents(false));
  }, []);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  function pickComponent(c: QualitaComponent) {
    setComponent(c);
    setStep('commessa');
  }

  function confirmCommessa(e: React.FormEvent) {
    e.preventDefault();
    if (!commessa.trim()) return;
    setSavedCount(0);
    setStep('draw');
  }

  function resetDefectFields() {
    setDefectType(''); setSeverity(''); setNote(''); setPhoto(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  // "Termina segnalazione" — chiude la sessione su questo componente/commessa e
  // torna alla scelta del componente, per iniziarne una nuova.
  function finishSegnalazione() {
    setComponent(null);
    setCommessa('');
    resetDefectFields();
    setSavedCount(0);
    setStep('component');
  }

  async function handleSubmit() {
    if (!component) return;
    setError('');
    const drawingBlob = await canvasRef.current?.exportBlob();
    if (!drawingBlob) { setError('Nessun disegno da salvare'); return; }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('component_id', String(component.id));
      form.append('commessa', commessa.trim());
      if (defectType.trim()) form.append('defect_type', defectType.trim());
      if (severity)           form.append('severity', severity);
      if (note.trim())        form.append('note', note.trim());
      form.append('drawing', drawingBlob, 'drawing.png');
      if (photo) form.append('photo', photo);

      const res = await fetch(`${BACKEND}/api/qualita/reports`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Errore durante il salvataggio');
      }

      // Segnalazione salvata: resta sul disegno per continuare a segnare altri
      // difetti sullo stesso componente/commessa, invece di tornare all'inizio.
      canvasRef.current?.clear();
      resetDefectFields();
      setSavedCount(n => n + 1);
      setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio');
    } finally {
      setSubmitting(false);
    }
  }

  const thumbSize   = tablet ? 'w-36 h-36' : 'w-24 h-24';
  const stepMaxW    = tablet ? 'max-w-5xl' : 'max-w-3xl';
  const commessaMaxW = tablet ? 'max-w-2xl' : 'max-w-md';

  return (
    <div>
      {error && <p className={`${stepMaxW} mx-auto text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4`}>{error}</p>}

      {/* ── Step 1: scegli componente ── */}
      {step === 'component' && (
        <div className={`${stepMaxW} mx-auto`}>
          {loadingComponents ? (
            <p className="text-sm text-gray-400">Caricamento componenti...</p>
          ) : components.length === 0 ? (
            <p className="text-sm text-gray-400">Nessun componente configurato. Contatta un amministratore.</p>
          ) : (
            <div className={`grid grid-cols-2 sm:grid-cols-3 ${tablet ? 'gap-6' : 'gap-4'}`}>
              {components.map(c => (
                <button
                  key={c.id}
                  onClick={() => pickComponent(c)}
                  className={`card hover:shadow-md hover:border-blue-300 transition-shadow text-center ${tablet ? 'py-8' : 'py-6'}`}
                >
                  <QualitaThumb src={`${BACKEND}/api/qualita/components/${c.id}/image`} alt={c.name} className={`${thumbSize} mx-auto mb-3`} />
                  <p className={`font-semibold text-gray-800 ${tablet ? 'text-lg' : ''}`}>{c.name}</p>
                  {c.code && <p className="text-xs text-gray-400">{c.code}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: commessa ── */}
      {step === 'commessa' && component && (
        <form onSubmit={confirmCommessa} className={`card ${commessaMaxW} mx-auto space-y-4 ${tablet ? 'py-8' : ''}`}>
          <div className="flex items-center gap-4">
            <QualitaThumb src={`${BACKEND}/api/qualita/components/${component.id}/image`} alt={component.name} className={tablet ? 'w-20 h-20' : 'w-14 h-14'} />
            <div>
              <p className={`font-semibold text-gray-800 ${tablet ? 'text-lg' : ''}`}>{component.name}</p>
              <button type="button" className="text-xs text-blue-500 hover:underline" onClick={() => setStep('component')}>Cambia componente</button>
            </div>
          </div>
          <div>
            <label className={`block font-medium text-gray-700 mb-1 ${tablet ? 'text-base' : 'text-sm'}`}>Commessa <span className="text-red-500">*</span></label>
            <input
              autoFocus
              className={`input w-full ${tablet ? 'text-2xl py-4' : 'text-lg'}`}
              placeholder="Numero commessa"
              value={commessa}
              onChange={e => setCommessa(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={!commessa.trim()} className={`btn btn-primary w-full ${tablet ? 'text-lg py-3' : ''}`}>Continua</button>
        </form>
      )}

      {/* ── Step 3: disegno + form — a schermo intero, sopra tutto (anche il menu laterale) ── */}
      {step === 'draw' && component && (
        <div className="fixed inset-0 z-40 bg-white overflow-y-auto p-4 sm:p-6">
          <div className={`grid grid-cols-1 ${tablet ? 'lg:grid-cols-[1fr_360px]' : 'lg:grid-cols-[1fr_320px]'} gap-6 items-start`}>
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className={`font-semibold text-gray-800 ${tablet ? 'text-lg' : ''}`}>{component.name} — Commessa {commessa}</p>
                  {savedCount > 0 && (
                    <p className="text-xs text-green-600 mt-0.5">
                      {savedCount} segnalazion{savedCount === 1 ? 'e salvata' : 'i salvate'} su questa commessa
                      {justSaved && ' ✓'}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn text-xs" onClick={() => canvasRef.current?.undo()}>Annulla tratto</button>
                  <button className="btn text-xs" onClick={() => canvasRef.current?.clear()}>Cancella tutto</button>
                </div>
              </div>

              <DrawingCanvas
                ref={canvasRef}
                imageUrl={`${BACKEND}/api/qualita/components/${component.id}/image`}
                imageAlt={component.name}
                maxHeightVh={tablet ? 88 : 80}
              />
            </div>

            <div className="space-y-4">
              <div className="card space-y-4">
                <h2 className="font-semibold text-gray-800">Dettagli difetto (opzionale)</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo di difetto</label>
                  <input className="input w-full" value={defectType} onChange={e => setDefectType(e.target.value)} placeholder="Es. graffio, ammaccatura..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gravità</label>
                  <select className="input w-full bg-white" value={severity} onChange={e => setSeverity(e.target.value)}>
                    <option value="">— Nessuna —</option>
                    {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                  <textarea className="input w-full resize-none" rows={3} value={note} onChange={e => setNote(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Foto aggiuntiva</label>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={e => setPhoto(e.target.files?.[0] ?? null)}
                    className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <button className={`btn btn-primary w-full ${tablet ? 'text-lg py-3' : ''}`} disabled={submitting} onClick={handleSubmit}>
                  {submitting ? 'Salvataggio...' : 'Salva segnalazione'}
                </button>
                <button className={`btn btn-secondary w-full ${tablet ? 'text-lg py-3' : ''}`} onClick={finishSegnalazione}>
                  Termina segnalazione
                </button>
                <button className="btn w-full text-sm" onClick={() => setStep('commessa')}>Indietro (correggi commessa)</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Thumbnail con fallback se l'immagine non carica ───────────────────────

function QualitaThumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`${className ?? ''} flex items-center justify-center bg-gray-100 rounded text-gray-300 text-xl`}>
        🖼️
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`${className ?? ''} object-contain`} />;
}
