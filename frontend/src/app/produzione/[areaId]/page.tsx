'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ProdArea, ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

const PAGE_SIZE = 500;

// Wrapper con label sopra ogni campo filtro — così tutti i controlli hanno la
// stessa altezza/allineamento invece di mischiare input "nudi" e con label.
function FilterField({ label, highlight, children }: { label: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-medium ${highlight ? 'text-ink-900' : 'text-muted'}`}>{label}</label>
      {children}
    </div>
  );
}

// Limite righe mostrate/stampate di default — evita di mandare in stampa
// 500 righe per sbaglio quando non c'è nessun altro filtro attivo.
const DEFAULT_MAX = '200';

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

  const selectClass = 'input';
  const inputClass  = 'input';

  if (loading) {
    return <p className="text-muted pt-10 text-center">Caricamento in corso...</p>;
  }
  if (error) {
    return <div className="p-4 bg-danger-soft text-danger rounded-ctl text-sm">{error}</div>;
  }

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma Produzione', href: '/produzione' }}
        title={area?.description ?? ''}
        badge={
          <StatusBadge tone={storico ? 'neutral' : 'brand'}>
            {storico ? 'Storico ordini spediti' : 'Area di montaggio'}
          </StatusBadge>
        }
        actions={
          <>
            <Button onClick={() => setStorico(s => !s)}>
              {storico ? '← Torna al foglio' : 'Vedi storico'}
            </Button>
            <Button variant="primary" onClick={() => window.print()}>Stampa</Button>
          </>
        }
      />

      <div className="bg-white rounded-card shadow-card overflow-hidden print:shadow-none print:rounded-none print:overflow-visible">
      <div className="d-print-none p-5 border-b border-line">
        {/* Filtri */}
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="text-sm text-muted">
              <span className="font-semibold text-ink-900">{filteredRows.length}</span> di {rows.length} righe
            </p>
            {hasActiveFilters && (
              <Button variant="ghost" onClick={resetFiltri}>Cancella filtri</Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <FilterField label="Commessa">
              <input value={fCommessa} onChange={e => setFCommessa(e.target.value)} placeholder="Es. FL12345"
                className={inputClass} />
            </FilterField>
            <FilterField label="Codice articolo">
              <input value={fCodice} onChange={e => setFCodice(e.target.value)} placeholder="Es. 12345"
                className={inputClass} />
            </FilterField>
            <FilterField label="Origine">
              <select value={fOrigine} onChange={e => setFOrigine(e.target.value as typeof fOrigine)} className={selectClass}>
                <option value="">Tutte</option>
                <option value="confermato">Confermato</option>
                <option value="forecast">Forecast</option>
              </select>
            </FilterField>
            <FilterField label="Stato">
              <select value={fStato} onChange={e => setFStato(e.target.value as typeof fStato)} className={selectClass}>
                <option value="">Tutti</option>
                <option value="attivo">Attivo</option>
                <option value="spedito">Spedito</option>
              </select>
            </FilterField>
            <FilterField label="Colore">
              <select value={fColore} onChange={e => setFColore(e.target.value)} className={selectClass}>
                <option value="">Tutti</option>
                {coloriDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FilterField>
            <FilterField label="Categoria / caratteristica">
              <input value={fCaratt} onChange={e => setFCaratt(e.target.value)} placeholder="Es. Pelle nera"
                className={inputClass} />
            </FilterField>
            <FilterField label="Righe da mostrare" highlight>
              <input id="fMax" value={fMax} onChange={e => setFMax(e.target.value)} type="number" min={1} placeholder="Tutte"
                title="Numero massimo di righe da mostrare/stampare — vuoto = tutte"
                className="input text-center font-semibold" />
            </FilterField>
          </div>
        </div>
      </div>

      {/* ── Contenuto stampabile — struttura identica a prima, a parte le
          righe passate a SheetTable (riflettono i filtri attivi) e il
          titolo qui sotto: è "only-print", nascosto a schermo (sostituito
          dall'header sopra) ma sempre visibile in stampa come prima. ────── */}
      <div className="print-a4" style={{ fontSize: '0.78rem' }}>
        <div className="only-print mb-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Programma Produzione</h1>
          <p className="text-gray-500">
            {storico ? 'Storico ordini spediti' : 'Area di montaggio'}: <span className="text-brand font-medium">{area?.description}</span>
          </p>
        </div>

        <SheetTable rows={filteredRows} />

      </div>
      </div>
    </div>
  );
}
