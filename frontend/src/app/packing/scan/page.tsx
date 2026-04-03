'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type LabelType = 'MRP' | 'commessa' | 'UDS';

interface PalletItem {
  pallet_item_id:    number;
  article_code:      string;
  quantity:          number;
  commessa:          string | null;
  dest_error?:       boolean;  // true = destinazione non permessa
}

interface Pallet {
  id:     number;
  number: number;
  items:  PalletItem[];
}

interface DispatchDetail {
  id:      number;
  type:    string;
  pallets: Pallet[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normCode(s: string): string {
  return (s || '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/'/g, '-')
    .trim()
    .toUpperCase();
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ show, title, children, footer }: {
  show: boolean;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
        </div>
        <div className="px-6 py-4">{children}</div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

function ScanPage() {
  const router     = useRouter();
  const params     = useSearchParams();
  const dispatchId = Number(params.get('dispatch'));
  const sessionId  = Number(params.get('session'));
  const initPallet = Number(params.get('pallet'));
  const operatore  = params.get('operator') ?? '';
  const destination = params.get('destination') ?? '';

  // Catalog
  const [articleSet,    setArticleSet]    = useState<Set<string> | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Dispatch
  const [dispatch,      setDispatch]      = useState<DispatchDetail | null>(null);
  const [activePalletId, setActivePalletId] = useState(initPallet);
  const [loading,       setLoading]       = useState(true);

  // Form
  const [labelType, setLabelType] = useState<LabelType>('MRP');
  const [article,   setArticle]   = useState('');
  const [quantity,  setQuantity]  = useState('');
  const [commessa,  setCommessa]  = useState('');
  const [uds,       setUds]       = useState('');

  // Items con errore destinazione (pallet_item_id → article_code)
  const [destErrors,           setDestErrors]            = useState<Record<number, string>>({});

  // Modals
  const [articleErrorMsg,      setArticleErrorMsg]       = useState('');
  const [showArticleError,     setShowArticleError]      = useState(false);
  const [showCambiaBancale,    setShowCambiaBancale]     = useState(false);
  const [showFineScansione,    setShowFineScansione]     = useState(false);
  const [showDestWarning,      setShowDestWarning]       = useState(false);
  const [destWarningAction,    setDestWarningAction]     = useState<'cambia' | 'fine'>('cambia');
  const [expectedBoxes,        setExpectedBoxes]         = useState('');
  const [confirmCount,         setConfirmCount]          = useState('');
  const [alertMsg,             setAlertMsg]              = useState('');
  const [showAlert,            setShowAlert]             = useState(false);
  const [isSaving,             setIsSaving]              = useState(false);

  const articleRef  = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const commessaRef = useRef<HTMLInputElement>(null);
  const udsRef      = useRef<HTMLInputElement>(null);
  const boxesRef    = useRef<HTMLInputElement>(null);
  const confirmRef  = useRef<HTMLInputElement>(null);

  const activePallet = dispatch?.pallets.find(p => p.id === activePalletId) ?? null;

  useEffect(() => { document.title = 'Scansione — STR'; }, []);

  // Load article catalog
  useEffect(() => {
    api.get<string[]>('/api/pack/articles')
      .then(data => {
        const s = new Set(data.map(code => normCode(code)));
        setArticleSet(s);
      })
      .catch(() => setArticleSet(new Set()))
      .finally(() => setCatalogLoading(false));
  }, []);

  // Load dispatch
  const fetchDispatch = useCallback(async () => {
    if (!dispatchId) { router.push('/packing/operatore'); return; }
    try {
      const d = await api.get<DispatchDetail>(`/api/pack/packing-lists/${dispatchId}`);
      setDispatch(d);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [dispatchId, router]);

  useEffect(() => { fetchDispatch(); }, [fetchDispatch]);

  // Focus first field on label type change
  useEffect(() => {
    setTimeout(() => {
      if (labelType === 'UDS') udsRef.current?.focus();
      else articleRef.current?.focus();
    }, 50);
  }, [labelType]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function showAlertModal(msg: string) {
    setAlertMsg(msg);
    setShowAlert(true);
  }

  function checkArticleExists(code: string): boolean {
    if (!articleSet) return true; // catalog not loaded yet, allow
    return articleSet.has(normCode(code));
  }

  // ─── Submit form ────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (showAlert || showArticleError) return;

    if (labelType === 'UDS') {
      const cleaned = uds.replace(/'/g, '-');
      const partes  = cleaned.split('§');
      if (partes.length < 2) { showAlertModal('⚠️ Codice UDS non valido'); return; }
      try {
        const codice = partes[0].trim().split(' ')[2];
        const qty    = parseInt(partes[1].trim().split(' ')[1]);
        if (!codice || isNaN(qty)) { showAlertModal('⚠️ Codice UDS non valido'); return; }
        if (!checkArticleExists(codice)) {
          setArticleErrorMsg(`❌ L'articolo ${codice} non esiste.`);
          setShowArticleError(true);
          return;
        }
        await saveItem(codice, qty, '');
        setUds('');
        udsRef.current?.focus();
      } catch {
        showAlertModal('⚠️ Codice UDS non valido');
      }
      return;
    }

    const cleanArticle  = normCode(article);
    const cleanCommessa = commessa.replace(/'/g, '-').trim();
    const qty = labelType === 'commessa' ? 1 : parseInt(quantity);

    if (!cleanArticle) { showAlertModal('⚠️ Inserisci il codice articolo'); return; }
    if (labelType === 'MRP' && (!qty || isNaN(qty))) { showAlertModal('⚠️ Inserisci la quantità'); return; }
    if (labelType === 'commessa' && !cleanCommessa) { showAlertModal('⚠️ Inserisci la commessa'); return; }

    if (!checkArticleExists(cleanArticle)) {
      setArticleErrorMsg(`❌ L'articolo ${cleanArticle} non esiste.`);
      setShowArticleError(true);
      return;
    }

    await saveItem(cleanArticle, qty, cleanCommessa);
    setArticle(''); setQuantity(''); setCommessa('');
    articleRef.current?.focus();
  }

  async function saveItem(code: string, qty: number, comm: string) {
    try {
      // Check destination — non-blocking, just mark error if not allowed
      const check = await api.post<{ allowed: boolean }>('/api/pack/check-article-dispatch', {
        articleCode: code,
        dispatchId:  dispatchId,
      }).catch(() => ({ allowed: true })); // if check fails, allow anyway

      const [row] = await Promise.all([
        api.post<{ id: number }>('/api/pack/pallet-items', {
          palletId:    activePalletId,
          articleCode: code,
          quantity:    qty,
          commessa:    comm || null,
        }),
      ]);

      if (!check.allowed) {
        setDestErrors(prev => ({ ...prev, [row.id]: code }));
      }

      fetchDispatch();
    } catch {
      showAlertModal('❌ Errore durante il salvataggio dell\'articolo');
    }
  }

  async function eliminaItem(id: number) {
    await api.delete(`/api/pack/pallet-items/${id}`);
    setDestErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    fetchDispatch();
  }

  function getDestErrorItems(): string[] {
    const palletItems = activePallet?.items ?? [];
    return palletItems
      .filter(it => destErrors[it.pallet_item_id])
      .map(it => it.article_code)
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  }

  // ─── Dest warning → continua verso cambia/fine ──────────────────────────────

  function openCambiaBancale() {
    const errors = getDestErrorItems();
    if (errors.length > 0) {
      setDestWarningAction('cambia');
      setShowDestWarning(true);
    } else {
      setExpectedBoxes('');
      setShowCambiaBancale(true);
      setTimeout(() => boxesRef.current?.focus(), 100);
    }
  }

  function openFineScansione() {
    const errors = getDestErrorItems();
    if (errors.length > 0) {
      setDestWarningAction('fine');
      setShowDestWarning(true);
    } else {
      setConfirmCount('');
      setShowFineScansione(true);
      setTimeout(() => confirmRef.current?.focus(), 100);
    }
  }

  function continueAfterWarning() {
    setShowDestWarning(false);
    if (destWarningAction === 'cambia') {
      setExpectedBoxes('');
      setShowCambiaBancale(true);
      setTimeout(() => boxesRef.current?.focus(), 100);
    } else {
      setConfirmCount('');
      setShowFineScansione(true);
      setTimeout(() => confirmRef.current?.focus(), 100);
    }
  }

  // ─── Cambia bancale ─────────────────────────────────────────────────────────

  async function confirmCambiaBancale() {
    if (isSaving) return;
    const expected = parseInt(expectedBoxes);
    const actual   = activePallet?.items.length ?? 0;
    if (isNaN(expected) || expected !== actual) {
      showAlertModal(`❌ Hai inserito ${expected} ma hai scansionato ${actual} scatole. Non corrisponde.`);
      return;
    }
    setIsSaving(true);
    try {
      const res = await api.post<{ palletId: number }>('/api/pack/pallets', { dispatchId, sessionId });
      setActivePalletId(res.palletId);
      setExpectedBoxes('');
      setShowCambiaBancale(false);
      await fetchDispatch();
      setTimeout(() => (labelType === 'UDS' ? udsRef : articleRef).current?.focus(), 100);
    } catch {
      showAlertModal('❌ Errore nella creazione del bancale');
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Fine scansione ─────────────────────────────────────────────────────────

  async function confirmFineScansione() {
    if (isSaving) return;
    const expected = parseInt(confirmCount);
    const actual   = activePallet?.items.length ?? 0;
    if (isNaN(expected) || expected !== actual) {
      showAlertModal(`⚠️ Il numero inserito non corrisponde alle scatole scansionate!`);
      return;
    }
    setIsSaving(true);
    try {
      setShowFineScansione(false);
      window.open(`/packing/liste/${dispatchId}`, '_blank');
      router.push('/packing/operatore');
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading || catalogLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-lg">Caricamento...</p>
      </div>
    );
  }

  const palletItems = activePallet?.items ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-4">Scansione prodotti</h2>

        <div className="flex flex-wrap gap-6 mb-4 text-sm text-gray-700">
          <span><strong>Operatore:</strong> {operatore || '—'}</span>
          <span><strong>Tipo spedizione:</strong> {destination || dispatch?.type || '—'}</span>
          <span><strong>Bancale attuale:</strong> {activePallet?.number ?? '?'}</span>
        </div>

        {/* Label type selector */}
        <div className="flex justify-center gap-2 mb-4">
          {(['MRP', 'commessa', 'UDS'] as LabelType[]).map(t => (
            <button
              key={t}
              onClick={() => { setLabelType(t); setArticle(''); setQuantity(''); setCommessa(''); setUds(''); }}
              className={`px-6 py-2 rounded font-medium border transition-all ${
                labelType === t
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">

            {labelType === 'MRP' && <>
              <div className="flex-1 min-w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Codice articolo</label>
                <input
                  ref={articleRef}
                  autoFocus
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                  value={article}
                  onChange={e => setArticle(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); quantityRef.current?.focus(); } }}
                />
              </div>
              <div className="w-32">
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantità</label>
                <input
                  ref={quantityRef}
                  type="number"
                  min={1}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } }}
                />
              </div>
            </>}

            {labelType === 'commessa' && <>
              <div className="flex-1 min-w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Codice articolo</label>
                <input
                  ref={articleRef}
                  autoFocus
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                  value={article}
                  onChange={e => setArticle(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commessaRef.current?.focus(); } }}
                />
              </div>
              <div className="flex-1 min-w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">Commessa</label>
                <input
                  ref={commessaRef}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                  value={commessa}
                  onChange={e => setCommessa(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } }}
                />
              </div>
            </>}

            {labelType === 'UDS' && (
              <div className="flex-1 min-w-64">
                <label className="block text-sm font-medium text-gray-700 mb-1">UDS</label>
                <input
                  ref={udsRef}
                  autoFocus
                  className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                  value={uds}
                  onChange={e => setUds(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } }}
                />
              </div>
            )}

            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700 transition-all"
            >
              Aggiungi
            </button>
          </div>
        </form>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h5 className="font-semibold text-gray-900">Scatole scansionate</h5>
            <span className="text-sm text-gray-500">{palletItems.length} scatol{palletItems.length === 1 ? 'a' : 'e'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-gray-600">
                  <th className="py-2 px-3 text-left w-10">#</th>
                  <th className="py-2 px-3 text-left">Articolo</th>
                  <th className="py-2 px-3 text-center w-20">Quantità</th>
                  <th className="py-2 px-3 text-left">Commessa</th>
                  <th className="py-2 px-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {palletItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">Nessun prodotto scansionato</td>
                  </tr>
                ) : palletItems.map((item, i) => {
                  const hasDestError = !!destErrors[item.pallet_item_id];
                  return (
                  <tr key={item.pallet_item_id} className={`border-b border-gray-100 ${hasDestError ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td className="py-2 px-3 text-gray-500">{i + 1}</td>
                    <td className="py-2 px-3 font-mono font-medium" style={{ color: hasDestError ? '#dc2626' : undefined }}>
                      {item.article_code}
                      {hasDestError && <span className="ml-2 text-xs font-normal">⚠ dest. errata</span>}
                    </td>
                    <td className="py-2 px-3 text-center text-gray-900">{item.quantity}</td>
                    <td className="py-2 px-3 text-gray-600">{item.commessa || '—'}</td>
                    <td className="py-2 px-3">
                      <button onClick={() => eliminaItem(item.pallet_item_id)} className="text-red-500 hover:text-red-700 text-lg leading-none">🗑</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
            <button
              onClick={openCambiaBancale}
              className="bg-gray-500 text-white px-4 py-2 rounded font-medium hover:bg-gray-600 transition-all"
            >
              Cambia bancale
            </button>
            <button
              onClick={openFineScansione}
              className="bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700 transition-all"
            >
              Fine scansione
            </button>
          </div>
        </div>

      </div>

      {/* Modal: Cambia bancale */}
      <Modal
        show={showCambiaBancale}
        title="Conferma cambio bancale"
        footer={<>
          <button onClick={() => setShowCambiaBancale(false)} className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Annulla</button>
          <button onClick={confirmCambiaBancale} disabled={isSaving} className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50">
            {isSaving ? 'Salvataggio...' : 'Conferma'}
          </button>
        </>}
      >
        <label className="block text-sm font-medium text-gray-700 mb-2">Quante scatole hai scansionato?</label>
        <input
          ref={boxesRef}
          type="number"
          min={0}
          className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
          value={expectedBoxes}
          onChange={e => setExpectedBoxes(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmCambiaBancale(); }}
        />
      </Modal>

      {/* Modal: Fine scansione */}
      <Modal
        show={showFineScansione}
        title="Conferma scatole"
        footer={<>
          <button onClick={() => setShowFineScansione(false)} className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Annulla</button>
          <button onClick={confirmFineScansione} disabled={isSaving} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
            {isSaving ? 'Salvataggio...' : 'Conferma'}
          </button>
        </>}
      >
        <label className="block text-sm font-medium text-gray-700 mb-2">Inserisci il numero di scatole per confermare:</label>
        <input
          ref={confirmRef}
          type="number"
          min={0}
          className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
          value={confirmCount}
          onChange={e => setConfirmCount(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmFineScansione(); }}
        />
      </Modal>

      {/* Modal: Articoli con destinazione errata */}
      <Modal
        show={showDestWarning}
        title="⚠️ Articoli con destinazione errata"
        footer={<>
          <button
            onClick={() => { setShowDestWarning(false); setTimeout(() => (labelType === 'UDS' ? udsRef : articleRef).current?.focus(), 50); }}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Torna alla scansione
          </button>
          <button
            onClick={continueAfterWarning}
            className="px-4 py-2 rounded bg-orange-500 text-white hover:bg-orange-600"
          >
            Continua comunque
          </button>
        </>}
      >
        <p className="text-sm text-gray-700 mb-3">
          I seguenti articoli <strong>non sono permessi</strong> per la destinazione <strong>"{destination}"</strong>:
        </p>
        <ul className="text-sm space-y-1 mb-3">
          {getDestErrorItems().map(code => (
            <li key={code} className="flex items-center gap-2 text-red-700 font-mono font-medium">
              <span className="text-red-500">✕</span> {code}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Puoi tornare alla scansione e rimuoverli, oppure continuare comunque.</p>
      </Modal>

      {/* Modal: Articolo inesistente (bloccante) */}
      <Modal
        show={showArticleError}
        title="❌ Articolo inesistente"
        footer={
          <button onClick={() => { setShowArticleError(false); setTimeout(() => (labelType === 'UDS' ? udsRef : articleRef).current?.focus(), 50); }}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700">
            OK
          </button>
        }
      >
        <p>{articleErrorMsg}</p>
      </Modal>

      {/* Modal: Alert generico */}
      <Modal
        show={showAlert}
        title="⚠️ Attenzione"
        footer={
          <button onClick={() => { setShowAlert(false); setTimeout(() => (labelType === 'UDS' ? udsRef : articleRef).current?.focus(), 50); }}
            className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
            OK
          </button>
        }
      >
        <p>{alertMsg}</p>
      </Modal>
    </div>
  );
}

export default function ScanPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Caricamento...</p></div>}>
      <ScanPage />
    </Suspense>
  );
}
