'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import * as XLSX from 'xlsx';
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

interface EdiShipmentSummary {
  shipment_id:      string;
  shipment_date:    string | null;
  customer_account: string | null;
  line_count:       number;
}

interface EdiLine {
  article_code:    string;
  description:     string | null;
  quantity:        number;
  unit_of_measure: string | null;
  contract_number: string | null;
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
          <th className="py-1.5 px-2 text-left">Model</th>
          <th className="py-1.5 px-2 text-left">Article code</th>
          <th className="py-1.5 px-2 text-left">Description</th>
          <th className="py-1.5 px-2 text-left">Commessa</th>
          <th className="py-1.5 px-2 text-right">Total qty.</th>
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

function DoganaView({ dispatch, downloadRef }: {
  dispatch:    LogisticsDispatch;
  downloadRef: React.MutableRefObject<(() => void) | null>;
}) {
  const id = dispatch.id;

  const [invoiceNo,    setInvoiceNo]    = useState(() => localStorage.getItem(`inv:${id}`)       || '');
  const [orderNo,      setOrderNo]      = useState(() => localStorage.getItem(`order:${id}`)     || '');
  const [mittente,     setMittente]     = useState(() => localStorage.getItem(`sender:${id}`)    || 'STR S.p.A. - Via ...');
  const [destinatario, setDestinatario] = useState(() => localStorage.getItem(`consignee:${id}`) || (dispatch.destination_name ?? ''));
  const [destFinale,   setDestFinale]   = useState(() => localStorage.getItem(`finalDest:${id}`) || '');
  const [palletExtras, setPalletExtras] = useState<PalletExtras>(() => {
    try { return JSON.parse(localStorage.getItem(`plExtras:${id}`) || '{}'); } catch { return {}; }
  });
  const [cartoneMode,         setCartoneMode]         = useState(() => localStorage.getItem(`cartone:${id}`)       === 'true');
  const [cartoneLabel,        setCartoneLabel]        = useState(() => localStorage.getItem(`cartoneLabel:${id}`)  || 'Box');
  const [cartoneTareStr,      setCartoneTareStr]      = useState(() => localStorage.getItem(`cartoneTare:${id}`)   || '1.5');
  const [cartoneDimsStr,      setCartoneDimsStr]      = useState(() => localStorage.getItem(`cartoneDims:${id}`)   || '1000×800×300');
  const [cartoneLineOverrides, setCartoneLineOverrides] = useState<Record<string, { name?: string; dims?: string; tare?: string }>>(() => {
    try { return JSON.parse(localStorage.getItem(`cartoneLines:${id}`) || '{}'); } catch { return {}; }
  });
  const [ordiniMode,       setOrdiniMode]       = useState(() => localStorage.getItem(`ordini:${id}`)    === 'true');
  const [selectedShipIds,  setSelectedShipIds]  = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`ordiniShip:${id}`) || '[]'); } catch { return []; } });
  const [showShipPicker,   setShowShipPicker]   = useState(false);
  const [allShipments,     setAllShipments]     = useState<EdiShipmentSummary[]>([]);
  const [shipmentFilter,   setShipmentFilter]   = useState('');
  const [shipFilterDebounce, setShipFilterDebounce] = useState('');
  const [shipmentOffset,   setShipmentOffset]   = useState(0);
  const [hasMoreShipments, setHasMoreShipments] = useState(false);
  const [ordiniLines,      setOrdiniLines]      = useState<EdiLine[]>([]);
  const [ordiniLoading,    setOrdiniLoading]    = useState(false);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [prezziOrdineMode, setPrezziOrdineMode] = useState(() => localStorage.getItem(`prezziOrdine:${id}`) === 'true');
  const [bcPrices,         setBcPrices]         = useState<Record<string, number>>({});
  const [priceOverrides,   setPriceOverrides]   = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(`priceOverrides:${id}`) || '{}'); } catch { return {}; }
  });
  const [savedFlash, setSavedFlash] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => { localStorage.setItem(`inv:${id}`,       invoiceNo);    }, [id, invoiceNo]);
  useEffect(() => { localStorage.setItem(`order:${id}`,     orderNo);      }, [id, orderNo]);
  useEffect(() => { localStorage.setItem(`sender:${id}`,    mittente);     }, [id, mittente]);
  useEffect(() => { localStorage.setItem(`consignee:${id}`, destinatario); }, [id, destinatario]);
  useEffect(() => { localStorage.setItem(`finalDest:${id}`, destFinale);   }, [id, destFinale]);
  useEffect(() => { localStorage.setItem(`plExtras:${id}`,  JSON.stringify(palletExtras)); }, [id, palletExtras]);
  useEffect(() => { localStorage.setItem(`cartone:${id}`,      String(cartoneMode));                        }, [id, cartoneMode]);
  useEffect(() => { localStorage.setItem(`cartoneLabel:${id}`, cartoneLabel);                               }, [id, cartoneLabel]);
  useEffect(() => { localStorage.setItem(`cartoneTare:${id}`,  cartoneTareStr);                             }, [id, cartoneTareStr]);
  useEffect(() => { localStorage.setItem(`cartoneDims:${id}`,  cartoneDimsStr);                             }, [id, cartoneDimsStr]);
  useEffect(() => { localStorage.setItem(`cartoneLines:${id}`, JSON.stringify(cartoneLineOverrides));       }, [id, cartoneLineOverrides]);
  useEffect(() => { localStorage.setItem(`ordini:${id}`,        String(ordiniMode));                        }, [id, ordiniMode]);
  useEffect(() => { localStorage.setItem(`ordiniShip:${id}`,    JSON.stringify(selectedShipIds));           }, [id, selectedShipIds]);
  useEffect(() => { localStorage.setItem(`prezziOrdine:${id}`,  String(prezziOrdineMode));                  }, [id, prezziOrdineMode]);
  useEffect(() => { localStorage.setItem(`priceOverrides:${id}`, JSON.stringify(priceOverrides));           }, [id, priceOverrides]);

  useEffect(() => {
    const t = setTimeout(() => setShipFilterDebounce(shipmentFilter), 400);
    return () => clearTimeout(t);
  }, [shipmentFilter]);

  useEffect(() => {
    if (!showShipPicker) return;
    setShipmentsLoading(true);
    const params = new URLSearchParams({ all: 'true', limit: '10', offset: '0' });
    if (shipFilterDebounce) params.set('search', shipFilterDebounce);
    api.get<EdiShipmentSummary[]>(`/api/edi/shipments?${params}`)
      .then(data => {
        setAllShipments(data);
        setShipmentOffset(data.length);
        setHasMoreShipments(data.length === 10);
      })
      .catch(() => {})
      .finally(() => setShipmentsLoading(false));
  }, [showShipPicker, shipFilterDebounce]);

  useEffect(() => {
    if (!ordiniMode || selectedShipIds.length === 0) { setOrdiniLines([]); return; }
    setOrdiniLoading(true);
    Promise.all(selectedShipIds.map(sid => api.get<EdiLine[]>(`/api/edi/shipments/${sid}?raw=true`)))
      .then(results => setOrdiniLines(results.flat()))
      .catch(() => {})
      .finally(() => setOrdiniLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordiniMode, JSON.stringify(selectedShipIds)]);

  useEffect(() => {
    if (!prezziOrdineMode || selectedShipIds.length === 0) { setBcPrices({}); return; }
    api.get<Array<{ article_code: string; unit_price: number }>>(
      `/api/edi/shipments/prices?ids=${selectedShipIds.join(',')}`
    ).then(data => {
      const map: Record<string, number> = {};
      for (const r of data) map[r.article_code] = r.unit_price;
      setBcPrices(map);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prezziOrdineMode, JSON.stringify(selectedShipIds)]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(t);
  }, [invoiceNo, orderNo, mittente, destinatario, destFinale, palletExtras, cartoneMode, cartoneLabel, cartoneTareStr, cartoneDimsStr, cartoneLineOverrides, ordiniMode, selectedShipIds, prezziOrdineMode, priceOverrides]);

  function handleExtraChange(palletId: number, key: string, value: string) {
    setPalletExtras(prev => ({ ...prev, [palletId]: { ...prev[palletId], [key]: value } }));
  }

  const cartoneTareKgNum = parseFloat(cartoneTareStr) || 0;

  const nonEmptyPallets = dispatch.pallets.filter(p => p.items.length > 0);
  const missingItems    = nonEmptyPallets.flatMap(p => p.items).filter(it =>
    it.missing_weight || it.missing_container ||
    (it.missing_price && !(prezziOrdineMode && (bcPrices[it.article_code] != null || priceOverrides[it.article_code] !== undefined)))
  );
  const totalPallets    = nonEmptyPallets.length;
  const totalPackages   = nonEmptyPallets.reduce((s, p) => s + p.items.length, 0);

  function downloadExcel() {
    const rows: (string | number)[][] = [];

    rows.push(['PACKING LIST — SPEDIZIONE DOGANA']);
    rows.push([]);
    rows.push(['Invoice No.:', invoiceNo || '—', '', 'Order No.:', orderNo || '—']);
    rows.push(['Sender:', mittente || '—']);
    rows.push(['Consignee:', destinatario || '—']);
    rows.push(['Final destination:', destFinale || '—']);
    rows.push([]);

    for (const pallet of nonEmptyPallets) {
      const extra      = palletExtras[pallet.id] || {};
      const palletTare = extra.palletTareKg !== undefined && extra.palletTareKg !== '' ? Number(extra.palletTareKg) : 6;
      const hasDims    = !!(extra.L || extra.W || extra.H);
      const dimsText   = hasDims ? `${extra.L || 0}×${extra.W || 0}×${extra.H || 0} mm` : '—';
      const pNet       = pallet.items.reduce((s, it) => s + (it.net_kg ?? 0), 0);
      const pContTare  = cartoneMode
        ? pallet.items.length * cartoneTareKgNum
        : pallet.items.reduce((s, it) => s + (it.container_tare_kg ?? 0), 0);
      const pGross     = pNet + pContTare + palletTare;
      const pCost      = prezziOrdineMode
        ? pallet.items.reduce((s, it) => {
            const uc = priceOverrides[it.article_code] !== undefined
              ? parseFloat(priceOverrides[it.article_code]) || 0
              : (bcPrices[it.article_code] ?? it.unit_cost ?? 0);
            return s + uc * it.quantity;
          }, 0)
        : pallet.items.reduce((s, it) => s + (it.line_cost ?? 0), 0);
      const grouped    = groupPalletItems(pallet.items);

      rows.push([
        `PALLET ${pallet.number}`,
        `Dims: ${dimsText}`,
        `Tare: ${palletTare.toFixed(3)} kg`,
        `Packages: ${pallet.items.length}`,
        `Net: ${pNet.toFixed(3)} kg`,
        `Gross: ${pGross.toFixed(3)} kg`,
        `Value: ${currency} ${pCost.toFixed(2)}`,
      ]);
      rows.push([
        'Nx', 'Item Code', 'Description', 'Qty', 'Container',
        'Dimensions (mm)', `Unit Cost (${currency})`, 'Unit weight (kg)',
        'Tare weight (kg)', 'Net weight (kg)', 'Gross weight (kg)', `Total Cost (${currency})`,
      ]);

      grouped.forEach((g, gi) => {
        const it      = g.sample;
        const rawDims = it.length_mm && it.width_mm && it.height_mm
          ? `${it.length_mm}×${it.width_mm}×${it.height_mm}` : '–';
        const lineKey     = `${pallet.id}-${gi}`;
        const excelName   = cartoneMode ? (cartoneLineOverrides[lineKey]?.name ?? cartoneLabel) : (it.container_name ?? '!');
        const excelDims   = cartoneMode ? (cartoneLineOverrides[lineKey]?.dims ?? cartoneDimsStr) : rawDims;
        const excelTareKg = cartoneMode
          ? (cartoneLineOverrides[lineKey]?.tare !== undefined ? parseFloat(cartoneLineOverrides[lineKey].tare!) || 0 : g.count * cartoneTareKgNum)
          : g.sumContTare;
        rows.push([
          `${g.count}x`,
          it.article_code,
          it.description || '–',
          it.quantity,
          excelName,
          excelDims,
          (() => {
            const uc = prezziOrdineMode
              ? (priceOverrides[it.article_code] !== undefined ? parseFloat(priceOverrides[it.article_code]) : (bcPrices[it.article_code] ?? it.unit_cost))
              : it.unit_cost;
            return uc != null ? uc : '–';
          })(),
          it.unit_weight_kg != null ? it.unit_weight_kg : '–',
          Number(excelTareKg.toFixed(3)),
          Number(g.sumNet.toFixed(3)),
          Number((g.sumNet + excelTareKg).toFixed(3)),
          (() => {
            if (!prezziOrdineMode) return g.missingCost ? '–' : Number(g.sumCost.toFixed(2));
            const uc = priceOverrides[it.article_code] !== undefined
              ? parseFloat(priceOverrides[it.article_code])
              : (bcPrices[it.article_code] ?? it.unit_cost);
            return uc != null ? Number((uc * it.quantity * g.count).toFixed(2)) : '–';
          })(),
        ]);
      });

      rows.push([]);
    }

    rows.push([
      `Pallets: ${totalPallets}`,
      `Packages: ${totalPackages}`,
      `Net: ${totalNetKg.toFixed(3)} kg`,
      `Gross: ${totalGrossKg.toFixed(3)} kg`,
      `Total value: ${currency} ${totalCost.toFixed(2)}`,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dogana');
    XLSX.writeFile(wb, `packing-list-${id}-dogana.xlsx`);
  }

  // Espone downloadExcel all'header della pagina tramite ref
  useEffect(() => {
    downloadRef.current = downloadExcel;
    return () => { downloadRef.current = null; };
  });

  const currency = useMemo(() => {
    for (const p of nonEmptyPallets) for (const it of p.items) if (it.currency) return it.currency;
    return 'EUR';
  }, [nonEmptyPallets]);

  const { totalNetKg, totalGrossKg, totalCost } = useMemo(() => {
    let tNet = 0, tGross = 0, tCost = 0;
    for (const p of nonEmptyPallets) {
      const extra = palletExtras[p.id] || {};
      const palletTare = extra.palletTareKg !== undefined && extra.palletTareKg !== '' ? Number(extra.palletTareKg) : 6;
      const pNet      = p.items.reduce((s, it) => s + (it.net_kg    ?? 0), 0);
      const pContTare = cartoneMode
        ? p.items.length * cartoneTareKgNum
        : p.items.reduce((s, it) => s + (it.container_tare_kg ?? 0), 0);
      const pCost = prezziOrdineMode
        ? p.items.reduce((s, it) => {
            const uc = priceOverrides[it.article_code] !== undefined
              ? parseFloat(priceOverrides[it.article_code]) || 0
              : (bcPrices[it.article_code] ?? it.unit_cost ?? 0);
            return s + uc * it.quantity;
          }, 0)
        : p.items.reduce((s, it) => s + (it.line_cost ?? 0), 0);
      tNet   += pNet;
      tGross += pNet + pContTare + palletTare;
      tCost  += pCost;
    }
    return { totalNetKg: tNet, totalGrossKg: tGross, totalCost: tCost };
  }, [nonEmptyPallets, palletExtras, cartoneMode, cartoneTareKgNum, prezziOrdineMode, bcPrices, priceOverrides]);

  const dispatchQtyByArticle = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of nonEmptyPallets)
      for (const it of p.items)
        map[it.article_code] = (map[it.article_code] || 0) + it.quantity;
    return map;
  }, [nonEmptyPallets]);

  const ordiniQtyByArticle = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of ordiniLines)
      map[line.article_code] = (map[line.article_code] || 0) + line.quantity;
    return map;
  }, [ordiniLines]);

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }

        /* Base size for the whole dogana document */
        .dogana-doc { font-size: 11px; }

        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; overflow: visible !important; height: auto !important; background: white !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; height: auto !important; background: white !important; }
          .dogana-doc { font-size: 8.5pt; background: white !important; }
          input.dogana-input, textarea.dogana-input { border: none !important; background: transparent !important; padding: 0 !important; }
        }

        input.dogana-input, textarea.dogana-input {
          border-bottom: 1px solid #ccc; background: #f9fafb; padding: 2px 4px; font-size: inherit;
        }
        .ordini-ok td { background-color: #bbf7d0; }
        .ordini-err td { background-color: #fecaca; }
        @media print { .ordini-ok td, .ordini-err td { background-color: transparent !important; } }
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
        .col-code  { width: 105px; white-space: nowrap; }
        .col-desc  { width: 195px; font-size: 9px; }
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
          table.dog-table td.col-code { white-space: nowrap !important; word-break: keep-all !important; }
        }
      `}</style>

      <div className="dogana-doc">

      {/* Missing data warning */}
      {missingItems.length > 0 && (
        <div className="no-print mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
          ⚠ {missingItems.length} item{missingItems.length === 1 ? '' : 's'} missing weight/box/price — totals will be partial.
        </div>
      )}

      {/* Screen-only editable header */}
      <div className="no-print mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
        {savedFlash && (
          <div className="mb-2">
            <span className="text-green-600 text-xs">✓ Salvato automaticamente</span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4 text-xs mb-3">
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">Invoice No.</div>
            <input className="dogana-input w-full" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="e.g. 2025/001" />
            <div className="font-semibold text-gray-500 uppercase mb-1 mt-2">Order No.</div>
            <input className="dogana-input w-full" value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="e.g. ORD-12345" />
          </div>
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">Sender</div>
            <textarea className="dogana-input w-full" rows={3} value={mittente} onChange={e => setMittente(e.target.value)} />
          </div>
          <div>
            <div className="font-semibold text-gray-500 uppercase mb-1">Consignee</div>
            <textarea className="dogana-input w-full" rows={2} value={destinatario} onChange={e => setDestinatario(e.target.value)} />
            <div className="font-semibold text-gray-500 uppercase mb-1 mt-2">Final destination</div>
            <textarea className="dogana-input w-full" rows={2} value={destFinale} onChange={e => setDestFinale(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cartoneMode}
              onChange={e => setCartoneMode(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-sm font-semibold text-gray-700">Spedizione in cartone</span>
          </label>
          {cartoneMode && (
            <>
              <div>
                <div className="text-xs text-gray-500">Tipo collo</div>
                <input
                  className="dogana-input w-24"
                  value={cartoneLabel}
                  onChange={e => setCartoneLabel(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">Tara cartone (kg)</div>
                <input
                  type="number" min="0" step="0.001"
                  className="dogana-input w-24"
                  value={cartoneTareStr}
                  onChange={e => setCartoneTareStr(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">Dims default (mm)</div>
                <input
                  className="dogana-input w-32"
                  value={cartoneDimsStr}
                  onChange={e => setCartoneDimsStr(e.target.value)}
                  placeholder="1000×800×300"
                />
              </div>
            </>
          )}
        </div>

        {/* Ordini di vendita */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ordiniMode}
                onChange={e => setOrdiniMode(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm font-semibold text-gray-700">Aggiungi ordini di vendita</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={prezziOrdineMode}
                onChange={e => setPrezziOrdineMode(e.target.checked)}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-sm font-semibold text-gray-700">Prezzi da ordine di vendita</span>
            </label>
            {ordiniMode && (
              <>
                <button
                  onClick={() => setShowShipPicker(v => !v)}
                  className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors"
                >
                  {showShipPicker ? 'Chiudi ▴' : 'Seleziona spedizioni ▾'}
                </button>
                {selectedShipIds.map(sid => (
                  <span key={sid} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                    {sid}
                    <button
                      onClick={() => setSelectedShipIds(prev => prev.filter(s => s !== sid))}
                      className="text-blue-400 hover:text-blue-800 leading-none"
                    >×</button>
                  </span>
                ))}
                {ordiniLoading && <span className="text-xs text-gray-400">Caricamento...</span>}
              </>
            )}
          </div>
          {ordiniMode && showShipPicker && (
            <div className="border border-gray-200 rounded-lg bg-white p-3">
              <input
                type="text"
                placeholder="Cerca per ID spedizione..."
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-2"
                value={shipmentFilter}
                onChange={e => setShipmentFilter(e.target.value)}
              />
              <div className="max-h-56 overflow-y-auto">
                {shipmentsLoading && allShipments.length === 0 ? (
                  <div className="text-xs text-gray-500 py-2">Caricamento spedizioni...</div>
                ) : allShipments.length === 0 ? (
                  <div className="text-xs text-gray-400 py-2">Nessuna spedizione trovata.</div>
                ) : (
                  allShipments.map(s => (
                    <label key={s.shipment_id} className="flex items-center gap-3 text-xs py-1 px-1 hover:bg-gray-50 cursor-pointer rounded">
                      <input
                        type="checkbox"
                        checked={selectedShipIds.includes(s.shipment_id)}
                        onChange={e => {
                          if (e.target.checked) setSelectedShipIds(prev => [...prev, s.shipment_id]);
                          else setSelectedShipIds(prev => prev.filter(sid => sid !== s.shipment_id));
                        }}
                      />
                      <span className="font-mono font-semibold">{s.shipment_id}</span>
                      {s.customer_account && <span className="text-gray-500">{s.customer_account}</span>}
                      {s.shipment_date && <span className="text-gray-400">{s.shipment_date}</span>}
                      <span className="text-gray-400 ml-auto">{s.line_count} righe</span>
                    </label>
                  ))
                )}
              </div>
              {(hasMoreShipments || (shipmentsLoading && allShipments.length > 0)) && (
                <div className="mt-2 pt-2 border-t border-gray-100 text-center">
                  <button
                    disabled={shipmentsLoading}
                    onClick={() => {
                      setShipmentsLoading(true);
                      const params = new URLSearchParams({ all: 'true', limit: '10', offset: String(shipmentOffset) });
                      if (shipmentFilter) params.set('search', shipmentFilter);
                      api.get<EdiShipmentSummary[]>(`/api/edi/shipments?${params}`)
                        .then(data => {
                          setAllShipments(prev => [...prev, ...data]);
                          setShipmentOffset(prev => prev + data.length);
                          setHasMoreShipments(data.length === 10);
                        })
                        .catch(() => {})
                        .finally(() => setShipmentsLoading(false));
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                  >
                    {shipmentsLoading ? 'Caricamento...' : 'Mostra altri 10 ▾'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Printed header */}
      <div className="mb-3">
        <div className="font-bold uppercase mb-0.5">INVOICE NO.: {invoiceNo || '—'}</div>
        <div className="mb-2">ORDER NO.: {orderNo || '—'}</div>
        <div className="border border-gray-300 bg-gray-50 rounded px-3 py-2">
          <div><span className="font-semibold inline-block w-36">Sender:</span>{mittente || '—'}</div>
          <div><span className="font-semibold inline-block w-36">Consignee:</span>{destinatario || '—'}</div>
          <div><span className="font-semibold inline-block w-36">Final destination:</span>{destFinale || '—'}</div>
        </div>
      </div>

      {/* Per-pallet tables */}
      {nonEmptyPallets.map(pallet => {
        const extra      = palletExtras[pallet.id] || {};
        const palletTare = extra.palletTareKg !== undefined && extra.palletTareKg !== '' ? Number(extra.palletTareKg) : 6;
        const hasDims    = !!(extra.L || extra.W || extra.H);
        const dimsText   = hasDims ? `${extra.L || 0}×${extra.W || 0}×${extra.H || 0} mm` : null;
        const pNet       = pallet.items.reduce((s, it) => s + (it.net_kg ?? 0), 0);
        const pContTare  = cartoneMode
          ? pallet.items.length * cartoneTareKgNum
          : pallet.items.reduce((s, it) => s + (it.container_tare_kg ?? 0), 0);
        const pGross     = pNet + pContTare + palletTare;
        const pCost      = prezziOrdineMode
          ? pallet.items.reduce((s, it) => {
              const uc = priceOverrides[it.article_code] !== undefined
                ? parseFloat(priceOverrides[it.article_code]) || 0
                : (bcPrices[it.article_code] ?? it.unit_cost ?? 0);
              return s + uc * it.quantity;
            }, 0)
          : pallet.items.reduce((s, it) => s + (it.line_cost ?? 0), 0);
        const grouped    = groupPalletItems(pallet.items);

        return (
          <div key={pallet.id} className="mb-5">
            {/* Pallet header */}
            <div className="bg-gray-100 border border-gray-300 rounded px-3 py-1.5 mb-1 flex justify-between items-center flex-wrap gap-2">
              <span className="font-bold">Pallet {pallet.number}</span>
              <div className="text-right">
                {/* Screen-only dimension + tare inputs */}
                <div className="no-print flex flex-wrap gap-2 mb-1 justify-end">
                  {(['L', 'W', 'H'] as const).map(k => (
                    <div key={k}>
                      <div className="text-xs text-gray-400">Pallet {k} (mm)</div>
                      <input
                        type="number" min="0"
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs w-20"
                        value={extra[k] ?? ''}
                        onChange={e => handleExtraChange(pallet.id, k, e.target.value)}
                      />
                    </div>
                  ))}
                  <div>
                    <div className="text-xs text-gray-400">Pallet tare (kg)</div>
                    <input
                      type="number" min="0" step="0.001"
                      className="border border-gray-300 rounded px-1 py-0.5 text-xs w-24"
                      value={extra.palletTareKg ?? 6}
                      onChange={e => handleExtraChange(pallet.id, 'palletTareKg', e.target.value)}
                    />
                  </div>
                </div>
                <div className="text-xs space-x-3">
                  {!hasDims ? (
                    <span><b>Dims:</b> <span className="inline-block min-w-[100px] border-b border-dashed border-gray-400">&nbsp;</span> mm</span>
                  ) : (
                    <span><b>Dims:</b> {dimsText}</span>
                  )}
                  <span><b>Pallet tare:</b> {palletTare.toFixed(3)} kg</span>
                  <span><b>Packages:</b> {pallet.items.length}</span>
                  <span><b>Net:</b> {pNet.toFixed(3)} kg</span>
                  <span><b>Gross:</b> {pGross.toFixed(3)} kg</span>
                  <span><b>Value:</b> {currency} {pCost.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Items table */}
            <table className="dog-table">
              <thead>
                <tr>
                  <th className="col-nx">Nx</th>
                  <th className="col-code">Item Code</th>
                  <th className="col-desc">Description</th>
                  <th className="col-qty">Qty</th>
                  <th className="col-cont">Container</th>
                  <th className="col-dims">Dimensions (mm)</th>
                  <th className="col-ucost">Unit Cost (EUR)</th>
                  <th className="col-unitkg">Unit weight (kg)</th>
                  <th className="col-tare">Tare weight (kg)</th>
                  <th className="col-lnet">Net weight (kg)</th>
                  <th className="col-lgross">Gross weight (kg)</th>
                  <th className="col-lcost">Total Cost (EUR)</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, idx) => {
                  const it              = g.sample;
                  const rawDims         = it.length_mm && it.width_mm && it.height_mm ? `${it.length_mm}×${it.width_mm}×${it.height_mm}` : '–';
                  const rowCls          = g.missing || g.missingCost ? 'bg-yellow-50' : '';
                  const lineKey         = `${pallet.id}-${idx}`;
                  const displayContName = cartoneMode ? (cartoneLineOverrides[lineKey]?.name ?? cartoneLabel) : it.container_name;
                  const displayDims     = cartoneMode ? (cartoneLineOverrides[lineKey]?.dims ?? cartoneDimsStr) : rawDims;
                  const displayContTare = cartoneMode
                    ? (cartoneLineOverrides[lineKey]?.tare !== undefined ? parseFloat(cartoneLineOverrides[lineKey].tare!) || 0 : g.count * cartoneTareKgNum)
                    : g.sumContTare;
                  const displayGross    = cartoneMode ? g.sumNet + displayContTare : g.sumGross;
                  return (
                    <tr key={idx} className={rowCls}>
                      <td className="c col-nx">{g.count}x</td>
                      <td className="col-code" style={{ fontFamily: 'monospace' }}>{it.article_code}</td>
                      <td className="col-desc">{it.description || '–'}</td>
                      <td className="c col-qty">{it.quantity}</td>
                      <td className="c col-cont">
                        {cartoneMode ? (
                          <input
                            className="dogana-input"
                            style={{ width: '86px' }}
                            value={displayContName ?? ''}
                            onChange={e => setCartoneLineOverrides(prev => ({ ...prev, [lineKey]: { ...prev[lineKey], name: e.target.value } }))}
                          />
                        ) : (displayContName ?? <span style={{ color: '#f87171' }}>!</span>)}
                      </td>
                      <td className="c col-dims">
                        {cartoneMode ? (
                          <input
                            className="dogana-input"
                            style={{ width: '86px' }}
                            value={displayDims}
                            onChange={e => setCartoneLineOverrides(prev => ({ ...prev, [lineKey]: { ...prev[lineKey], dims: e.target.value } }))}
                          />
                        ) : rawDims}
                      </td>
                      <td className="c col-ucost">
                        {prezziOrdineMode ? (
                          <input
                            className="dogana-input"
                            style={{ width: '70px' }}
                            type="number" min="0" step="0.01"
                            value={priceOverrides[it.article_code] !== undefined
                              ? priceOverrides[it.article_code]
                              : String(bcPrices[it.article_code] != null ? Number(bcPrices[it.article_code].toFixed(2)) : (it.unit_cost ?? ''))}
                            onChange={e => setPriceOverrides(prev => ({ ...prev, [it.article_code]: e.target.value }))}
                          />
                        ) : (it.unit_cost != null ? it.unit_cost.toFixed(2) : '–')}
                      </td>
                      <td className="c col-unitkg">{it.unit_weight_kg != null ? it.unit_weight_kg.toFixed(4) : <span style={{ color: '#f87171' }}>-</span>}</td>
                      <td className="c col-tare">
                        {cartoneMode ? (
                          <input
                            className="dogana-input"
                            style={{ width: '60px' }}
                            type="number" min="0" step="0.001"
                            value={cartoneLineOverrides[lineKey]?.tare ?? String(g.count * cartoneTareKgNum)}
                            onChange={e => setCartoneLineOverrides(prev => ({ ...prev, [lineKey]: { ...prev[lineKey], tare: e.target.value } }))}
                          />
                        ) : displayContTare.toFixed(3)}
                      </td>
                      <td className="c col-lnet">{g.sumNet.toFixed(3)}</td>
                      <td className="c col-lgross" style={{ fontWeight: 600 }}>{displayGross.toFixed(3)}</td>
                      <td className="c col-lcost">{(() => {
                        if (!prezziOrdineMode) return g.missingCost ? '–' : g.sumCost.toFixed(2);
                        const uc = priceOverrides[it.article_code] !== undefined
                          ? parseFloat(priceOverrides[it.article_code])
                          : (bcPrices[it.article_code] ?? it.unit_cost);
                        return uc != null ? (uc * it.quantity * g.count).toFixed(2) : '–';
                      })()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Summary box */}
      <div className="border border-gray-400 rounded px-3 py-1.5 mt-3 ml-auto text-xs" style={{ width: 'fit-content' }}>
        <span className="mr-4"><b>Pallets:</b> {totalPallets}</span>
        <span className="mr-4"><b>Packages:</b> {totalPackages}</span>
        <span className="mr-4"><b>Net:</b> {totalNetKg.toFixed(3)} kg</span>
        <span className="mr-4"><b>Gross:</b> {totalGrossKg.toFixed(3)} kg</span>
        <span><b>Total value:</b> {currency} {totalCost.toFixed(2)}</span>
      </div>

      {/* Ordini di vendita table */}
      {ordiniMode && ordiniLines.length > 0 && (() => {
        const chunk = Math.ceil(ordiniLines.length / 3);
        const cols  = [ordiniLines.slice(0, chunk), ordiniLines.slice(chunk, chunk * 2), ordiniLines.slice(chunk * 2)];
        return (
          <div className="mt-5" style={{ breakBefore: 'page', pageBreakBefore: 'always' }}>
            <div className="font-bold uppercase text-xs mb-1 border-b border-gray-300 pb-1">Sales Orders</div>
            <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
              {cols.filter(c => c.length > 0).map((colLines, ci) => (
                <table key={ci} className="dog-table" style={{ width: 'auto', tableLayout: 'auto', flex: '0 0 auto' }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Qty</th>
                      <th>Sales Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colLines.map((line, i) => {
                      const dispQty  = dispatchQtyByArticle[line.article_code] || 0;
                      const ordTotal = ordiniQtyByArticle[line.article_code]   || 0;
                      const rowCls   = dispQty > 0 && dispQty === ordTotal ? 'ordini-ok' : 'ordini-err';
                      return (
                        <tr key={i} className={rowCls}>
                          <td style={{ fontFamily: 'monospace' }}>{line.article_code}</td>
                          <td className="r">{line.quantity}</td>
                          <td>{line.contract_number || '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </div>
          </div>
        );
      })()}

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
  const doganaExcelRef = useRef<(() => void) | null>(null);

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
  if (!logistics) return <div className="p-8 text-center text-red-500">Shipment not found.</div>;

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
          html, body { margin: 0 !important; padding: 0 !important; overflow: visible !important; height: auto !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; height: auto !important; }
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
              🧾 Customs / PDF
            </button>
            {view === 'dogana' && (
              <button
                onClick={() => doganaExcelRef.current?.()}
                className="text-sm px-3 py-1.5 rounded-lg border border-green-600 text-green-700 hover:bg-green-50 transition-colors"
              >
                Scarica Excel
              </button>
            )}
            <button onClick={() => window.print()} className="btn-secondary text-sm">
              🖨 Stampa
            </button>
          </div>
        </div>

        {/* Standard view */}
        {view === 'standard' && (
          <div className="max-w-4xl mx-auto">
            <p><strong>Destination:</strong> {logistics.destination_name || logistics.type || '–'}</p>
            <p><strong>Creation date:</strong> {fmtDate(logistics.created_at)}</p>
            <p><strong>Total pallets:</strong> {logistics.pallets.length}</p>

            <div className="section-box"><h2 className="section-title">Articles summary</h2></div>

            <h3 className="subsection-title">Commissioned articles</h3>
            <SummaryTable rows={withCommessa} />

            <h3 className="subsection-title">MRP articles</h3>
            <SummaryTable rows={withoutCommessa} />

            <div className="section-box page-break"><h2 className="section-title">Detail by pallet</h2></div>

            {logistics.pallets.filter(p => p.items.length > 0).map(pallet => (
              <div key={pallet.id} className="mb-4">
                <h3 className="subsection-title">Pallet #{pallet.number}</h3>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-gray-300 bg-gray-100">
                      <th className="py-1.5 px-2 text-left">Article</th>
                      <th className="py-1.5 px-2 text-left">Description</th>
                      <th className="py-1.5 px-2 text-right">Qty</th>
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
                      <strong>{g.group_name || `Group ${g.commessa_group}`}:</strong> {g.commesse}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Dogana view */}
        {view === 'dogana' && <DoganaView dispatch={logistics} downloadRef={doganaExcelRef} />}
      </div>
    </>
  );
}
