'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ProdSheetRow } from '@/types';
import { SheetTable } from '../_components/SheetTable';
import { FilterField } from '../_components/FilterField';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

const PAGE_SIZE = 500;

// Limite righe mostrate/stampate di default — evita di mandare in stampa
// 500 righe per sbaglio quando non c'è nessun altro filtro attivo.
const DEFAULT_MAX = '20';

interface SheetResponse {
  rows:  ProdSheetRow[];
  total: number;
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-card shadow-card px-5 py-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${accent ?? 'text-ink-900'}`}>{value}</p>
    </div>
  );
}

export default function ProduzioneTuttoPage() {
  const [rows,       setRows]       = useState<ProdSheetRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [storico,    setStorico]    = useState(false);

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
    const d = await api.get<SheetResponse>(`/api/prod/foglio?limit=${PAGE_SIZE}&offset=${offset}${storicoParam}`);
    setTotal(d.total);
    setRows(prev => offset === 0 ? d.rows : [...prev, ...d.rows]);
  }, [storico]);

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

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma Produzione', href: '/produzione' }}
        title="Tutti gli ordini"
        description={storico ? 'Storico ordini spediti' : 'Foglio completo, senza filtro per area di montaggio'}
        badge={<StatusBadge tone={storico ? 'neutral' : 'info'}>{storico ? 'Storico' : 'Tutte le aree'}</StatusBadge>}
        actions={
          <>
            <Button onClick={() => setStorico(s => !s)}>
              {storico ? '← Torna al foglio' : 'Vedi storico'}
            </Button>
            <Button variant="primary" onClick={() => window.print()}>Stampa</Button>
          </>
        }
      />

      {!loading && !error && (
        <div className="d-print-none grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Caricati" value={rows.length} />
          <StatCard label="Confermato" value={confermatoCount} accent="text-success" />
          <StatCard label="Forecast" value={forecastCount} accent="text-warning" />
          <StatCard label="Spedito" value={speditoCount} accent="text-muted" />
        </div>
      )}

      <div className="bg-white rounded-card shadow-card overflow-hidden print:shadow-none print:rounded-none print:overflow-visible">
        {!loading && !error && (
          <div className="d-print-none p-5 border-b border-line">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-sm text-muted">
                <span className="font-semibold text-ink-900">{filteredRows.length}</span> di {rows.length} caricati
              </p>
              {hasActiveFilters && (
                <Button variant="ghost" onClick={resetFiltri}>Cancella filtri</Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <FilterField label="Commessa">
                <input value={fCommessa} onChange={e => setFCommessa(e.target.value)} placeholder="Es. FL12345" className="input" />
              </FilterField>
              <FilterField label="Codice articolo">
                <input value={fCodice} onChange={e => setFCodice(e.target.value)} placeholder="Es. 12345" className="input" />
              </FilterField>
              <FilterField label="Origine">
                <select value={fOrigine} onChange={e => setFOrigine(e.target.value as typeof fOrigine)} className="input">
                  <option value="">Tutte</option>
                  <option value="confermato">Confermato</option>
                  <option value="forecast">Forecast</option>
                </select>
              </FilterField>
              <FilterField label="Stato">
                <select value={fStato} onChange={e => setFStato(e.target.value as typeof fStato)} className="input">
                  <option value="">Tutti</option>
                  <option value="attivo">Attivo</option>
                  <option value="spedito">Spedito</option>
                </select>
              </FilterField>
              <FilterField label="Colore">
                <select value={fColore} onChange={e => setFColore(e.target.value)} className="input">
                  <option value="">Tutti</option>
                  {coloriDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FilterField>
              <FilterField label="Categoria / caratteristica">
                <input value={fCaratt} onChange={e => setFCaratt(e.target.value)} placeholder="Es. Pelle nera" className="input" />
              </FilterField>
              <FilterField label="Righe da mostrare" highlight>
                <input value={fMax} onChange={e => setFMax(e.target.value)} type="number" min={1} placeholder="Tutte"
                  title="Numero massimo di righe da mostrare/stampare — vuoto = nessun limite"
                  className="input text-center font-semibold !bg-accent-soft" />
              </FilterField>
            </div>
          </div>
        )}

        {/* ── Contenuto stampabile — struttura identica a prima (stesso
            nesting, stesse classi), a parte le righe passate a SheetTable
            (riflettono i filtri attivi) e il titolo qui sotto: è "only-print",
            nascosto a schermo (sostituito dall'header sopra) ma sempre
            presente e visibile in stampa esattamente come prima. ────────── */}
        <div className="print-a4" style={{ fontSize: '0.78rem' }}>
          <div className="only-print mb-4 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Programma Produzione</h1>
            <p className="text-gray-500">
              {storico ? 'Storico ordini spediti' : 'Tutti gli ordini — nessuna area di montaggio richiesta'}
            </p>
          </div>

          {loading ? (
            <p className="text-muted text-center p-12">Caricamento in corso...</p>
          ) : error ? (
            <div className="m-5 p-4 bg-danger-soft text-danger rounded-ctl text-sm">{error}</div>
          ) : (
            <>
              <SheetTable rows={filteredRows} />
              {rows.length < total && (
                <div className="d-print-none p-5 border-t border-line text-center">
                  <p className="text-sm text-muted mb-2">Mostrando {rows.length} di {total}</p>
                  <Button variant="primary" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Caricamento...' : `Carica altri ${Math.min(PAGE_SIZE, total - rows.length)}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
