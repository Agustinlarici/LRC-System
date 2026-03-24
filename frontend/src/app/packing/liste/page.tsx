'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';
import { SkeletonTable } from '@/components/ui/Skeleton';

interface PackingList {
  id:               number;
  type:             string | null;
  destination_name: string | null;
  operator_name:    string | null;
  created_at:       string;
  pallets:          number;
  total_items:      number;
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
  id:         number;
  type:       string;
  created_at: string;
  pallets:    Pallet[];
}

interface SummaryItem {
  article_code:   string;
  description:    string | null;
  family:         string | null;
  commessa:       string | null;
  total_quantity: number;
}


function SummaryTable({ dispatchId }: { dispatchId: number }) {
  const [rows, setRows] = useState<SummaryItem[]>([]);

  useEffect(() => {
    api.get<SummaryItem[]>(`/api/pack/packing-lists/${dispatchId}/summary`)
      .then(setRows)
      .catch(console.error);
  }, [dispatchId]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-gray-500">
            <th className="py-2 px-3 text-left font-medium">#</th>
            <th className="py-2 px-3 text-left font-medium">Articolo</th>
            <th className="py-2 px-3 text-left font-medium">Quantità tot.</th>
            <th className="py-2 px-3 text-left font-medium">Commessa</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="py-4 text-center text-gray-400">Caricamento...</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-1.5 px-3 text-gray-400">{i + 1}</td>
              <td className="py-1.5 px-3 font-mono">{r.article_code}</td>
              <td className="py-1.5 px-3">{r.total_quantity}</td>
              <td className="py-1.5 px-3 text-gray-500">{r.commessa || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PackingListePage() {
  const [lists,       setLists]       = useState<PackingList[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expanded,    setExpanded]    = useState<DispatchDetail | null>(null);
  const [viewMode,    setViewMode]    = useState<'detailed' | 'summary'>('detailed');
  const [visibleCount, setVisibleCount] = useState(40);

  useEffect(() => {
    document.title = 'Packing Lists — STR';
    api.get<PackingList[]>('/api/pack/packing-lists')
      .then(data => { setLists(data); setVisibleCount(40); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function toggleExpand(pl: PackingList) {
    if (expanded?.id === pl.id) { setExpanded(null); return; }
    try {
      const detail = await api.get<DispatchDetail>(`/api/pack/packing-lists/${pl.id}`);
      setExpanded(detail);
      setViewMode('detailed');
    } catch (e) { console.error(e); }
  }

  const visible = lists.filter(pl => pl.pallets > 0).slice(0, visibleCount);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Packing Lists</h1>
          <p className="mt-1 text-gray-500">Storico spedizioni</p>
        </div>
        <Link href="/packing/modifica" className="btn-secondary text-sm">
          ✏️ Modifica
        </Link>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-3 px-4 text-left font-medium">#</th>
                <th className="py-3 px-4 text-left font-medium">Destinazione</th>
                <th className="py-3 px-4 text-left font-medium">Tipo</th>
                <th className="py-3 px-4 text-left font-medium">Operatore</th>
                <th className="py-3 px-4 text-left font-medium">Data</th>
                <th className="py-3 px-4 text-center font-medium">Pallet</th>
                <th className="py-3 px-4 text-center font-medium">Tot. pezzi</th>
                <th className="py-3 px-4 text-center font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-gray-400">
                    Nessuna packing list disponibile
                  </td>
                </tr>
              ) : visible.map((pl, idx) => (
                <>
                  <tr key={pl.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-500">{idx + 1}</td>
                    <td className="py-3 px-4 font-medium">{pl.destination_name || '–'}</td>
                    <td className="py-3 px-4 text-gray-500">{pl.type || '–'}</td>
                    <td className="py-3 px-4 text-gray-500">{pl.operator_name || '–'}</td>
                    <td className="py-3 px-4 text-gray-500">{fmtDatetime(pl.created_at)}</td>
                    <td className="py-3 px-4 text-center">{pl.pallets}</td>
                    <td className="py-3 px-4 text-center">{pl.total_items}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => toggleExpand(pl)}
                          className="btn-secondary text-xs px-3 py-1"
                        >
                          {expanded?.id === pl.id ? 'Nascondi' : 'Mostra'}
                        </button>
                        <Link
                          href={`/packing/liste/${pl.id}`}
                          target="_blank"
                          className="btn-secondary text-xs px-3 py-1"
                        >
                          📄 PDF
                        </Link>
                      </div>
                    </td>
                  </tr>

                  {expanded?.id === pl.id && (
                    <tr key={`${pl.id}-detail`}>
                      <td colSpan={8} className="p-4 bg-gray-50 border-b border-gray-200">
                        <div className="flex gap-2 mb-3">
                          <button
                            onClick={() => setViewMode('detailed')}
                            className={`text-xs px-3 py-1 rounded-lg border transition-colors ${viewMode === 'detailed' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                          >
                            Vista dettagliata
                          </button>
                          <button
                            onClick={() => setViewMode('summary')}
                            className={`text-xs px-3 py-1 rounded-lg border transition-colors ${viewMode === 'summary' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                          >
                            Riepilogo articoli
                          </button>
                        </div>

                        {viewMode === 'detailed' ? (
                          expanded.pallets.map(p => (
                            <div key={p.id} className="mb-3">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                Pallet {p.number}
                              </h4>
                              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-100 text-gray-500">
                                      <th className="py-2 px-3 text-left font-medium">#</th>
                                      <th className="py-2 px-3 text-left font-medium">Articolo</th>
                                      <th className="py-2 px-3 text-center font-medium">Q.tà</th>
                                      <th className="py-2 px-3 text-left font-medium">Commessa</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.items.map((it, i) => (
                                      <tr key={it.pallet_item_id} className="border-b border-gray-50">
                                        <td className="py-1.5 px-3 text-gray-400">{i + 1}</td>
                                        <td className="py-1.5 px-3 font-mono">{it.article_code}</td>
                                        <td className="py-1.5 px-3 text-center">{it.quantity}</td>
                                        <td className="py-1.5 px-3 text-gray-500">{it.commessa || '–'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="bg-white rounded-lg border border-gray-200">
                            <SummaryTable dispatchId={pl.id} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lists.filter(pl => pl.pallets > 0).length > visibleCount && (
        <div className="flex justify-center mt-4">
          <button
            className="btn-secondary"
            onClick={() => setVisibleCount(prev => prev + 20)}
          >
            Mostra di più
          </button>
        </div>
      )}
    </div>
  );
}
