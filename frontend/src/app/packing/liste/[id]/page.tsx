'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

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

interface Dispatch {
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

interface CommessaGroup {
  commessa_group: number;
  group_name:     string;
  commesse:       string;
}

function fmtDate(raw: string) {
  const d = new Date(raw);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export default function PackingListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dispatch,       setDispatch]       = useState<Dispatch | null>(null);
  const [summary,        setSummary]        = useState<SummaryItem[]>([]);
  const [commesseGroups, setCommesseGroups] = useState<CommessaGroup[]>([]);
  const [loading,        setLoading]        = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Dispatch>(`/api/pack/packing-lists/${id}`),
      api.get<SummaryItem[]>(`/api/pack/packing-lists/${id}/summary`),
      api.get<CommessaGroup[]>(`/api/pack/packing-lists/${id}/commesse-by-group`),
    ]).then(([d, s, cg]) => {
      setDispatch(d);
      setSummary(s);
      setCommesseGroups(cg);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;
  if (!dispatch) return <div className="p-8 text-center text-red-500">Spedizione non trovata.</div>;

  const withCommessa    = summary.filter(it => (it.commessa ?? '').trim() !== '');
  const withoutCommessa = summary.filter(it => (it.commessa ?? '').trim() === '');

  return (
    <>
      <style>{`
        .section-box { border: 1px solid #9aa3ac; background: #dee2e6; border-radius: 8px; padding: 8px 12px; margin: 18px 0 10px 0; }
        .section-title { margin: 0; font-size: 14px; font-weight: 700; }
        .subsection-title { margin: 10px 0 6px 0; font-size: 12.5px; font-weight: 600; }
        @page { size: A4 portrait; margin: 3mm; }
        @media print {
          .no-print, aside, nav { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .page-break { break-before: page; page-break-before: always; }
        }
      `}</style>

      <div className="max-w-4xl text-sm">
        <div className="flex justify-between items-center mb-4 no-print">
          <h1 className="text-2xl font-bold text-gray-900">Packing List #{dispatch.id}</h1>
          <button onClick={() => window.print()} className="btn-secondary text-sm">
            🖨 Scarica PDF
          </button>
        </div>

        <p><strong>Tipo spedizione:</strong> {dispatch.type}</p>
        <p><strong>Data creazione:</strong> {fmtDate(dispatch.created_at)}</p>
        <p><strong>Totale bancali:</strong> {dispatch.pallets.length}</p>

        <div className="section-box">
          <h2 className="section-title">Riepilogo articoli</h2>
        </div>

        <h3 className="subsection-title">Articoli commessati</h3>
        <SummaryTable rows={withCommessa} />

        <h3 className="subsection-title">Articoli MRP</h3>
        <SummaryTable rows={withoutCommessa} />

        <div className="section-box page-break">
          <h2 className="section-title">Dettaglio per bancali</h2>
        </div>

        {dispatch.pallets.map(pallet => (
          <div key={pallet.id} className="mb-4">
            <h3 className="subsection-title">Bancale #{pallet.number}</h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-300 bg-gray-100">
                  <th className="py-1.5 px-2 text-left">Articolo</th>
                  <th className="py-1.5 px-2 text-left">Descrizione</th>
                  <th className="py-1.5 px-2 text-right">Q.tà</th>
                  <th className="py-1.5 px-2 text-left">Commessa</th>
                </tr>
              </thead>
              <tbody>
                {pallet.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 px-2 font-mono">{it.article_code}</td>
                    <td className="py-1 px-2">{it.description || '–'}</td>
                    <td className="py-1 px-2 text-right">{it.quantity}</td>
                    <td className="py-1 px-2">{it.commessa || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {commesseGroups.length > 0 && (
          <div className="no-print mt-6">
            <h3 className="subsection-title">Commesse raggruppate per gruppo</h3>
            <ul className="text-xs space-y-1">
              {commesseGroups.map((g, i) => (
                <li key={i}>
                  <strong>{g.group_name || `Gruppo ${g.commessa_group}`}:</strong> {g.commesse}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function SummaryTable({ rows }: { rows: Array<{ article_code: string; description: string | null; family: string | null; commessa: string | null; total_quantity: number }> }) {
  return (
    <table className="w-full border-collapse text-xs mb-4">
      <thead>
        <tr className="border-b border-gray-300 bg-gray-100">
          <th className="py-1.5 px-2 text-left">Modello</th>
          <th className="py-1.5 px-2 text-left">Codice articolo</th>
          <th className="py-1.5 px-2 text-left">Descrizione</th>
          <th className="py-1.5 px-2 text-left">Commessa</th>
          <th className="py-1.5 px-2 text-right">Q.tà tot.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((it, i) => (
          <tr key={i} className="border-b border-gray-100">
            <td className="py-1 px-2">{it.family || '–'}</td>
            <td className="py-1 px-2 font-mono">{it.article_code}</td>
            <td className="py-1 px-2">{it.description || '–'}</td>
            <td className="py-1 px-2">{it.commessa || '–'}</td>
            <td className="py-1 px-2 text-right">{it.total_quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
