'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface DispatchOption {
  id:          number;
  type:        string;
  created_at:  string;
  pallets:     number;
  total_items: number;
}

interface PalletItem {
  pallet_item_id: number;
  article_code:   string;
  description:    string | null;
  quantity:       number;
  commessa:       string | null;
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

interface NewItemState {
  article_code: string;
  quantity:     string;
  commessa:     string;
}

function fmtDate(raw: string) {
  const d = new Date(raw);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} – ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ModificaPackingListPage() {
  const [dispatches,        setDispatches]        = useState<DispatchOption[]>([]);
  const [selectedId,        setSelectedId]        = useState('');
  const [detail,            setDetail]            = useState<DispatchDetail | null>(null);
  const [loadingList,       setLoadingList]       = useState(false);
  const [loadingDetail,     setLoadingDetail]     = useState(false);
  const [savingItemId,      setSavingItemId]      = useState<number | null>(null);
  const [deletingItemId,    setDeletingItemId]    = useState<number | null>(null);
  const [deletingPalletId,  setDeletingPalletId]  = useState<number | null>(null);
  const [newItems,          setNewItems]          = useState<Record<number, NewItemState>>({});

  // Local edits buffer
  const [localItems, setLocalItems] = useState<Record<number, PalletItem>>({});

  useEffect(() => { document.title = 'Modifica Packing — STR'; }, []);

  useEffect(() => {
    setLoadingList(true);
    api.get<DispatchOption[]>('/api/pack/packing-lists')
      .then(setDispatches)
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, []);

  async function loadDetail(id: string) {
    if (!id) return;
    setLoadingDetail(true);
    setLocalItems({});
    try {
      const d = await api.get<DispatchDetail>(`/api/pack/packing-lists/${id}`);
      setDetail(d);
      // Init local items buffer
      const buf: Record<number, PalletItem> = {};
      d.pallets.forEach(p => p.items.forEach(it => { buf[it.pallet_item_id] = { ...it }; }));
      setLocalItems(buf);
    } catch (e) { console.error(e); }
    finally { setLoadingDetail(false); }
  }

  function updateLocalItem(itemId: number, field: keyof PalletItem, value: string | number) {
    setLocalItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  }

  async function saveItem(item: PalletItem) {
    setSavingItemId(item.pallet_item_id);
    try {
      await api.patch(`/api/pack/pallet-items/${item.pallet_item_id}`, {
        articleCode: item.article_code,
        quantity:    Number(item.quantity),
        commessa:    item.commessa || null,
      });
      await loadDetail(selectedId);
    } catch (e) { console.error(e); alert('Errore nel salvataggio'); }
    finally { setSavingItemId(null); }
  }

  async function deleteItem(itemId: number) {
    if (!confirm('Sei sicuro di voler eliminare questo articolo dal bancale?')) return;
    setDeletingItemId(itemId);
    try {
      await api.delete(`/api/pack/pallet-items/${itemId}`);
      setDetail(prev => prev ? {
        ...prev,
        pallets: prev.pallets.map(p => ({
          ...p,
          items: p.items.filter(it => it.pallet_item_id !== itemId),
        })),
      } : null);
    } catch (e) { console.error(e); alert('Errore nella cancellazione'); }
    finally { setDeletingItemId(null); }
  }

  function updateNewItem(palletId: number, field: keyof NewItemState, value: string) {
    setNewItems(prev => ({
      ...prev,
      [palletId]: { ...(prev[palletId] || { article_code: '', quantity: '', commessa: '' }), [field]: value },
    }));
  }

  async function addNewItem(palletId: number) {
    const ni = newItems[palletId] || {};
    const articleCode = (ni.article_code || '').trim();
    const quantity    = Number(ni.quantity || 0);
    const commessa    = (ni.commessa || '').trim();

    if (!articleCode || quantity <= 0) { alert('Articolo e quantità sono obbligatori'); return; }

    try {
      await api.post('/api/pack/pallet-items', {
        palletId: palletId, articleCode, quantity, commessa: commessa || null,
      });
      setNewItems(prev => ({ ...prev, [palletId]: { article_code: '', quantity: '', commessa: '' } }));
      await loadDetail(selectedId);
    } catch (e) { console.error(e); alert("Errore nell'inserimento"); }
  }

  async function deletePallet(palletId: number) {
    if (!confirm('Sei sicuro di voler eliminare questo bancale e tutti i suoi articoli?')) return;
    setDeletingPalletId(palletId);
    try {
      await api.delete(`/api/pack/pallets/${palletId}`);
      setDetail(prev => prev ? {
        ...prev,
        pallets: prev.pallets.filter(p => p.id !== palletId),
      } : null);
    } catch (e) { console.error(e); alert('Errore nella cancellazione del bancale'); }
    finally { setDeletingPalletId(null); }
  }

  async function addPallet() {
    if (!detail) return;
    try {
      await api.post(`/api/pack/packing-lists/${detail.id}/pallets`, {});
      await loadDetail(selectedId);
    } catch (e) { console.error(e); alert('Errore nella creazione del bancale'); }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Modifica Packing List</h1>
      </div>

      {/* Dispatch selector */}
      <div className="card mb-6">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="label">Seleziona spedizione</label>
            <select
              className="input"
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setDetail(null); loadDetail(e.target.value); }}
            >
              <option value="">-- Scegli una spedizione --</option>
              {dispatches.map(d => (
                <option key={d.id} value={d.id}>
                  {d.id} – {d.type} – {fmtDate(d.created_at)}
                </option>
              ))}
            </select>
          </div>
          {loadingList && <span className="text-sm text-gray-400 pb-2">Caricamento...</span>}
        </div>
      </div>

      {loadingDetail && <p className="text-center text-gray-400 py-8">Caricamento...</p>}

      {detail && !loadingDetail && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Spedizione #{detail.id} – {detail.type}
            </h2>
            <button onClick={addPallet} className="btn-primary text-sm">
              + Aggiungi bancale
            </button>
          </div>

          {detail.pallets.map(pallet => (
            <div key={pallet.id} className="card mb-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Bancale {pallet.number}</span>
                <button
                  className="text-gray-400 hover:text-red-500 text-xs px-2 py-1 transition-colors disabled:opacity-50"
                  onClick={() => deletePallet(pallet.id)}
                  disabled={deletingPalletId === pallet.id}
                  title="Elimina bancale"
                >
                  {deletingPalletId === pallet.id ? '...' : '🗑 Elimina bancale'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500">
                      <th className="py-2 px-2 text-left font-medium">ID</th>
                      <th className="py-2 px-2 text-left font-medium">Articolo</th>
                      <th className="py-2 px-2 text-left font-medium">Descrizione</th>
                      <th className="py-2 px-2 text-left font-medium">Q.tà</th>
                      <th className="py-2 px-2 text-left font-medium">Commessa</th>
                      <th className="py-2 px-2 font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pallet.items.map(item => {
                      const local = localItems[item.pallet_item_id] ?? item;
                      return (
                        <tr key={item.pallet_item_id} className="border-b border-gray-50">
                          <td className="py-2 px-2 text-gray-400">{item.pallet_item_id}</td>
                          <td className="py-2 px-2">
                            <input
                              className="input text-xs py-1"
                              value={local.article_code}
                              onChange={e => updateLocalItem(item.pallet_item_id, 'article_code', e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2 text-gray-500 text-xs">{item.description || '–'}</td>
                          <td className="py-2 px-2 w-20">
                            <input
                              type="number"
                              className="input text-xs py-1"
                              value={local.quantity}
                              onChange={e => updateLocalItem(item.pallet_item_id, 'quantity', Number(e.target.value))}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              className="input text-xs py-1"
                              value={local.commessa ?? ''}
                              onChange={e => updateLocalItem(item.pallet_item_id, 'commessa', e.target.value)}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex gap-1">
                              <button
                                className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1 rounded transition-colors disabled:opacity-50"
                                onClick={() => saveItem(local)}
                                disabled={savingItemId === item.pallet_item_id}
                              >
                                {savingItemId === item.pallet_item_id ? '...' : 'Salva'}
                              </button>
                              <button
                                className="text-gray-400 hover:text-red-500 text-xs px-2 py-1 transition-colors disabled:opacity-50"
                                onClick={() => deleteItem(item.pallet_item_id)}
                                disabled={deletingItemId === item.pallet_item_id}
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {/* New item row */}
                    <tr className="border-t border-gray-200 bg-gray-50">
                      <td className="py-2 px-2 text-xs text-gray-400">Nuovo</td>
                      <td className="py-2 px-2">
                        <input
                          className="input text-xs py-1"
                          placeholder="Articolo"
                          value={newItems[pallet.id]?.article_code || ''}
                          onChange={e => updateNewItem(pallet.id, 'article_code', e.target.value)}
                        />
                      </td>
                      <td className="py-2 px-2 text-gray-400 text-xs">–</td>
                      <td className="py-2 px-2 w-20">
                        <input
                          type="number"
                          className="input text-xs py-1"
                          placeholder="Q.tà"
                          value={newItems[pallet.id]?.quantity || ''}
                          onChange={e => updateNewItem(pallet.id, 'quantity', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); addNewItem(pallet.id); } }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          className="input text-xs py-1"
                          placeholder="Commessa (opzionale)"
                          value={newItems[pallet.id]?.commessa || ''}
                          onChange={e => updateNewItem(pallet.id, 'commessa', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); addNewItem(pallet.id); } }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <button
                          className="btn-primary text-xs px-2 py-1"
                          onClick={() => addNewItem(pallet.id)}
                        >
                          + Aggiungi
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
