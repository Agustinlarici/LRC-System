'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';
import { PageLoader } from '@/components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PalletItem {
  pallet_item_id:    number;
  article_code:      string;
  description:       string | null;
  family:            string | null;
  quantity:          number;
  commessa:          string | null;
  unit_weight_kg:    number | null;
  unit_cost:         number | null;
  currency:          string | null;
  container_id:      number | null;
  container_name:    string | null;
  length_mm:         number | null;
  width_mm:          number | null;
  height_mm:         number | null;
  container_tare_kg: number | null;
  net_kg:            number | null;
  gross_kg:          number | null;
  line_cost:         number | null;
  missing_weight:    boolean;
  missing_container: boolean;
  missing_price:     boolean;
}

interface Pallet {
  id:             number;
  number:         number;
  items:          PalletItem[];
  pallet_net_kg:  number | null;
  pallet_gross_kg: number | null;
  pallet_cost:    number | null;
}

interface LogisticsDispatch {
  id:              number;
  type:            string | null;
  destination_name: string | null;
  created_at:      string;
  pallets:         Pallet[];
  total_net_kg:    number | null;
  total_gross_kg:  number | null;
  total_cost:      number | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(raw: string) { return fmtDatetime(raw);
}

function fmt(n: number | null, decimals = 3): string {
  if (n == null) return '–';
  return n.toFixed(decimals);
}

function fmtEur(n: number | null): string {
  if (n == null) return '–';
  return '€ ' + n.toFixed(2);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type View = 'standard' | 'dogana';

// ─── Standard view ────────────────────────────────────────────────────────────

function SummaryTable({ rows }: { rows: SummaryItem[] }) {
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

// ─── Dogana view ──────────────────────────────────────────────────────────────

function DoganaView({ dispatch }: { dispatch: LogisticsDispatch }) {
  const [invoiceNo,    setInvoiceNo]    = useState('');
  const [orderNo,      setOrderNo]      = useState('');
  const [mittente,     setMittente]     = useState('STR S.p.A. - Via ...');
  const [destinatario, setDestinatario] = useState(dispatch.destination_name ?? '');
  const [destFinale,   setDestFinale]   = useState('');

  const nonEmptyPallets = dispatch.pallets.filter(p => p.items.length > 0);
  const missingItems = nonEmptyPallets.flatMap(p => p.items).filter(it => it.missing_weight || it.missing_container || it.missing_price);
  const totalPallets   = nonEmptyPallets.length;
  const totalPackages  = nonEmptyPallets.reduce((s, p) => s + p.items.length, 0);

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 6mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          input.dogana-input { border: none !important; background: transparent !important; padding: 0 !important; }
          .page-break { break-before: page; page-break-before: always; }
        }
        input.dogana-input { border-bottom: 1px solid #ccc; background: #f9fafb; padding: 2px 4px; min-width: 120px; font-size: inherit; }
        input.dogana-input:focus { outline: none; background: #eff6ff; }
      `}</style>

      {/* Missing data warning */}
      {missingItems.length > 0 && (
        <div className="no-print mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          ⚠ {missingItems.length} articol{missingItems.length === 1 ? 'o manca' : 'i mancano'} di peso/scatola/prezzo — i totali saranno parziali.
        </div>
      )}

      {/* Header dogana */}
      <div className="mb-4 grid grid-cols-3 gap-4 text-xs">
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">Mittente</div>
          <input className="dogana-input w-full" value={mittente} onChange={e => setMittente(e.target.value)} />
        </div>
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">Destinatario</div>
          <input className="dogana-input w-full" value={destinatario} onChange={e => setDestinatario(e.target.value)} />
        </div>
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">Destinazione finale</div>
          <input className="dogana-input w-full" value={destFinale} onChange={e => setDestFinale(e.target.value)} />
        </div>
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">N° Fattura</div>
          <input className="dogana-input" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="es. 2025/001" />
        </div>
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">N° Ordine</div>
          <input className="dogana-input" value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="es. ORD-12345" />
        </div>
        <div>
          <div className="font-semibold text-gray-500 uppercase mb-1">Data</div>
          <span className="text-xs">{fmtDate(dispatch.created_at)}</span>
        </div>
      </div>

      {/* Per-pallet tables */}
      {nonEmptyPallets.map(pallet => (
        <div key={pallet.id} className="mb-6">
          <div className="bg-gray-100 border border-gray-300 rounded px-3 py-1 mb-1 flex justify-between items-center">
            <span className="font-bold text-sm">Bancale {pallet.number}</span>
            <span className="text-xs text-gray-500">
              {pallet.items.length} colli |
              Netto: {fmt(pallet.pallet_net_kg)} kg |
              Lordo: {fmt(pallet.pallet_gross_kg)} kg |
              Valore: {fmtEur(pallet.pallet_cost)}
            </span>
          </div>
          <table className="w-full border-collapse" style={{ fontSize: '7.5pt' }}>
            <thead>
              <tr className="bg-gray-50 border border-gray-200">
                <th className="border border-gray-200 px-1 py-1 text-left">Codice</th>
                <th className="border border-gray-200 px-1 py-1 text-left">Descrizione</th>
                <th className="border border-gray-200 px-1 py-1 text-left">Commessa</th>
                <th className="border border-gray-200 px-1 py-1 text-right">Q.tà</th>
                <th className="border border-gray-200 px-1 py-1 text-left">Scatola</th>
                <th className="border border-gray-200 px-1 py-1 text-left">L×W×H (mm)</th>
                <th className="border border-gray-200 px-1 py-1 text-right">P.Unit (kg)</th>
                <th className="border border-gray-200 px-1 py-1 text-right">P.Netto (kg)</th>
                <th className="border border-gray-200 px-1 py-1 text-right">P.Lordo (kg)</th>
                <th className="border border-gray-200 px-1 py-1 text-right">P.Unit EUR</th>
                <th className="border border-gray-200 px-1 py-1 text-right">Totale EUR</th>
              </tr>
            </thead>
            <tbody>
              {pallet.items.map(it => (
                <tr
                  key={it.pallet_item_id}
                  className={`border border-gray-200 ${(it.missing_weight || it.missing_container || it.missing_price) ? 'bg-yellow-50' : ''}`}
                >
                  <td className="border border-gray-200 px-1 py-0.5 font-mono">{it.article_code}</td>
                  <td className="border border-gray-200 px-1 py-0.5">{it.description || '–'}</td>
                  <td className="border border-gray-200 px-1 py-0.5">{it.commessa || '–'}</td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right">{it.quantity}</td>
                  <td className="border border-gray-200 px-1 py-0.5">{it.container_name || <span className="text-red-400">!</span>}</td>
                  <td className="border border-gray-200 px-1 py-0.5">
                    {it.length_mm && it.width_mm && it.height_mm ? `${it.length_mm}×${it.width_mm}×${it.height_mm}` : '–'}
                  </td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right">{fmt(it.unit_weight_kg, 4)}</td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right">{fmt(it.net_kg, 3)}</td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right">{fmt(it.gross_kg, 3)}</td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right">{fmt(it.unit_cost, 4)}</td>
                  <td className="border border-gray-200 px-1 py-0.5 text-right font-medium">{fmtEur(it.line_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Summary box */}
      <div className="border-2 border-gray-400 rounded p-3 mt-4" style={{ fontSize: '8pt' }}>
        <div className="grid grid-cols-4 gap-4 font-semibold">
          <div>
            <div className="text-gray-500 text-xs">Bancali</div>
            <div className="text-lg">{totalPallets}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Colli totali</div>
            <div className="text-lg">{totalPackages}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Peso netto tot.</div>
            <div className="text-lg">{fmt(dispatch.total_net_kg, 2)} kg</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Peso lordo tot.</div>
            <div className="text-lg">{fmt(dispatch.total_gross_kg, 2)} kg</div>
          </div>
        </div>
        {dispatch.total_cost != null && (
          <div className="mt-2 pt-2 border-t border-gray-300">
            <span className="text-gray-500 text-xs">Valore totale: </span>
            <span className="font-bold text-base">{fmtEur(dispatch.total_cost)}</span>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PackingListDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [view,           setView]           = useState<View>(
    searchParams.get('view') === 'dogana' ? 'dogana' : 'standard'
  );
  const [summary,        setSummary]        = useState<SummaryItem[]>([]);
  const [commesseGroups, setCommesseGroups] = useState<CommessaGroup[]>([]);
  const [logistics,      setLogistics]      = useState<LogisticsDispatch | null>(null);
  const [loading,        setLoading]        = useState(true);

  useEffect(() => {
    document.title = `Packing List #${id} — STR`;
    Promise.allSettled([
      api.get<SummaryItem[]>(`/api/pack/packing-lists/${id}/summary`),
      api.get<CommessaGroup[]>(`/api/pack/packing-lists/${id}/commesse-by-group`),
      api.get<LogisticsDispatch>(`/api/pack/packing-lists/${id}/detail-logistics`),
    ]).then(([sRes, cgRes, lgRes]) => {
      if (sRes.status  === 'fulfilled') setSummary(sRes.value);
      if (cgRes.status === 'fulfilled') setCommesseGroups(cgRes.value);
      if (lgRes.status === 'fulfilled') setLogistics(lgRes.value);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLoader />;
  if (!logistics) return <div className="p-8 text-center text-red-500">Spedizione non trovata.</div>;

  const withCommessa    = summary.filter(it => (it.commessa ?? '').trim() !== '');
  const withoutCommessa = summary.filter(it => (it.commessa ?? '').trim() === '');

  return (
    <>
      <style>{`
        .section-box { border: 1px solid #9aa3ac; background: #dee2e6; border-radius: 8px; padding: 8px 12px; margin: 18px 0 10px 0; }
        .section-title { margin: 0; font-size: 14px; font-weight: 700; }
        .subsection-title { margin: 10px 0 6px 0; font-size: 12.5px; font-weight: 600; }
        @media print {
          .no-print, aside, nav { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .page-break { break-before: page; page-break-before: always; }
        }
      `}</style>

      <div className="text-sm">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 no-print">
          <div>
            <Link href="/packing/liste" className="text-sm text-blue-600 hover:text-blue-800 mb-1 inline-block">
              ← Torna alle liste
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Packing List #{logistics.id}
              {logistics.destination_name && <span className="text-gray-500 font-normal text-lg ml-2">— {logistics.destination_name}</span>}
            </h1>
            <p className="text-gray-500 text-sm">{fmtDate(logistics.created_at)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setView('standard')}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${view === 'standard' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              Standard
            </button>
            <button
              onClick={() => setView('dogana')}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${view === 'dogana' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              🧾 Dogana / PDF
            </button>
            <button onClick={() => window.print()} className="btn-secondary text-sm">
              🖨 Stampa
            </button>
          </div>
        </div>

        {/* Standard view */}
        {view === 'standard' && (
          <div className="max-w-4xl mx-auto">
            <p><strong>Destinazione:</strong> {logistics.destination_name || logistics.type || '–'}</p>
            <p><strong>Data creazione:</strong> {fmtDate(logistics.created_at)}</p>
            <p><strong>Totale bancali:</strong> {logistics.pallets.length}</p>

            <div className="section-box"><h2 className="section-title">Riepilogo articoli</h2></div>

            <h3 className="subsection-title">Articoli commessati</h3>
            <SummaryTable rows={withCommessa} />

            <h3 className="subsection-title">Articoli MRP</h3>
            <SummaryTable rows={withoutCommessa} />

            <div className="section-box page-break"><h2 className="section-title">Dettaglio per bancali</h2></div>

            {logistics.pallets.filter(p => p.items.length > 0).map(pallet => (
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
        )}

        {/* Dogana view */}
        {view === 'dogana' && <DoganaView dispatch={logistics} />}
      </div>
    </>
  );
}
