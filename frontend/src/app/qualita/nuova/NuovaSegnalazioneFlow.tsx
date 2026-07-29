'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import type { QualitaComponent, QualitaReport } from '@/types';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { PALETTE } from '../palette';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Step = 'component' | 'commessa' | 'draw';

const SEVERITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta' };

// Ricorda componente/commessa/step in sessionStorage così un refresh accidentale
// (frequente su tablet) non fa perdere il punto in cui si era arrivati.
const SESSION_KEY = 'qualita_nuova_session';

interface SavedSession {
  componentId: number;
  commessa:    string;
  step:        Step;
}

function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

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

  // Segnalazioni già fatte in precedenza su questo componente/commessa — mostrate
  // sovrapposte, ciascuna con un colore diverso assegnato in automatico.
  const [existingReports, setExistingReports] = useState<QualitaReport[]>([]);

  const [defectType, setDefectType] = useState('');
  const [severity, setSeverity]     = useState('');
  const [note, setNote]             = useState('');
  const [photo, setPhoto]           = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [justSaved, setJustSaved]   = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [exporting, setExporting]   = useState(false);

  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const commessaInputRef = useRef<HTMLInputElement>(null);

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

  const fetchExisting = useCallback(async (componentId: number, commessaValue: string) => {
    try {
      const params = new URLSearchParams({ commessa: commessaValue, component_id: String(componentId) });
      const res = await fetch(`${BACKEND}/api/qualita/reports?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      setExistingReports(await res.json());
    } catch {
      setExistingReports([]);
    }
  }, []);

  // Ripristina componente/commessa/step da sessionStorage al primo caricamento
  // (dopo aver caricato i componenti, serve per risolvere il componentId salvato).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || loadingComponents) return;
    restoredRef.current = true;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedSession;
      const comp = components.find(c => c.id === saved.componentId);
      if (!comp || !saved.commessa) return;
      setComponent(comp);
      setCommessa(saved.commessa);
      if (saved.step === 'draw') fetchExisting(comp.id, saved.commessa);
      if (saved.step === 'draw' || saved.step === 'commessa') setStep(saved.step);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, [loadingComponents, components, fetchExisting]);

  // Salva lo stato corrente ad ogni cambio, così un refresh accidentale (frequente
  // su tablet) riporta l'utente dove era invece di fargli perdere tutto.
  useEffect(() => {
    if (step === 'component' || !component) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    const saved: SavedSession = { componentId: component.id, commessa, step };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  }, [step, component, commessa]);

  function pickComponent(c: QualitaComponent) {
    // flushSync + focus sincrono nello stesso gesto di tap dell'utente, altrimenti
    // su tablet/mobile la tastiera non si apre finché non si tocca di nuovo il campo
    // (i browser mobili aprono la tastiera solo se il focus avviene nello stesso
    // event handler del tocco, non in un useEffect dopo il re-render).
    flushSync(() => {
      setComponent(c);
      setStep('commessa');
    });
    commessaInputRef.current?.focus();
  }

  function confirmCommessa(e: React.FormEvent) {
    e.preventDefault();
    if (!component || !commessa.trim()) return;
    fetchExisting(component.id, commessa.trim());
    setStep('draw');
  }

  function resetDefectFields() {
    setDefectType(''); setSeverity(''); setNote(''); setPhoto(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  // "Termina segnalazione" — se c'è un disegno non ancora salvato lo salva prima
  // di procedere, poi esporta il PDF con le segnalazioni fatte su questo
  // componente/commessa (se ce n'è almeno una) e torna alla scelta del componente.
  async function finishSegnalazione() {
    let justSubmitted = false;
    if (hasUnsaved) {
      justSubmitted = await handleSubmit();
      if (!justSubmitted) return;
    }

    if (component && (justSubmitted || existingReports.length > 0)) {
      setExporting(true);
      try {
        const res = await fetch(`${BACKEND}/api/qualita/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ component_id: component.id, commessa: commessa.trim() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.message ?? 'Errore durante l\'esportazione del PDF. Le segnalazioni restano comunque salvate.');
        }
      } catch {
        setError('Errore di connessione durante l\'esportazione del PDF. Le segnalazioni restano comunque salvate.');
      } finally {
        setExporting(false);
      }
    }

    setComponent(null);
    setCommessa('');
    setExistingReports([]);
    setHasUnsaved(false);
    resetDefectFields();
    setStep('component');
  }

  function goBackToCommessa() {
    if (hasUnsaved && !confirm('Hai un disegno non salvato. Se torni indietro ora, andrà perso. Continuare?')) {
      return;
    }
    setStep('commessa');
  }

  async function handleSubmit(): Promise<boolean> {
    if (!component) return false;
    setError('');
    const drawingBlob = await canvasRef.current?.exportBlob();
    if (!drawingBlob) { setError('Nessun disegno da salvare'); return false; }

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
      // Ricarica le segnalazioni esistenti così quella appena salvata compare
      // subito come livello storico, e la prossima ottiene un colore diverso.
      canvasRef.current?.clear();
      resetDefectFields();
      await fetchExisting(component.id, commessa.trim());
      setJustSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const thumbSize   = tablet ? 'w-36 h-36' : 'w-24 h-24';
  const stepMaxW    = tablet ? 'max-w-5xl' : 'max-w-3xl';
  const commessaMaxW = tablet ? 'max-w-2xl' : 'max-w-md';

  const historicalLayers = component
    ? existingReports.map((r, i) => ({
        src:   `${BACKEND}/api/qualita/reports/${r.id}/drawing`,
        color: PALETTE[i % PALETTE.length],
      }))
    : [];
  const currentColor = PALETTE[existingReports.length % PALETTE.length];

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
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => setStep('component')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114.5-4.5M20 15a8 8 0 01-14.5 4.5" />
                </svg>
                Cambia componente
              </button>
            </div>
          </div>
          <div>
            <label className={`block font-medium text-gray-700 mb-1 ${tablet ? 'text-base' : 'text-sm'}`}>Commessa <span className="text-red-500">*</span></label>
            <input
              ref={commessaInputRef}
              autoFocus
              className={`input w-full ${tablet ? 'text-2xl py-4' : 'text-lg'}`}
              placeholder="Numero commessa"
              value={commessa}
              onChange={e => setCommessa(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              required
            />
          </div>
          <button type="submit" disabled={!commessa.trim()} className={`btn btn-primary w-full ${tablet ? 'text-lg py-3' : ''}`}>Continua</button>
        </form>
      )}

      {/* ── Step 3: disegno + form — a schermo intero, sopra tutto (anche il menu laterale) ── */}
      {step === 'draw' && component && (
        <div className="fixed inset-0 z-40 bg-white overflow-y-auto p-4 sm:p-6">
          <div className={`grid grid-cols-1 ${tablet ? 'lg:grid-cols-[1fr_260px]' : 'lg:grid-cols-[1fr_240px]'} gap-6 items-start`}>
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className={`font-semibold text-gray-800 ${tablet ? 'text-lg' : ''}`}>{component.name} — Commessa {commessa}</p>
                  {justSaved && (
                    <p className="text-xs text-green-600 font-medium mt-1">Segnalazione salvata ✓</p>
                  )}
                  {existingReports.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {existingReports.map((r, i) => (
                        <span
                          key={r.id}
                          title={`${fmtDateTime(r.created_at)} — ${r.created_by_name ?? 'Sconosciuto'}`}
                          className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 bg-gray-50"
                        >
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                          {fmtDateTime(r.created_at)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                    onClick={() => canvasRef.current?.undo()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4 4-4M5 10h9a5 5 0 015 5v1" />
                    </svg>
                    Annulla tratto
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    onClick={() => canvasRef.current?.clear()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 12a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7h12z" />
                    </svg>
                    Cancella tutto
                  </button>
                </div>
              </div>

              <DrawingCanvas
                ref={canvasRef}
                imageUrl={`${BACKEND}/api/qualita/components/${component.id}/image`}
                imageAlt={component.name}
                maxHeightVh={tablet ? 68 : 80}
                strokeColor={currentColor}
                historicalLayers={historicalLayers}
                onDirtyChange={setHasUnsaved}
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
                    capture="environment"
                    onChange={e => setPhoto(e.target.files?.[0] ?? null)}
                    className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <button className={`btn btn-primary w-full ${tablet ? 'text-lg py-3' : ''}`} disabled={submitting} onClick={handleSubmit}>
                  {submitting ? 'Salvataggio...' : 'Salva segnalazione'}
                </button>
                <button className={`btn btn-secondary w-full ${tablet ? 'text-lg py-3' : ''}`} disabled={submitting || exporting} onClick={finishSegnalazione}>
                  {exporting ? 'Esportazione PDF in corso...' : submitting ? 'Salvataggio...' : 'Termina segnalazione'}
                </button>
                <button
                  className={`btn-secondary w-full flex items-center justify-center gap-2 ${tablet ? 'text-lg py-3' : ''}`}
                  disabled={submitting || exporting}
                  onClick={goBackToCommessa}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Indietro
                </button>
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
