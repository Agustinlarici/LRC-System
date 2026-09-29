'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ProdArea, ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';

const PAGE_SIZE = 500;

const btnBase      = 'inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors';
const btnPrimary   = `${btnBase} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btnBase} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`;
const btnDark      = `${btnBase} bg-gray-700 text-white hover:bg-gray-800`;

// Limite righe mostrate/stampate di default — evita di mandare in stampa
// 500 righe per sbaglio quando non c'è nessun altro filtro attivo.
const DEFAULT_MAX = '20';

interface SheetResponse {
  area:  ProdArea | null;
  rows:  ProdSheetRow[];
  total: number;
}

export default function ProduzioneAreaSheetPage() {
  const params = useParams<{ areaId: string }>();
  const areaId = params.areaId;

  const [area,        setArea]        = useState<ProdArea | null>(null);
  const [rows,        setRows]        = useState<ProdSheetRow[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
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

  // Carica tutte le pagine: la limitazione delle righe è gestita dal filtro "Max righe".
  const loadAll = useCallback(async () => {
    const storicoParam = storico ? '&storico=1' : '';
    let all: ProdSheetRow[] = [];
    let tot = 0;
    do {
      const d = await api.get<SheetResponse>(`/api/prod/aree/${areaId}/foglio?limit=${PAGE_SIZE}&offset=${all.length}${storicoParam}`);
      setArea(d.area);
      tot = d.total;
      if (d.rows.length === 0) break;
      all = [...all, ...d.rows];
    } while (all.length < tot);
    setRows(all);
    setTotal(tot);
  }, [areaId, storico]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadAll()
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [loadAll]);

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
          <h1 className="text-2xl font-bold text-gray-900">Programma Produzione</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {storico ? 'Storico ordini spediti' : 'Area di montaggio'}: <span className="text-red-600 font-medium">{area?.description}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/produzione" className={btnSecondary}>← Programma Produzione</Link>
          <button
            onClick={() => setStorico(s => !s)}
            className={storico ? btnDark : btnSecondary}
          >
            {storico ? '← Torna al foglio' : 'Vedi storico'}
          </button>
          <button
            onClick={() => window.print()}
            className={btnPrimary}
          >
            🖨️ Stampa
          </button>
        </div>
      </div>

      {/* ── Filtri (solo schermo) ────────────────────────────────────────── */}
      <div className="d-print-none bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Filtri</h2>
          {hasActiveFilters && (
            <button onClick={resetFiltri} className={btnSecondary}>
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
          <div className="flex items-center gap-2">
            <label htmlFor="fMax" className="text-sm text-gray-500 whitespace-nowrap">Righe da mostrare</label>
            <input id="fMax" value={fMax} onChange={e => setFMax(e.target.value)} type="number" min={1} placeholder="Tutte"
              title="Numero massimo di righe da mostrare/stampare — vuoto = tutte"
              className={`${inputClass} w-full min-w-0`} />
          </div>
        </div>
        {filteredRows.length !== rows.length && (
          <p className="text-xs text-gray-500 mt-3">
            Mostrando {filteredRows.length} di {rows.length} righe
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

      </div>
    </div>
  );
}
