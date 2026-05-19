'use client';

import { useState, useEffect, useMemo } from 'react';
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

type PalletExtras = Record<number, { L?: string; W?: string; H?: string; palletTareKg?: string }>;

function groupPalletItems(items: PalletItem[]) {
  const map = new Map<string, {
    sample:      PalletItem;
    count:       number;
    sumNet:      number;
    sumContTare: number;
    sumGross:    number;
    sumCost:     number;
    missing:     boolean;
    missingCost: boolean;
  }>();

  for (const it of items) {
    const dims = it.length_mm && it.width_mm && it.height_mm
      ? `${it.length_mm}×${it.width_mm}×${it.height_mm}` : '-';
    const key = JSON.stringify({
      code: it.article_code, desc: it.description, qty: it.quantity,
      cont: it.container_name ?? 'No container', dims,
      commessa: it.commessa, uCost: it.unit_cost, unitW: it.unit_weight_kg,
    });
    if (!map.has(key)) {
      map.set(key, { sample: it, count: 0, sumNet: 0, sumContTare: 0, sumGross: 0, sumCost: 0, missing: false, missingCost: false });
    }
    const g = map.get(key)!;
    g.count       += 1;
    g.sumNet      += it.net_kg            ?? 0;
    g.sumContTare += it.container_tare_kg ?? 0;
    g.sumGross    += it.gross_kg          ?? 0;
    if (it.line_cost != null) g.sumCost += it.line_cost;
    g.missing     = g.missing     || it.missing_weight || it.missing_container;
    g.missingCost = g.missingCost || it.missing_price;
  }
  return Array.from(map.values());
}

