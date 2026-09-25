'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ProdArea, ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';

const PAGE_SIZE = 500;

// Limite righe mostrate/stampate di default — evita di mandare in stampa
// 500 righe per sbaglio quando non c'è nessun altro filtro attivo.
const DEFAULT_MAX = '20';

interface SheetResponse {
  area:  ProdArea | null;
  rows:  ProdSheetRow[];
  total: number;
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export default function ProduzioneAreaSheetPage() {
  const params = useParams<{ areaId: string }>();
  const areaId = params.areaId;

  const [area,        setArea]        = useState<ProdArea | null>(null);
  const [rows,        setRows]        = useState<ProdSheetRow[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [storico,     setStorico]     = useState(false);

  // Filtri separati per campo — solo sullo schermo, senza toccare la
  // struttura/stile della stampa (vedi SheetTable, invariato).
  const [fCommessa, setFCommessa] = useState('');
  const [fCodice,   setFCodice]   = useState('');
  const [fOrigine,  setFOrigine]  = useState<'' | 'confermato' | 'forecast'>('');
  const [fStato,    setFStato]    = useState<'' | 'attivo' | 'spedito'>('');
  const [fColore,   setFColore]   = useState('');
  const [fCaratt,   setFCaratt]   = useState('');
  const [fMax,      setFMax]      = useState(DEFAULT_MAX); // vuoto = nessun limite

  const loadPage = useCallback(async (offset: number) => {
    const storicoParam = storico ? '&storico=1' : '';
    const d = await api.get<SheetResponse>(`/api/prod/aree/${areaId}/foglio?limit=${PAGE_SIZE}&offset=${offset}${storicoParam}`);
    setArea(d.area);
    setTotal(d.total);
    setRows(prev => offset === 0 ? d.rows : [...prev, ...d.rows]);
  }, [areaId, storico]);

  useEffect(() => {
    setLoading(true);
    loadPage(0)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [loadPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      await loadPage(rows.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const coloriDisponibili = useMemo(
    () => [...new Set(rows.map(r => r.colore).filter((c): c is string => !!c))].sort(),
    [rows],
  );

  const hasActiveFilters = !!(fCommessa || fCodice || fOrigine || fStato || fColore || fCaratt || fMax !== DEFAULT_MAX);

  function resetFiltri() {
    setFCommessa(''); setFCodice(''); setFOrigine(''); setFStato(''); setFColore(''); setFCaratt(''); setFMax(DEFAULT_MAX);
  }

  const filteredRows = useMemo(() => {
    const commessaQ = fCommessa.trim().toLowerCase();
    const codiceQ   = fCodice.trim().toLowerCase();
    const carattQ   = fCaratt.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (commessaQ && !r.commessa.toLowerCase().includes(commessaQ)) return false;
      if (codiceQ && !r.codice_articolo.toLowerCase().includes(codiceQ)) return false;
      if (fOrigine && r.fonte_ordine !== fOrigine) return false;
      if (fStato === 'attivo' && r.chiuso) return false;
      if (fStato === 'spedito' && !r.chiuso) return false;
      if (fColore && r.colore !== fColore) return false;
      if (carattQ) {
        const match = r.categorie.some(cat => cat.caratteristiche.some(c => c.valore.toLowerCase().includes(carattQ)));
        if (!match) return false;
      }
      return true;
    });
    const max = parseInt(fMax, 10);
    return fMax.trim() && Number.isFinite(max) && max > 0 ? filtered.slice(0, max) : filtered;
  }, [rows, fCommessa, fCodice, fOrigine, fStato, fColore, fCaratt, fMax]);

  const confermatoCount = useMemo(() => rows.filter(r => r.fonte_ordine === 'confermato').length, [rows]);
  const forecastCount   = useMemo(() => rows.filter(r => r.fonte_ordine === 'forecast').length, [rows]);
  const speditoCount    = useMemo(() => rows.filter(r => r.chiuso).length, [rows]);

  const selectClass = 'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  const inputClass  = 'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  if (loading) {
    return <p className="text-gray-400 pt-10 text-center">Caricamento in corso...</p>;
  }
  if (error) {
    return <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>;
  }

  return (
    <div>
      {/* ── Header moderno (solo schermo) ─────────────────────────────────── */}
      <div className="d-print-none mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/produzione" className="text-sm text-gray-500 hover:text-gray-700">← Programma Produzione</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Programma Produzione</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {storico ? 'Storico ordini spediti' : 'Area di montaggio'}: <span className="text-red-600 font-medium">{area?.description}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStorico(s => !s)}
            className={`text-sm px-3 py-2 rounded-lg transition-colors ${
              storico ? 'bg-gray-700 text-white hover:bg-gray-800' : 'border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {storico ? '← Torna al foglio' : 'Vedi storico'}
          </button>
          <button
            onClick={() => window.print()}
            className="text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            🖨️ Stampa
          </button>
        </div>
      </div>

      {/* ── Statistiche rapide (solo schermo) ───────────────────────────── */}
      <div className="d-print-none grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Caricati" value={rows.length} />
        <StatCard label="Confermato" value={confermatoCount} accent="text-green-600" />
        <StatCard label="Forecast" value={forecastCount} accent="text-yellow-600" />
        <StatCard label="Spedito" value={speditoCount} accent="text-gray-500" />
      </div>

      {/* ── Filtri (solo schermo) ────────────────────────────────────────── */}
      <div className="d-print-none bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Filtri</h2>
          {hasActiveFilters && (
            <button onClick={resetFiltri} className="text-xs text-gray-400 hover:text-gray-600">
              Pulisci filtri
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          <input value={fCommessa} onChange={e => setFCommessa(e.target.value)} placeholder="Commessa"
            className={inputClass} />
          <input value={fCodice} onChange={e => setFCodice(e.target.value)} placeholder="Codice Articolo"
            className={inputClass} />
          <select value={fOrigine} onChange={e => setFOrigine(e.target.value as typeof fOrigine)} className={selectClass}>
            <option value="">Origine — Tutte</option>
            <option value="confermato">Confermato</option>
            <option value="forecast">Forecast</option>
          </select>
          <select value={fStato} onChange={e => setFStato(e.target.value as typeof fStato)} className={selectClass}>
            <option value="">Stato — Tutti</option>
            <option value="attivo">Attivo</option>
            <option value="spedito">Spedito</option>
          </select>
          <select value={fColore} onChange={e => setFColore(e.target.value)} className={selectClass}>
            <option value="">Colore — Tutti</option>
            {coloriDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={fCaratt} onChange={e => setFCaratt(e.target.value)} placeholder="Categoria / caratteristica"
            className={inputClass} />
          <input value={fMax} onChange={e => setFMax(e.target.value)} type="number" min={1} placeholder="Max righe"
            title="Numero massimo di righe da mostrare/stampare — vuoto = nessun limite"
            className={inputClass} />
        </div>
        {filteredRows.length !== rows.length && (
          <p className="text-xs text-gray-400 mt-3">
            Mostrando {filteredRows.length} di {rows.length} caricati
          </p>
        )}
      </div>

      {/* ── Contenuto stampabile — struttura identica a prima, a parte le
          righe passate a SheetTable (riflettono i filtri attivi) e il
          titolo qui sotto: è "only-print", nascosto a schermo (sostituito
          dall'header sopra) ma sempre visibile in stampa come prima. ────── */}
      <div className="print-a4" style={{ fontSize: '0.78rem' }}>
        <div className="only-print mb-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Programma Produzione</h1>
          <p className="text-gray-500">
            {storico ? 'Storico ordini spediti' : 'Area di montaggio'}: <span className="text-red-600 font-medium">{area?.description}</span>
          </p>
        </div>

        <SheetTable rows={filteredRows} />

        {rows.length < total && (
          <div className="d-print-none mt-4 text-center">
            <p className="text-sm text-gray-500 mb-2">Mostrando {rows.length} di {total}</p>
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? 'Caricamento...' : `Carica altri ${Math.min(PAGE_SIZE, total - rows.length)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
