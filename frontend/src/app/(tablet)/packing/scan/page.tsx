'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type LabelType = 'MRP' | 'commessa' | 'UDS';

interface ScannedItem {
  id: number;
  article: string;
  quantity: number;
  commessa: string;
  pallet: number;
}

interface ModalState {
  show: boolean;
  message: string;
  onConfirm: (() => Promise<void>) | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normCode(s: string): string {
  return (s || '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/'/g, '-')
    .trim()
    .toUpperCase();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, children, footer, blocking = false, onClose }: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  blocking?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          {!blocking && onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          )}
        </div>
        <div className="px-6 py-4">{children}</div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScanPage() {
  const router = useRouter();

  // Context from localStorage
  const [operatorId,      setOperatorId]      = useState('');
  const [operatorName,    setOperatorName]     = useState('');
  const [dispatchType,    setDispatchType]     = useState('');
  const [destinationId,   setDestinationId]    = useState('');

  // Scan state
  const [labelType,  setLabelType]  = useState<LabelType>('MRP');
  const [article,    setArticle]    = useState('');
  const [quantity,   setQuantity]   = useState('');
  const [commessa,   setCommessa]   = useState('');
  const [uds,        setUds]        = useState('');
  const [items,      setItems]      = useState<ScannedItem[]>([]);
  const [palletNum,  setPalletNum]  = useState(1);

  // Catalog (pre-loaded article sets)
  const [articleSet,     setArticleSet]     = useState<Set<string> | null>(null);
  const [allowedSet,     setAllowedSet]     = useState<Set<string> | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Modals
  const [alertMsg,    setAlertMsg]    = useState('');
  const [showAlert,   setShowAlert]   = useState(false);
  const [articleErr,  setArticleErr]  = useState('');
  const [showArtErr,  setShowArtErr]  = useState(false);
  const [confirmModal, setConfirmModal] = useState<ModalState>({ show: false, message: '', onConfirm: null });

  // "Cambia bancale" modal
  const [showPalletModal,  setShowPalletModal]  = useState(false);
  const [expectedBoxes,    setExpectedBoxes]    = useState('');

  // "Fine scansione" modal
  const [showFinishModal,  setShowFinishModal]  = useState(false);
  const [finishBoxInput,   setFinishBoxInput]   = useState('');

  // Refs
  const articleRef  = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const commessaRef = useRef<HTMLInputElement>(null);
  const udsRef      = useRef<HTMLInputElement>(null);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const opId   = localStorage.getItem('pack_operator_id')   || '';
    const opName = localStorage.getItem('pack_operator_name') || '';
    const dName  = localStorage.getItem('pack_destination_name') || '';
    const dId    = localStorage.getItem('pack_destination_id')   || '';

    setOperatorId(opId);
    setOperatorName(opName);
    setDispatchType(dName);
    setDestinationId(dId);

    // Restore in-progress scan
    try {
      const saved = JSON.parse(localStorage.getItem(`pack_data_${opId}`) || '{}');
      if (saved.items)      setItems(saved.items);
      if (saved.palletNum)  setPalletNum(saved.palletNum);
      if (saved.labelType)  setLabelType(saved.labelType);
    } catch { /* ignore */ }
  }, []);

  // ── Pre-load article catalog ──────────────────────────────────────────────
  useEffect(() => {
    if (!destinationId) return;

    (async () => {
      try {
        const [allCodes, allowed] = await Promise.all([
          api.get<string[]>('/api/pack/articles'),
          api.get<string[]>(`/api/pack/dispatch-destinations/${destinationId}/allowed-articles`),
        ]);
        setArticleSet(new Set(allCodes.map(normCode)));
        setAllowedSet(new Set(allowed.map(normCode)));
      } catch (e) {
        console.error('Errore caricamento catalogo:', e);
      } finally {
        setCatalogLoading(false);
      }
    })();
  }, [destinationId]);

  // Focus first field after catalog loads
  useEffect(() => {
    if (!catalogLoading) setTimeout(() => focusFirstField(), 100);
  }, [catalogLoading, labelType]);

  const focusFirstField = useCallback(() => {
    if (labelType === 'UDS') udsRef.current?.focus();
    else articleRef.current?.focus();
  }, [labelType]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function persistItems(newItems: ScannedItem[], pNum = palletNum, lType = labelType) {
    localStorage.setItem(`pack_data_${operatorId}`, JSON.stringify({
      items: newItems, palletNum: pNum, labelType: lType,
    }));
  }

  async function checkArticleExists(code: string): Promise<boolean> {
    if (articleSet) return articleSet.has(code);
    const data = await api.get<{ exists: boolean }>(`/api/pack/check-article/${encodeURIComponent(code)}`);
    return data.exists;
  }

  async function getOrCreateSession(): Promise<number> {
    const key = `pack_session_id_${operatorId}`;
    const cached = localStorage.getItem(key);
    if (cached) return Number(cached);
    const data = await api.post<{ sessionId: number }>('/api/pack/sessions', { operatorId: Number(operatorId) });
    localStorage.setItem(key, String(data.sessionId));
    return data.sessionId;
  }

  async function getOrCreateDispatch(): Promise<number> {
    const key = `pack_dispatch_id_${operatorId}`;
    const cached = localStorage.getItem(key);
    if (cached) return Number(cached);

    const dId   = localStorage.getItem('pack_destination_id');
    const dName = localStorage.getItem('pack_destination_name');
    if (!dId || !dName) throw new Error('Tipo di spedizione non selezionato');

    const data = await api.post<{ dispatchId: number }>('/api/pack/dispatches', {
      type: dName, destinationId: Number(dId),
    });
    localStorage.setItem(key, String(data.dispatchId));
    return data.dispatchId;
  }

  async function savePallet(dispatchId: number, sessionId: number, currentItems: ScannedItem[]) {
    if (currentItems.length === 0) return;

    const palletData = await api.post<{ palletId: number }>('/api/pack/pallets', {
      dispatchId, sessionId,
    });

    for (const item of currentItems) {
      await api.post('/api/pack/pallet-items', {
        palletId:    palletData.palletId,
        articleCode: item.article,
        quantity:    item.quantity,
        commessa:    item.commessa || null,
      });
    }
  }

  async function checkArticlesForDispatch(currentItems: ScannedItem[], dispatchId: number): Promise<string[]> {
    if (allowedSet && allowedSet.size > 0) {
      return currentItems
        .filter(it => !allowedSet.has(normCode(it.article)))
        .map(it => it.article);
    }
    const invalid: string[] = [];
    for (const item of currentItems) {
      const data = await api.post<{ allowed: boolean }>('/api/pack/check-article-dispatch', {
        articleCode: item.article, dispatchId,
      });
      if (!data.allowed) invalid.push(item.article);
    }
    return invalid;
  }

  // ── Label type change ─────────────────────────────────────────────────────

  function handleLabelChange(type: LabelType) {
    setLabelType(type);
    setArticle(''); setQuantity(''); setCommessa(''); setUds('');
    setTimeout(() => {
      if (type === 'UDS') udsRef.current?.focus();
      else articleRef.current?.focus();
    }, 50);
  }

  // ── Submit scan form ──────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (showAlert || showArtErr) return;

    if (labelType === 'UDS') {
      const cleaned = uds.replace(/'/g, '-');
      const parts   = cleaned.split('§');
      if (parts.length < 2) { setAlertMsg('⚠️ Codice UDS non valido'); setShowAlert(true); return; }
      try {
        const artCode = parts[0].trim().split(' ')[2];
        const qty     = parseInt(parts[1].trim().split(' ')[1]);
        if (!artCode || isNaN(qty)) throw new Error();

        if (!(await checkArticleExists(normCode(artCode)))) {
          setArticleErr(`❌ L'articolo ${artCode} non esiste.`);
          setShowArtErr(true);
          return;
        }
        addItem(normCode(artCode), qty, '');
        setUds('');
        udsRef.current?.focus();
      } catch {
        setAlertMsg('⚠️ Codice UDS non valido'); setShowAlert(true);
      }
      return;
    }

    const cleanArticle  = normCode(article);
    const cleanCommessa = commessa.replace(/'/g, '-').trim();
    const qty           = labelType === 'commessa' ? 1 : Number(quantity);

    if (!cleanArticle || (labelType === 'MRP' && !qty) || (labelType === 'commessa' && !cleanCommessa)) {
      setAlertMsg('⚠️ Dati mancanti'); setShowAlert(true); return;
    }

    if (!(await checkArticleExists(cleanArticle))) {
      setArticleErr(`❌ L'articolo ${cleanArticle} non esiste.`);
      setShowArtErr(true);
      return;
    }

    addItem(cleanArticle, qty, cleanCommessa);
    setArticle(''); setQuantity(''); setCommessa('');
    articleRef.current?.focus();
  }

  function addItem(art: string, qty: number, com: string) {
    const newItems = [...items, { id: Date.now(), article: art, quantity: qty, commessa: com, pallet: palletNum }];
    setItems(newItems);
    persistItems(newItems);
  }

  function removeItem(id: number) {
    const newItems = items.filter(it => it.id !== id);
    setItems(newItems);
    persistItems(newItems);
  }

  // ── Change pallet ─────────────────────────────────────────────────────────

  async function confirmChangePallet() {
    if (isSaving) return;
    const expected = parseInt(expectedBoxes);
    if (expected !== items.length) {
      setAlertMsg(`❌ Hai inserito ${expected} ma hai scansionato ${items.length} scatole. Non corrisponde.`);
      setShowAlert(true);
      return;
    }

    const doSave = async () => {
      setIsSaving(true);
      try {
        const [dispatchId, sessionId] = await Promise.all([getOrCreateDispatch(), getOrCreateSession()]);
        await savePallet(dispatchId, sessionId, items);
        const newItems = [];
        const newPallet = palletNum + 1;
        setItems(newItems);
        setPalletNum(newPallet);
        setExpectedBoxes('');
        setShowPalletModal(false);
        persistItems(newItems, newPallet);
        setTimeout(() => focusFirstField(), 100);
      } finally { setIsSaving(false); }
    };

    setIsSaving(true);
    try {
      const [dispatchId, sessionId] = await Promise.all([getOrCreateDispatch(), getOrCreateSession()]);
      const invalid = await checkArticlesForDispatch(items, dispatchId);

      if (invalid.length > 0) {
        setIsSaving(false);
        setConfirmModal({
          show: true,
          message: `⚠️ Gli articoli seguenti non sono validi per '${dispatchType}':\n${invalid.join(', ')}\n\nVuoi continuare lo stesso?`,
          onConfirm: async () => {
            setIsSaving(true);
            try {
              await savePallet(dispatchId, sessionId, items);
              const newItems = [];
              const newPallet = palletNum + 1;
              setItems(newItems);
              setPalletNum(newPallet);
              setExpectedBoxes('');
              setShowPalletModal(false);
              persistItems(newItems, newPallet);
              setTimeout(() => focusFirstField(), 100);
            } finally { setIsSaving(false); }
          },
        });
        return;
      }
      await doSave();
    } catch (e) {
      console.error(e);
    } finally { setIsSaving(false); }
  }

  // ── Finish scan ───────────────────────────────────────────────────────────

  async function confirmFinish() {
    if (isSaving) return;

    if (items.length > 0) {
      const parsed = parseInt(finishBoxInput);
      if (isNaN(parsed) || parsed !== items.length) {
        setAlertMsg('⚠️ Il numero inserito non corrisponde alle scatole scansionate!');
        setShowAlert(true);
        return;
      }
    }

    const doFinish = async (dispatchId: number, sessionId: number) => {
      await savePallet(dispatchId, sessionId, items);

      // Clear all session data
      localStorage.removeItem(`pack_dispatch_id_${operatorId}`);
      localStorage.removeItem(`pack_session_id_${operatorId}`);
      localStorage.removeItem(`pack_data_${operatorId}`);

      setItems([]);
      setShowFinishModal(false);

      window.open(`/packing/liste/${dispatchId}`, '_blank');
      router.push('/packing');
    };

    setIsSaving(true);
    try {
      const [dispatchId, sessionId] = await Promise.all([getOrCreateDispatch(), getOrCreateSession()]);

      if (items.length > 0) {
        const invalid = await checkArticlesForDispatch(items, dispatchId);
        if (invalid.length > 0) {
          setIsSaving(false);
          setConfirmModal({
            show: true,
            message: `⚠️ Gli articoli seguenti non sono validi per '${dispatchType}':\n${invalid.join(', ')}\n\nVuoi continuare lo stesso?`,
            onConfirm: async () => { await doFinish(dispatchId, sessionId); },
          });
          return;
        }
      }

      await doFinish(dispatchId, sessionId);
    } catch (e) {
      console.error(e);
    } finally { setIsSaving(false); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 p-4">

      {/* Blocking article-error modal */}
      {showArtErr && (
        <Modal title="❌ Articolo inesistente" blocking
          footer={
            <button className="btn-danger" onClick={() => { setShowArtErr(false); focusFirstField(); }}>OK</button>
          }
        >
          <p>{articleErr}</p>
        </Modal>
      )}

      {/* Alert modal */}
      {showAlert && (
        <Modal title="⚠️ Attenzione" onClose={() => { setShowAlert(false); focusFirstField(); }}
          footer={
            <button className="btn-secondary" onClick={() => { setShowAlert(false); focusFirstField(); }}>OK</button>
          }
        >
          <p>{alertMsg}</p>
        </Modal>
      )}

      {/* Confirm modal (invalid articles) */}
      {confirmModal.show && (
        <Modal title="⚠️ Conferma"
          onClose={() => setConfirmModal({ ...confirmModal, show: false })}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setConfirmModal({ ...confirmModal, show: false })}>Annulla</button>
              <button className="btn-danger" onClick={async () => {
                setConfirmModal({ ...confirmModal, show: false });
                await confirmModal.onConfirm?.();
              }}>Continua</button>
            </>
          }
        >
          <p className="whitespace-pre-line">{confirmModal.message}</p>
        </Modal>
      )}

      {/* Change pallet modal */}
      {showPalletModal && (
        <Modal title="Conferma cambio bancale"
          onClose={() => setShowPalletModal(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setShowPalletModal(false)}>Annulla</button>
              <button className="btn-primary" onClick={confirmChangePallet} disabled={isSaving}>
                {isSaving ? 'Salvataggio...' : 'Conferma'}
              </button>
            </>
          }
        >
          <label className="label">Quante scatole hai scansionato?</label>
          <input
            type="number"
            className="input"
            value={expectedBoxes}
            onChange={e => setExpectedBoxes(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmChangePallet()}
            autoFocus
          />
        </Modal>
      )}

      {/* Finish scan modal */}
      {showFinishModal && (
        <Modal title="Conferma scatole"
          onClose={() => setShowFinishModal(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setShowFinishModal(false)}>Annulla</button>
              <button className="btn-primary" onClick={confirmFinish} disabled={isSaving}>
                {isSaving ? 'Salvataggio...' : 'Conferma'}
              </button>
            </>
          }
        >
          {items.length > 0 ? (
            <>
              <p className="text-gray-600 mb-3">Inserisci il numero di scatole per confermare:</p>
              <input
                type="number"
                className="input"
                value={finishBoxInput}
                onChange={e => setFinishBoxInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmFinish()}
                autoFocus
              />
            </>
          ) : (
            <p className="text-gray-600">Nessuna scatola scansionata. Confermi di terminare?</p>
          )}
        </Modal>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">Scansione prodotti</h1>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <span><strong>Operatore:</strong> {operatorName}</span>
            <span><strong>Spedizione:</strong> {dispatchType}</span>
            <span><strong>Bancale:</strong> {palletNum}</span>
          </div>
        </div>
      </div>

      {/* Label type selector */}
      <div className="flex gap-2 mb-4">
        {(['MRP', 'commessa', 'UDS'] as LabelType[]).map(t => (
          <button
            key={t}
            onClick={() => handleLabelChange(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              labelType === t
                ? 'bg-red-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t}
          </button>
        ))}
        {catalogLoading && <span className="text-sm text-gray-400 self-center">Caricamento catalogo...</span>}
      </div>

      {/* Scan form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          {labelType === 'MRP' && (
            <>
              <div className="flex-1 min-w-[200px]">
                <label className="label">Codice articolo</label>
                <input
                  ref={articleRef}
                  className="input"
                  value={article}
                  onChange={e => setArticle(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); quantityRef.current?.focus(); } }}
                />
              </div>
              <div className="w-32">
                <label className="label">Quantità</label>
                <input
                  ref={quantityRef}
                  type="number"
                  className="input"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }}
                />
              </div>
            </>
          )}

          {labelType === 'commessa' && (
            <>
              <div className="flex-1 min-w-[200px]">
                <label className="label">Codice articolo</label>
                <input
                  ref={articleRef}
                  className="input"
                  value={article}
                  onChange={e => setArticle(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commessaRef.current?.focus(); } }}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="label">Commessa</label>
                <input
                  ref={commessaRef}
                  className="input"
                  value={commessa}
                  onChange={e => setCommessa(e.target.value.replace(/'/g, '-'))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }}
                />
              </div>
            </>
          )}

          {labelType === 'UDS' && (
            <div className="flex-1 min-w-[200px]">
              <label className="label">UDS</label>
              <input
                ref={udsRef}
                className="input"
                value={uds}
                onChange={e => setUds(e.target.value.replace(/'/g, '-'))}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }}
              />
            </div>
          )}

          <button type="submit" className="btn-primary whitespace-nowrap" disabled={catalogLoading}>
            Aggiungi
          </button>
        </div>
      </form>

      {/* Scanned items table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Scatole scansionate</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-center">
                <th className="py-2 px-3 font-medium">#</th>
                <th className="py-2 px-3 font-medium text-left">Articolo</th>
                <th className="py-2 px-3 font-medium">Quantità</th>
                <th className="py-2 px-3 font-medium">Commessa</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400">
                    Nessun prodotto scansionato
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="py-2 px-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="py-2 px-3 font-mono">{item.article}</td>
                    <td className="py-2 px-3 text-center">{item.quantity}</td>
                    <td className="py-2 px-3 text-center text-gray-500">{item.commessa || '–'}</td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 border-t border-gray-100">
          <button
            className="btn-secondary"
            onClick={() => { setExpectedBoxes(''); setShowPalletModal(true); }}
          >
            Cambia bancale
          </button>
          <button
            className="btn-primary"
            onClick={() => { setFinishBoxInput(''); setShowFinishModal(true); }}
          >
            Fine scansione
          </button>
        </div>
      </div>
    </div>
  );
}