function DoganaView({ dispatch }: { dispatch: LogisticsDispatch }) {
  const id = dispatch.id;

  const [invoiceNo,    setInvoiceNo]    = useState(() => localStorage.getItem(`inv:${id}`)       || '');
  const [orderNo,      setOrderNo]      = useState(() => localStorage.getItem(`order:${id}`)     || '');
  const [mittente,     setMittente]     = useState(() => localStorage.getItem(`sender:${id}`)    || 'STR S.p.A. - Via ...');
  const [destinatario, setDestinatario] = useState(() => localStorage.getItem(`consignee:${id}`) || (dispatch.destination_name ?? ''));
  const [destFinale,   setDestFinale]   = useState(() => localStorage.getItem(`finalDest:${id}`) || '');
  const [palletExtras, setPalletExtras] = useState<PalletExtras>(() => {
    try { return JSON.parse(localStorage.getItem(`plExtras:${id}`) || '{}'); } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem(`inv:${id}`,       invoiceNo);    }, [id, invoiceNo]);
  useEffect(() => { localStorage.setItem(`order:${id}`,     orderNo);      }, [id, orderNo]);
  useEffect(() => { localStorage.setItem(`sender:${id}`,    mittente);     }, [id, mittente]);
  useEffect(() => { localStorage.setItem(`consignee:${id}`, destinatario); }, [id, destinatario]);
  useEffect(() => { localStorage.setItem(`finalDest:${id}`, destFinale);   }, [id, destFinale]);
  useEffect(() => { localStorage.setItem(`plExtras:${id}`,  JSON.stringify(palletExtras)); }, [id, palletExtras]);

  function handleExtraChange(palletId: number, key: string, value: string) {
    setPalletExtras(prev => ({ ...prev, [palletId]: { ...prev[palletId], [key]: value } }));
  }

  const nonEmptyPallets = dispatch.pallets.filter(p => p.items.length > 0);
  const missingItems    = nonEmptyPallets.flatMap(p => p.items).filter(it => it.missing_weight || it.missing_container || it.missing_price);
  const totalPallets    = nonEmptyPallets.length;
  const totalPackages   = nonEmptyPallets.reduce((s, p) => s + p.items.length, 0);

  const currency = useMemo(() => {
    for (const p of nonEmptyPallets) for (const it of p.items) if (it.currency) return it.currency;
    return 'EUR';
  }, [nonEmptyPallets]);

  const { totalNetKg, totalGrossKg, totalCost } = useMemo(() => {
    let tNet = 0, tGross = 0, tCost = 0;
    for (const p of nonEmptyPallets) {
      const extra = palletExtras[p.id] || {};
      const palletTare = extra.palletTareKg !== undefined && extra.palletTareKg !== '' ? Number(extra.palletTareKg) : 6;
      const pNet      = p.items.reduce((s, it) => s + (it.net_kg            ?? 0), 0);
      const pContTare = p.items.reduce((s, it) => s + (it.container_tare_kg ?? 0), 0);
      const pCost     = p.items.reduce((s, it) => s + (it.line_cost         ?? 0), 0);
      tNet   += pNet;
      tGross += pNet + pContTare + palletTare;
      tCost  += pCost;
    }
    return { totalNetKg: tNet, totalGrossKg: tGross, totalCost: tCost };
  }, [nonEmptyPallets, palletExtras]);

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }

        /* Base size for the whole dogana document */
        .dogana-doc { font-size: 11px; }

        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          input.dogana-input, textarea.dogana-input { border: none !important; background: transparent !important; padding: 0 !important; }
          .dogana-doc { font-size: 8.5pt; }
        }

        input.dogana-input, textarea.dogana-input {
          border-bottom: 1px solid #ccc; background: #f9fafb; padding: 2px 4px; font-size: inherit;
        }
        input.dogana-input:focus, textarea.dogana-input:focus { outline: none; background: #eff6ff; }

        table.dog-table { width: 100%; border-collapse: collapse; font-size: inherit; table-layout: fixed; }
        table.dog-table th, table.dog-table td {
          border: 1px solid #d1d5db; padding: 2px 4px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
        }
        table.dog-table th { background: #f3f4f6; text-align: center; }
        table.dog-table td.r { text-align: right; }
        table.dog-table td.c { text-align: center; }
        .col-nx    { width: 30px; }
        .col-code  { width: 78px; }
        .col-desc  { width: 195px; }
        .col-comm  { width: 75px; }
        .col-qty   { width: 40px; }
        .col-cont  { width: 98px; }
        .col-dims  { width: 98px; }
        .col-ucost { width: 72px; }
        .col-unitkg{ width: 68px; }
        .col-tare  { width: 72px; }
        .col-lnet  { width: 78px; }
        .col-lgross{ width: 82px; }
        .col-lcost { width: 78px; }
        @media print {
          table.dog-table th, table.dog-table td {
            padding: 2px 3px !important;
            white-space: normal !important; word-break: break-word; overflow: visible !important;
          }
        }
      `}</style>

      <div className="dogana-doc">

      {/* Missing data warning */}
      {missingItems.length > 0 && (
        <div className="no-print mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
          ⚠ {missingItems.length} articol{missingItems.length === 1 ? 'o manca' : 'i mancano'} di peso/scatola/prezzo — i totali saranno parziali.
        </div>
      )}

      {/* Screen-only editable header */}
      <div className="no-print mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="grid grid-cols-3 gap-4 text-xs mb-3">
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">N° Fattura</div>
            <input className="dogana-input w-full" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="es. 2025/001" />
            <div className="font-semibold text-gray-500 uppercase mb-1 mt-2">N° Ordine</div>
            <input className="dogana-input w-full" value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="es. ORD-12345" />
          </div>
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">Mittente</div>
            <textarea className="dogana-input w-full" rows={3} value={mittente} onChange={e => setMittente(e.target.value)} />
          </div>
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">Destinatario</div>
            <textarea className="dogana-input w-full" rows={2} value={destinatario} onChange={e => setDestinatario(e.target.value)} />
            <div className="font-semibold text-gray-500 uppercase mb-1 mt-2">Destinazione finale</div>
            <textarea className="dogana-input w-full" rows={2} value={destFinale} onChange={e => setDestFinale(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Printed header */}
      <div className="mb-3">
        <div className="font-bold uppercase mb-0.5">FATTURA N.: {invoiceNo || '—'}</div>
        <div className="mb-2">ORDINE N.: {orderNo || '—'}</div>
        <div className="border border-gray-300 bg-gray-50 rounded px-3 py-2">
          <div><span className="font-semibold inline-block w-36">Mittente:</span>{mittente || '—'}</div>
          <div><span className="font-semibold inline-block w-36">Destinatario:</span>{destinatario || '—'}</div>
          <div><span className="font-semibold inline-block w-36">Destinazione finale:</span>{destFinale || '—'}</div>
        </div>
      </div>

      {/* Per-pallet tables */}
      {nonEmptyPallets.map(pallet => {
        const extra      = palletExtras[pallet.id] || {};
        const palletTare = extra.palletTareKg !== undefined && extra.palletTareKg !== '' ? Number(extra.palletTareKg) : 6;
        const hasDims    = !!(extra.L || extra.W || extra.H);
        const dimsText   = hasDims ? `${extra.L || 0}×${extra.W || 0}×${extra.H || 0} mm` : null;
        const pNet       = pallet.items.reduce((s, it) => s + (it.net_kg            ?? 0), 0);
        const pContTare  = pallet.items.reduce((s, it) => s + (it.container_tare_kg ?? 0), 0);
        const pGross     = pNet + pContTare + palletTare;
        const pCost      = pallet.items.reduce((s, it) => s + (it.line_cost         ?? 0), 0);
        const grouped    = groupPalletItems(pallet.items);

        return (
          <div key={pallet.id} className="mb-5">
            {/* Pallet header */}
            <div className="bg-gray-100 border border-gray-300 rounded px-3 py-1.5 mb-1 flex justify-between items-start flex-wrap gap-2">
              <div>
                <span className="font-bold">Bancale {pallet.number}</span>
                {!hasDims ? (
                  <div className="text-xs mt-0.5">
                    Dimensioni: <span className="inline-block min-w-[140px] border-b border-dashed border-gray-400">&nbsp;</span> mm
                  </div>
                ) : (
                  <div className="text-xs">Dimensioni: {dimsText}</div>
                )}
              </div>
              <div className="text-right">
                {/* Screen-only dimension + tare inputs */}
                <div className="no-print flex flex-wrap gap-2 mb-1 justify-end">
                  {(['L', 'W', 'H'] as const).map(k => (
                    <div key={k}>
                      <div className="text-xs text-gray-400">Bancale {k} (mm)</div>
                      <input
                        type="number" min="0"
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-20"
                        value={extra[k] ?? ''}
                        onChange={e => handleExtraChange(pallet.id, k, e.target.value)}
                      />
                    </div>
                  ))}
                  <div>
                    <div className="text-xs text-gray-400">Tara bancale (kg)</div>
                    <input
                      type="number" min="0" step="0.001"
                      className="border border-gray-300 rounded px-1 py-0.5 text-xs w-24"
                      value={extra.palletTareKg ?? 6}
                      onChange={e => handleExtraChange(pallet.id, 'palletTareKg', e.target.value)}
                    />
                  </div>
                </div>
                <div className="text-xs space-x-3">
                  <span><b>Tara bancale:</b> {palletTare.toFixed(3)} kg</span>
                  <span><b>Colli:</b> {pallet.items.length}</span>
                  <span><b>Netto:</b> {pNet.toFixed(3)} kg</span>
                  <span><b>Lordo:</b> {pGross.toFixed(3)} kg</span>
                  <span><b>Valore:</b> {currency} {pCost.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Items table */}
            <table className="dog-table">
              <thead>
                <tr>
                  <th className="col-nx">Nx</th>
                  <th className="col-code">Codice</th>
                  <th className="col-desc">Descrizione</th>
                  <th className="col-comm">Commessa</th>
                  <th className="col-qty">Q.tà</th>
                  <th className="col-cont">Scatola</th>
                  <th className="col-dims">L×W×H (mm)</th>
                  <th className="col-ucost">P.Unit {currency}</th>
                  <th className="col-unitkg">P.Unit (kg)</th>
                  <th className="col-tare">Tara cont. (kg)</th>
                  <th className="col-lnet">P.Netto (kg)</th>
                  <th className="col-lgross">P.Lordo (kg)</th>
                  <th className="col-lcost">Totale {currency}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, idx) => {
                  const it      = g.sample;
                  const dims    = it.length_mm && it.width_mm && it.height_mm ? `${it.length_mm}×${it.width_mm}×${it.height_mm}` : '–';
                  const rowCls  = g.missing || g.missingCost ? 'bg-yellow-50' : '';
                  return (
                    <tr key={idx} className={rowCls}>
                      <td className="c col-nx">{g.count}x</td>
                      <td className="col-code" style={{ fontFamily: 'monospace' }}>{it.article_code}</td>
                      <td className="col-desc">{it.description || '–'}</td>
                      <td className="col-comm">{it.commessa || '–'}</td>
                      <td className="r col-qty">{it.quantity}</td>
                      <td className="col-cont">{it.container_name ?? <span style={{ color: '#f87171' }}>!</span>}</td>
                      <td className="c col-dims">{dims}</td>
                      <td className="r col-ucost">{it.unit_cost != null ? it.unit_cost.toFixed(2) : '–'}</td>
                      <td className="r col-unitkg">{it.unit_weight_kg != null ? it.unit_weight_kg.toFixed(4) : <span style={{ color: '#f87171' }}>-</span>}</td>
                      <td className="r col-tare">{g.sumContTare.toFixed(3)}</td>
                      <td className="r col-lnet">{g.sumNet.toFixed(3)}</td>
                      <td className="r col-lgross" style={{ fontWeight: 600 }}>{g.sumGross.toFixed(3)}</td>
                      <td className="r col-lcost">{g.missingCost ? '–' : g.sumCost.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Summary box (right-aligned, narrow) */}
      <div className="border-2 border-gray-400 rounded p-3 mt-4 ml-auto" style={{ maxWidth: '44%' }}>
        <table className="w-full">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="font-semibold py-1">Numero bancali</td>
              <td className="text-right font-bold py-1">{totalPallets}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="font-semibold py-1">Colli totali</td>
              <td className="text-right font-bold py-1">{totalPackages}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="font-semibold py-1">Peso netto tot. (kg)</td>
              <td className="text-right font-bold py-1">{totalNetKg.toFixed(3)}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="font-semibold py-1">Peso lordo tot. (kg)</td>
              <td className="text-right font-bold py-1">{totalGrossKg.toFixed(3)}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Valore totale ({currency})</td>
              <td className="text-right font-bold py-1">{totalCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      </div>{/* end dogana-doc */}
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
