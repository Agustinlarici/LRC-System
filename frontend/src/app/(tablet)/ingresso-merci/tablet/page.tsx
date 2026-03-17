'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { IngressoMerci, IngressoMerciStorico } from '@/types';

const REFRESH_INTERVAL = 5000;

const EMPTY_FORM = { materiale: '', mezzo: '', commessa: '', inseritoDa: '', orarioArrivo: '' };

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Tablet Page ──────────────────────────────────────────────────────────────

export default function IngressoMerciTablet() {
  const router = useRouter();
  const [items,   setItems]   = useState<IngressoMerci[]>([]);
  const [loading, setLoading] = useState(true);
  const [modo,    setModo]    = useState<'monitor'>('monitor');
  const [msg,     setMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Conferma arrivo modal
  const [modalItem,  setModalItem]  = useState<IngressoMerci | null>(null);
  const [ricevutoDa, setRicevutoDa] = useState('');
  const [errModal,   setErrModal]   = useState('');
  const [loadModal,  setLoadModal]  = useState(false);

  // Storico modal
  const [showStorico,    setShowStorico]    = useState(false);
  const [storico,        setStorico]        = useState<IngressoMerciStorico[]>([]);
  const [loadingStorico, setLoadingStorico] = useState(false);

  // Form
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [errForm, setErrForm] = useState('');
  const [sending, setSending] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setItems(await api.get<IngressoMerci[]>('/api/ingresso-merci'));
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  // Auto-refresh ogni 5s
  useEffect(() => {
    fetchItems();
    const t = setInterval(fetchItems, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [fetchItems]);

  async function fetchStorico() {
    setLoadingStorico(true);
    try { setStorico(await api.get<IngressoMerciStorico[]>('/api/ingresso-merci/storico')); }
    catch (_) {}
    finally { setLoadingStorico(false); }
  }

  function openModal(item: IngressoMerci) {
    setModalItem(item);
    setRicevutoDa('');
    setErrModal('');
  }

  async function confermaArrivo() {
    if (!ricevutoDa.trim()) { setErrModal('Inserisci il nome di chi ha ricevuto.'); return; }
    setLoadModal(true);
    try {
      await api.post(`/api/ingresso-merci/${modalItem!.id}/arrivato`, { ricevutoDa: ricevutoDa.trim() });
      setItems(prev => prev.filter(m => m.id !== modalItem!.id));
      setModalItem(null);
      setMsg({ type: 'ok', text: 'Materiale segnato come arrivato.' });
      setTimeout(() => setMsg(null), 3000);
    } catch (e) {
      setErrModal(e instanceof Error ? e.message : 'Errore');
    } finally { setLoadModal(false); }
  }

  async function handleInvia(e: React.FormEvent) {
    e.preventDefault();
    if (!form.materiale.trim() || !form.mezzo.trim() || !form.inseritoDa.trim() || !form.orarioArrivo) {
      setErrForm('Articolo, Mezzo, Orario arrivo e Inserito da sono obbligatori.');
      return;
    }
    setSending(true);
    try {
      await api.post('/api/ingresso-merci', {
        materiale: form.materiale, mezzo: form.mezzo,
        commessa: form.commessa || null,
        inseritoDa: form.inseritoDa, orarioArrivo: form.orarioArrivo,
      });
      setForm(prev => ({ ...EMPTY_FORM, inseritoDa: prev.inseritoDa }));
      setModo('monitor');
      fetchItems();
    } catch (e) {
      setErrForm(e instanceof Error ? e.message : 'Errore');
    } finally { setSending(false); }
  }

  function isScaduto(orarioArrivo: string) {
    return orarioArrivo && new Date(orarioArrivo) < new Date();
  }

  // ── FORM INPUT ──────────────────────────────────────────────────────────────
  if (modo === 'input') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-lg bg-white rounded-xl shadow-md p-8">
          <h2 className="text-2xl font-bold text-center mb-6">Materiale urgente in arrivo</h2>
          <form onSubmit={handleInvia} className="space-y-4">
            <div>
              <label className="label">Articolo *</label>
              <textarea rows={3} className="input" value={form.materiale}
                onChange={e => setForm(p => ({ ...p, materiale: e.target.value }))}
                placeholder="es. Par Ant (055005897)" autoFocus />
            </div>
            <div>
              <label className="label">Mezzo *</label>
              <input type="text" className="input" value={form.mezzo}
                onChange={e => setForm(p => ({ ...p, mezzo: e.target.value }))}
                placeholder="es. Salvatore" />
            </div>
            <div>
              <label className="label">Data e ora arrivo *</label>
              <input type="datetime-local" className="input" value={form.orarioArrivo}
                onChange={e => setForm(p => ({ ...p, orarioArrivo: e.target.value }))} />
            </div>
            <div>
              <label className="label">Commessa <span className="font-normal text-gray-400">(opzionale)</span></label>
              <input type="text" className="input" value={form.commessa}
                onChange={e => setForm(p => ({ ...p, commessa: e.target.value }))}
                placeholder="es. 405450" />
            </div>
            <div>
              <label className="label">Inserito da *</label>
              <input type="text" className="input" value={form.inseritoDa}
                onChange={e => setForm(p => ({ ...p, inseritoDa: e.target.value }))}
                placeholder="es. Agustin" />
            </div>
            {errForm && <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{errForm}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setModo('monitor')}>Annulla</button>
              <button type="submit" disabled={sending} className="btn-danger">
                {sending ? 'Invio...' : 'Conferma'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── MONITOR ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4">

      {/* Conferma arrivo modal */}
      {modalItem && (
        <Modal
          title="Conferma ricezione"
          onClose={() => setModalItem(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setModalItem(null)}>Annulla</button>
              <button className="btn-primary" onClick={confermaArrivo} disabled={loadModal}>
                {loadModal ? 'Salvataggio...' : '✓ Conferma arrivo'}
              </button>
            </>
          }
        >
          <p className="text-gray-500 mb-4 font-medium">{modalItem.materiale}</p>
          <label className="label">Ricevuto da...</label>
          <input
            type="text"
            className="input"
            value={ricevutoDa}
            onChange={e => { setRicevutoDa(e.target.value); setErrModal(''); }}
            placeholder="es. Marco"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && confermaArrivo()}
          />
          {errModal && <p className="text-red-600 text-sm mt-2">{errModal}</p>}
        </Modal>
      )}

      {/* Storico modal */}
      {showStorico && (
        <Modal
          title="Storico arrivi"
          onClose={() => setShowStorico(false)}
          footer={
            <>
              <button className="btn-secondary text-sm" onClick={fetchStorico}>Aggiorna</button>
              <button className="btn-secondary" onClick={() => setShowStorico(false)}>Chiudi</button>
            </>
          }
        >
          <div className="max-h-[60vh] overflow-auto">
            {loadingStorico ? (
              <p className="text-center py-4 text-gray-400">Caricamento...</p>
            ) : storico.length === 0 ? (
              <p className="text-gray-400 text-center py-4">Nessun arrivo registrato.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="pb-2 pr-3 text-left font-medium">Ricevuto il</th>
                    <th className="pb-2 pr-3 text-left font-medium">Articolo</th>
                    <th className="pb-2 pr-3 text-left font-medium">Mezzo</th>
                    <th className="pb-2 pr-3 text-center font-medium">Commessa</th>
                    <th className="pb-2 pr-3 text-center font-medium">Inserito da</th>
                    <th className="pb-2 text-center font-medium">Ricevuto da</th>
                  </tr>
                </thead>
                <tbody>
                  {storico.map(s => (
                    <tr key={s.id} className="border-b border-gray-100">
                      <td className="py-2 pr-3 text-gray-500 text-xs">{s.timestampRicezione}</td>
                      <td className="py-2 pr-3">{s.materiale}</td>
                      <td className="py-2 pr-3">{s.mezzo}</td>
                      <td className="py-2 pr-3 text-center">
                        {s.commessa
                          ? <span className="bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded">{s.commessa}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-center text-gray-500">{s.inseritoDa}</td>
                      <td className="py-2 text-center font-medium">{s.ricevutoDa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span className="text-2xl font-bold text-gray-900">Materiale urgente in arrivo</span>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-sm" onClick={fetchItems}>Aggiorna</button>
            <button className="btn-secondary text-sm" onClick={() => { setShowStorico(true); fetchStorico(); }}>
              Storico
            </button>
            <button
              className="btn-secondary p-2"
              onClick={() => router.push('/ingresso-merci')}
              title="Torna alla vista normale"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Alert */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        {loading ? (
          <p className="text-center py-10 text-gray-400">Caricamento...</p>
        ) : items.length === 0 ? (
          <p className="text-center py-10 text-gray-400">Nessun materiale urgente in attesa.</p>
        ) : (
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 text-center">
                <th className="py-3 px-4 font-medium">Data e ora arrivo</th>
                <th className="py-3 px-4 font-medium text-left">Articolo</th>
                <th className="py-3 px-4 font-medium">Mezzo</th>
                <th className="py-3 px-4 font-medium">Commessa</th>
                <th className="py-3 px-4 font-medium">Inserito da</th>
                <th className="py-3 px-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 ${isScaduto(item.orarioArrivo) ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="py-3 px-4 text-center font-medium">{item.orarioArrivo}</td>
                  <td className="py-3 px-4">{item.materiale}</td>
                  <td className="py-3 px-4 text-center">{item.mezzo}</td>
                  <td className="py-3 px-4 text-center">
                    {item.commessa
                      ? <span className="bg-gray-200 text-gray-700 text-sm px-2 py-0.5 rounded">{item.commessa}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-500">{item.inseritoDa}</td>
                  <td className="py-3 px-4 text-center">
                    <button
                      className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                      onClick={() => openModal(item)}
                    >
                      Arrivato
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
