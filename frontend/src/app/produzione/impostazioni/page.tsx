'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type {
  ProdArea, ProdKeywordRule, ProdKeywordMode, ProdColorKeyword, ProdColorSettings,
  ProdItemAttributeLabel, ProdArticleInfo, ProdArticleAssignment,
} from '@/types';
import { ExcelImportButton } from '../_components/ExcelImportButton';

type Tab = 'Aree' | 'Categoria - Area' | 'Regole Parole Chiave' | 'Colori' | 'Attributi BC' | 'Caratteristiche Manuali';
const TABS: Tab[] = ['Aree', 'Categoria - Area', 'Regole Parole Chiave', 'Colori', 'Attributi BC', 'Caratteristiche Manuali'];

// Deve coincidere con EMPTY_FILTER_VALUE in backend/routes.ts — valore
// riservato per l'opzione "(vuoto)" nei filtri Categoria/Area.
const EMPTY_FILTER_VALUE = '__EMPTY__';

// ─── Aree di montaggio ─────────────────────────────────────────────────────────

function TabAree() {
  const [aree,    setAree]    = useState<ProdArea[]>([]);
  const [code,    setCode]    = useState('');
  const [descr,   setDescr]   = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(() => {
    api.get<ProdArea[]>('/api/prod/aree').then(setAree).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addArea() {
    if (!code.trim() || !descr.trim()) return;
    setBusy(true);
    try {
      await api.post<ProdArea>('/api/prod/aree', { code: code.trim(), description: descr.trim() });
      setCode(''); setDescr(''); load();
    } finally { setBusy(false); }
  }

  async function delArea(id: number) {
    if (!confirm('Eliminare quest\'area? I codici assegnati restano con la loro categoria, ma perdono l\'area.')) return;
    await api.delete(`/api/prod/aree/${id}`);
    load();
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Per assegnare codici articolo a un&apos;area, vai alla tab &quot;Categoria - Area&quot;.
      </p>

      <div className="flex gap-2 mb-4">
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Codice (es. LINEA1)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={descr} onChange={e => setDescr(e.target.value)} placeholder="Descrizione area"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && addArea()} />
        <button onClick={addArea} disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>

      <div className="mb-4">
        <ExcelImportButton endpoint="/api/prod/aree/import-excel" onDone={load} label="Carica aree da Excel (Codice, Descrizione)" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {aree.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Nessuna area</p>}
        {aree.map(a => (
          <div key={a.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800">{a.description}</p>
              <p className="text-xs text-gray-400">{a.code}</p>
            </div>
            <button onClick={() => delArea(a.id)} className="text-xs text-red-500 hover:text-red-700">Elimina</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Categoria - Area per articolo (rimpiazzo "vince l'ultimo" + assegnazione) ─

function TabCategoriaArea() {
  const [rows,       setRows]       = useState<ProdArticleAssignment[]>([]);
  const [areas,      setAreas]      = useState<ProdArea[]>([]);
  const [categorie,  setCategorie]  = useState<string[]>([]);
  const [codice,     setCodice]     = useState('');
  const [categoria,  setCategoria]  = useState('');
  const [areaId,     setAreaId]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [busy,       setBusy]       = useState(false);
  const [bulkBusy,   setBulkBusy]   = useState(false);

  // Filtri per colonna (uno per Codice Articolo, Categoria, Area) — combinati
  // in AND lato server, non un'unica ricerca su tutti i campi. Categoria e
  // Area sono un menu a tendina con i valori esistenti (vedi `categorie`
  // sotto e `areas` sopra) — Codice resta testo libero: i codici articolo
  // sono troppi (potenzialmente migliaia) per un menu a tendina utilizzabile.
  const [fCodice,    setFCodice]    = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fArea,      setFArea]      = useState('');

  const buildQs = useCallback((c: string, cat: string, a: string) => {
    const params = new URLSearchParams();
    if (c.trim())   params.set('codice', c.trim());
    if (cat.trim()) params.set('categoria', cat.trim());
    if (a.trim())   params.set('area', a.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, []);

  const load = useCallback((c: string, cat: string, a: string) => {
    Promise.all([
      api.get<ProdArticleAssignment[]>(`/api/prod/article-assignments${buildQs(c, cat, a)}`),
      api.get<ProdArea[]>('/api/prod/aree'),
      api.get<string[]>('/api/prod/article-assignments/categories'),
    ]).then(([r, a2, cats]) => { setRows(r); setAreas(a2); setCategorie(cats); }).finally(() => setLoading(false));
  }, [buildQs]);
  useEffect(() => { load('', '', ''); }, [load]);

  function onFilterChange(next: { codice?: string; categoria?: string; area?: string }) {
    const c   = next.codice    ?? fCodice;
    const cat = next.categoria ?? fCategoria;
    const a   = next.area      ?? fArea;
    if (next.codice    !== undefined) setFCodice(next.codice);
    if (next.categoria !== undefined) setFCategoria(next.categoria);
    if (next.area      !== undefined) setFArea(next.area);
    load(c, cat, a);
  }

  async function addRow() {
    if (!codice.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/prod/article-assignments', {
        codiceArticolo: codice.trim(),
        categoria:      categoria.trim() || null,
        areaId:         areaId ? parseInt(areaId, 10) : null,
      });
      setCodice(''); setCategoria(''); setAreaId('');
      load(fCodice, fCategoria, fArea);
    } finally { setBusy(false); }
  }

  async function delRow(codiceArticolo: string) {
    await api.delete(`/api/prod/article-assignments/${encodeURIComponent(codiceArticolo)}`);
    load(fCodice, fCategoria, fArea);
  }

  const hasFilter = !!(fCodice.trim() || fCategoria.trim() || fArea.trim());

  // Cancella TUTTI i codici che rispettano i filtri (non solo i 500
  // mostrati) — richiede almeno un filtro, il backend rifiuta altrimenti.
  async function delAllFiltered() {
    if (!hasFilter) return;
    if (!confirm('Eliminare TUTTI i codici che corrispondono ai filtri impostati? L\'azione non è reversibile.')) return;
    setBulkBusy(true);
    try {
      const res = await api.delete<{ status: string; count: number }>(
        `/api/prod/article-assignments${buildQs(fCodice, fCategoria, fArea)}`
      );
      alert(`Eliminati ${res.count} codici.`);
      load(fCodice, fCategoria, fArea);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Ogni codice articolo ha una <strong>categoria</strong> (per il motore di rimpiazzo &quot;vince
        l&apos;ultimo&quot; — se due articoli della stessa categoria arrivano per la stessa commessa, il
        foglio ne mostra uno solo: un ordine Confermato batte sempre un Forecast, a parità di fonte
        vince il più recente; gli scartati compaiono nella
        sezione <Link href="/produzione/conflitti" className="underline">Duplicati</Link>) e
        un&apos;<strong>area</strong> (dove compare nel foglio) — completamente indipendenti tra loro.
      </p>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
        <p className="text-xs text-blue-800 mb-2">
          <strong>Carica veloce:</strong> un solo file con Codice Articolo, Categoria e Area
          (entrambe opzionali) — assegna tutto in un colpo solo. Le aree devono già esistere (tab &quot;Aree&quot;).
        </p>
        <ExcelImportButton
          endpoint="/api/prod/article-category-area/import-excel"
          onDone={() => load(fCodice, fCategoria, fArea)}
          label="Carica Excel (Codice Articolo, Categoria, Area)"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Aggiungi / modifica un codice</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={codice} onChange={e => setCodice(e.target.value)} placeholder="Codice Articolo"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={categoria} onChange={e => setCategoria(e.target.value)} placeholder="Categoria (es. PARAURTI)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={areaId} onChange={e => setAreaId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Nessuna area —</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.description}</option>)}
          </select>
        </div>
        <button onClick={addRow} disabled={busy || !codice.trim()}
          className="mt-2 bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Salva
        </button>
      </div>

      <div className="flex justify-end mb-2">
        <button onClick={delAllFiltered} disabled={!hasFilter || bulkBusy}
          title={hasFilter ? '' : 'Imposta almeno un filtro per abilitare la cancellazione in blocco'}
          className="text-sm text-red-600 border border-red-200 px-3 py-2 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          {bulkBusy ? 'Eliminazione...' : 'Elimina tutti i filtrati'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Codice Articolo</th>
              <th className="py-2.5 px-4 text-left font-medium">Categoria</th>
              <th className="py-2.5 px-4 text-left font-medium">Area</th>
              <th className="py-2.5 px-4" />
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 pb-2">
                <input value={fCodice} onChange={e => onFilterChange({ codice: e.target.value })} placeholder="Filtra..."
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </th>
              <th className="px-4 pb-2">
                <select value={fCategoria} onChange={e => onFilterChange({ categoria: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  <option value={EMPTY_FILTER_VALUE}>(vuoto)</option>
                  {categorie.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2">
                <select value={fArea} onChange={e => onFilterChange({ area: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  <option value={EMPTY_FILTER_VALUE}>(vuoto)</option>
                  {areas.map(a => <option key={a.id} value={a.description}>{a.description}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-6">Nessun codice trovato</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.codice_articolo} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-mono">{r.codice_articolo}</td>
                <td className="py-2 px-4">{r.categoria ?? <span className="text-gray-300">–</span>}</td>
                <td className="py-2 px-4">{r.area_description ?? <span className="text-gray-300">–</span>}</td>
                <td className="py-2 px-4 text-right">
                  <button onClick={() => delRow(r.codice_articolo)} className="text-xs text-red-500 hover:text-red-700">Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 500 && (
          <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-100">
            Mostrando i primi 500 risultati — usa la ricerca per affinare.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Regole parole chiave ──────────────────────────────────────────────────────

function TabRegole() {
  const [rules,    setRules]    = useState<ProdKeywordRule[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Filtri per colonna (Prefisso, Categoria, Caratteristica, Regola, Note) —
  // combinati in AND, non un'unica ricerca su tutti i campi. Client-side:
  // questa tabella si carica sempre per intero, senza cap lato server.
  const [fPrefisso,  setFPrefisso]  = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fCaratt,    setFCaratt]    = useState('');
  const [fRegola,    setFRegola]    = useState('');
  const [fNote,      setFNote]      = useState('');

  const [modo,        setModo]        = useState<ProdKeywordMode>('simple');
  const [prefisso,    setPrefisso]    = useState('');
  const [categoria,   setCategoria]   = useState('');
  const [caratt,      setCaratt]      = useState('');
  const [parolaCh,    setParolaCh]    = useState('');
  const [ancora,      setAncora]      = useState('');
  const [obiettivo,   setObiettivo]   = useState('');
  const [cercaColore, setCercaColore] = useState(false);
  const [distanza,    setDistanza]    = useState('20');
  const [note,        setNote]        = useState('');

  const load = useCallback(() => {
    api.get<ProdKeywordRule[]>('/api/prod/keyword-rules').then(setRules).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!categoria.trim() || !caratt.trim()) return;
    setBusy(true);
    try {
      const noteVal = note.trim() || undefined;
      const body = modo === 'simple'
        ? { modo, prefissoCommessa: prefisso.trim(), categoria: categoria.trim(), caratteristicaDerivata: caratt.trim(), parolaChiave: parolaCh.trim(), note: noteVal }
        : {
            modo, prefissoCommessa: prefisso.trim(), categoria: categoria.trim(), caratteristicaDerivata: caratt.trim(),
            parolaAncora: ancora.trim(), obiettivoDaColori: cercaColore,
            ...(cercaColore ? {} : { parolaObiettivo: obiettivo.trim() }),
            distanzaMaxCaratteri: parseInt(distanza) || 1, note: noteVal,
          };
      await api.post<ProdKeywordRule>('/api/prod/keyword-rules', body);
      setPrefisso(''); setCategoria(''); setCaratt(''); setParolaCh(''); setAncora(''); setObiettivo(''); setCercaColore(false); setNote('');
      load();
    } finally { setBusy(false); }
  }

  async function toggleActive(r: ProdKeywordRule) {
    await api.put(`/api/prod/keyword-rules/${r.id}/active`, { active: !r.active });
    load();
  }

  async function del(id: number) {
    await api.delete(`/api/prod/keyword-rules/${id}`);
    load();
  }

  // Testo esatto mostrato nella colonna "Regola" — riusato sia per il render
  // sia per popolare/confrontare il menu a tendina del filtro.
  function regolaLabel(r: ProdKeywordRule): string {
    if (r.modo === 'simple') return `"${r.parola_chiave}"`;
    if (r.obiettivo_da_colori) return `"${r.parola_ancora}" → ≤${r.distanza_max_caratteri} car. → colore (da tab "Colori")`;
    return `"${r.parola_ancora}" → ≤${r.distanza_max_caratteri} car. → "${r.parola_obiettivo}"`;
  }

  // Opzioni dei menu a tendina: i valori distinti effettivamente presenti
  // nella tabella (caricata per intero, senza cap lato server).
  const prefissoOptions  = useMemo(() => [...new Set(rules.map(r => r.prefisso_commessa).filter((v): v is string => !!v))].sort(), [rules]);
  const categoriaOptions = useMemo(() => [...new Set(rules.map(r => r.categoria))].sort(), [rules]);
  const carattOptions    = useMemo(() => [...new Set(rules.map(r => r.caratteristica_derivata))].sort(), [rules]);
  const regolaOptions    = useMemo(() => [...new Set(rules.map(regolaLabel))].sort(), [rules]);
  const noteOptions      = useMemo(() => [...new Set(rules.map(r => r.note).filter((v): v is string => !!v))].sort(), [rules]);

  const hasFilter = !!(fPrefisso || fCategoria || fCaratt || fRegola || fNote);

  const filteredRules = useMemo(() => rules.filter(r => {
    if (fPrefisso  && (r.prefisso_commessa ?? '') !== fPrefisso)  return false;
    if (fCategoria && r.categoria !== fCategoria)                 return false;
    if (fCaratt    && r.caratteristica_derivata !== fCaratt)      return false;
    if (fNote      && (r.note ?? '') !== fNote)                   return false;
    if (fRegola    && regolaLabel(r) !== fRegola)                 return false;
    return true;
  }), [rules, fPrefisso, fCategoria, fCaratt, fRegola, fNote]);

  // Elimina in blocco tutte le regole visibili con i filtri correnti — solo
  // quelle caricate in memoria, ma qui non c'è un cap lato server (a
  // differenza di Categoria - Area) quindi coincide sempre con "tutte quelle
  // che matchano". Richiede almeno un filtro per evitare di svuotare
  // l'intera tabella per errore.
  async function delAllFiltered() {
    if (!hasFilter || filteredRules.length === 0) return;
    if (!confirm(`Eliminare TUTTE le ${filteredRules.length} regole che corrispondono ai filtri impostati? L'azione non è reversibile.`)) return;
    setBulkBusy(true);
    try {
      await Promise.all(filteredRules.map(r => api.delete(`/api/prod/keyword-rules/${r.id}`)));
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={modo === 'simple'} onChange={() => setModo('simple')} /> Semplice
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={modo === 'proximity'} onChange={() => setModo('proximity')} /> Prossimità
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input value={prefisso} onChange={e => setPrefisso(e.target.value)} placeholder="Prefisso commessa (vuoto = tutte)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={categoria} onChange={e => setCategoria(e.target.value)} placeholder="Categoria"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={caratt} onChange={e => setCaratt(e.target.value)} placeholder="Caratteristica derivata"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {modo === 'simple' ? (
          <input value={parolaCh} onChange={e => setParolaCh(e.target.value)} placeholder="Parola chiave (substring nella descrizione)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={cercaColore} onChange={e => setCercaColore(e.target.checked)} />
              Cerca colore (usa le parole chiave della tab &quot;Colori&quot; invece di una parola obiettivo fissa)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <input value={ancora} onChange={e => setAncora(e.target.value)} placeholder="Parola ancora"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {cercaColore ? (
                <div className="border border-dashed border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400 flex items-center">
                  qualsiasi colore attivo
                </div>
              ) : (
                <input value={obiettivo} onChange={e => setObiettivo(e.target.value)} placeholder="Parola obiettivo (dopo l'ancora)"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
              <input value={distanza} onChange={e => setDistanza(e.target.value)} type="number" min={1} placeholder="Distanza max (caratteri)"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        )}

        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (es. LIVREA A SCELTA - VEDERE FIGURINO)"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

        <div className="flex items-center gap-2">
          <button onClick={add} disabled={busy}
            className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Aggiungi regola
          </button>
          <ExcelImportButton
            endpoint="/api/prod/keyword-rules/import-excel"
            onDone={load}
            label="Carica da Excel (Prefisso, Categoria, Significato, Note, Parola Chiave [simple] · Parola Ancora, Distanza Max Caratteri + Parola Obiettivo oppure Cerca Colore [prossimità])"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={delAllFiltered} disabled={!hasFilter || bulkBusy || filteredRules.length === 0}
          title={hasFilter ? '' : 'Imposta almeno un filtro per abilitare la cancellazione in blocco'}
          className="text-sm text-red-600 border border-red-200 px-3 py-2 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          {bulkBusy ? 'Eliminazione...' : 'Elimina tutti i filtrati'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Prefisso</th>
              <th className="py-2.5 px-4 text-left font-medium">Categoria</th>
              <th className="py-2.5 px-4 text-left font-medium">Caratteristica</th>
              <th className="py-2.5 px-4 text-left font-medium">Regola</th>
              <th className="py-2.5 px-4 text-left font-medium">Note</th>
              <th className="py-2.5 px-4 text-center font-medium">Attiva</th>
              <th className="py-2.5 px-4" />
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 pb-2">
                <select value={fPrefisso} onChange={e => setFPrefisso(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutti —</option>
                  {prefissoOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2">
                <select value={fCategoria} onChange={e => setFCategoria(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  {categoriaOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2">
                <select value={fCaratt} onChange={e => setFCaratt(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  {carattOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2">
                <select value={fRegola} onChange={e => setFRegola(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  {regolaOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2">
                <select value={fNote} onChange={e => setFNote(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-normal bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Tutte —</option>
                  {noteOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </th>
              <th className="px-4 pb-2" />
              <th className="px-4 pb-2" />
            </tr>
          </thead>
          <tbody>
            {filteredRules.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">Nessuna regola</td></tr>
            )}
            {filteredRules.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-mono">{r.prefisso_commessa || <span className="italic text-gray-400">tutte</span>}</td>
                <td className="py-2 px-4">{r.categoria}</td>
                <td className="py-2 px-4">{r.caratteristica_derivata}</td>
                <td className="py-2 px-4 text-gray-500">
                  {r.modo === 'simple'
                    ? <span>&quot;{r.parola_chiave}&quot;</span>
                    : r.obiettivo_da_colori
                      ? <span>&quot;{r.parola_ancora}&quot; → ≤{r.distanza_max_caratteri} car. → colore (da tab &quot;Colori&quot;)</span>
                      : <span>&quot;{r.parola_ancora}&quot; → ≤{r.distanza_max_caratteri} car. → &quot;{r.parola_obiettivo}&quot;</span>}
                </td>
                <td className="py-2 px-4 text-gray-500 max-w-[240px] truncate" title={r.note ?? ''}>{r.note ?? '–'}</td>
                <td className="py-2 px-4 text-center">
                  <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} />
                </td>
                <td className="py-2 px-4 text-right">
                  <button onClick={() => del(r.id)} className="text-xs text-red-500 hover:text-red-700">Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Parole chiave colore ──────────────────────────────────────────────────────

function TabColori() {
  const [rows,     setRows]     = useState<ProdColorKeyword[]>([]);
  const [keyword,  setKeyword]  = useState('');
  const [color,    setColor]    = useState('');
  const [priority, setPriority] = useState('50');
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);

  const [settings,     setSettings]     = useState<ProdColorSettings | null>(null);
  const [rangeStart,   setRangeStart]   = useState('');
  const [rangeEnd,     setRangeEnd]     = useState('');
  const [rangeBusy,    setRangeBusy]    = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get<ProdColorKeyword[]>('/api/prod/color-keywords'),
      api.get<ProdColorSettings>('/api/prod/color-settings'),
    ]).then(([r, s]) => {
      setRows(r);
      setSettings(s);
      setRangeStart(String(s.searchStart));
      setRangeEnd(String(s.searchEnd));
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!keyword.trim() || !color.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/prod/color-keywords', {
        keyword: keyword.trim(), color: color.trim(),
        priority: priority.trim() ? parseInt(priority, 10) : undefined,
      });
      setKeyword(''); setColor(''); setPriority('50'); load();
    } finally { setBusy(false); }
  }

  async function toggleActive(r: ProdColorKeyword) {
    await api.put(`/api/prod/color-keywords/${r.id}/active`, { active: !r.active });
    load();
  }

  async function savePriority(r: ProdColorKeyword, value: string) {
    const n = parseInt(value, 10);
    if (!Number.isInteger(n) || n === r.priority) return;
    await api.put(`/api/prod/color-keywords/${r.id}/priority`, { priority: n });
    load();
  }

  async function del(id: number) {
    await api.delete(`/api/prod/color-keywords/${id}`);
    load();
  }

  async function saveRange() {
    const start = parseInt(rangeStart, 10);
    const end   = parseInt(rangeEnd, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return;
    setRangeBusy(true);
    try {
      await api.put('/api/prod/color-settings', { searchStart: start, searchEnd: end });
      load();
    } finally { setRangeBusy(false); }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs text-blue-800 mb-2">
          Range di caratteri della descrizione in cui cercare le parole chiave colore — <strong>uguale per tutte</strong>.
          Se trova più colori nella stessa descrizione, vince quello con priorità più bassa (vedi tabella sotto).
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Dal carattere</span>
          <input value={rangeStart} onChange={e => setRangeStart(e.target.value)} type="number" min={0}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-sm text-gray-600">al carattere</span>
          <input value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} type="number" min={1}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={saveRange} disabled={rangeBusy}
            className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Salva
          </button>
          {settings && (
            <span className="text-xs text-gray-400">
              (attuale: {settings.searchStart}–{settings.searchEnd})
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Parola chiave"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={color} onChange={e => setColor(e.target.value)} placeholder="Colore"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <input value={priority} onChange={e => setPriority(e.target.value)} type="number" placeholder="Priorità" title="Priorità (0 = massima, vince sulle altre)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>

      <ExcelImportButton endpoint="/api/prod/color-keywords/import-excel" onDone={load} label="Carica da Excel (Parola Chiave, Colore, Priorità opzionale)" />

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Parola chiave</th>
              <th className="py-2.5 px-4 text-left font-medium">Colore</th>
              <th className="py-2.5 px-4 text-left font-medium">Priorità</th>
              <th className="py-2.5 px-4 text-center font-medium">Attiva</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">Nessuna parola chiave</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4">{r.keyword}</td>
                <td className="py-2 px-4">{r.color}</td>
                <td className="py-2 px-4">
                  <input type="number" defaultValue={r.priority} onBlur={e => savePriority(r, e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </td>
                <td className="py-2 px-4 text-center">
                  <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} />
                </td>
                <td className="py-2 px-4 text-right">
                  <button onClick={() => del(r.id)} className="text-xs text-red-500 hover:text-red-700">Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Attributi BC ──────────────────────────────────────────────────────────────

function TabAttributi() {
  const [rows,    setRows]    = useState<ProdItemAttributeLabel[]>([]);
  const [edits,   setEdits]   = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get<ProdItemAttributeLabel[]>('/api/prod/item-attribute-labels').then(setRows).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(id: number) {
    const label = edits[id];
    if (!label || !label.trim()) return;
    await api.put(`/api/prod/item-attribute-labels/${id}`, { categoriaLabel: label.trim(), active: true });
    load();
  }

  async function toggleActive(r: ProdItemAttributeLabel) {
    await api.put(`/api/prod/item-attribute-labels/${r.item_attribute_id}`, { categoriaLabel: r.categoria_label, active: !r.active });
    load();
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Tutti gli Item Attribute ID trovati in Business Central vengono importati automaticamente
        (sincronizzazione &quot;Attributi BC&quot;). Qui assegni il nome di categoria da mostrare nel foglio di lavoro.
      </p>
      <div className="mb-4">
        <ExcelImportButton endpoint="/api/prod/item-attribute-labels/import-excel" onDone={load} label="Carica da Excel (Item Attribute ID, Nome Categoria)" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Item Attribute ID</th>
              <th className="py-2.5 px-4 text-left font-medium">Nome categoria</th>
              <th className="py-2.5 px-4 text-center font-medium">Attivo</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-6">Nessun attributo sincronizzato ancora</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.item_attribute_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-mono">{r.item_attribute_id}</td>
                <td className="py-2 px-4">
                  <input
                    value={edits[r.item_attribute_id] ?? r.categoria_label}
                    onChange={e => setEdits(prev => ({ ...prev, [r.item_attribute_id]: e.target.value }))}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </td>
                <td className="py-2 px-4 text-center">
                  <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} />
                </td>
                <td className="py-2 px-4 text-right">
                  <button onClick={() => save(r.item_attribute_id)} className="text-xs text-blue-600 hover:text-blue-800">Salva</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Caratteristiche manuali ────────────────────────────────────────────────────

function TabManuali() {
  const [rows,      setRows]      = useState<ProdArticleInfo[]>([]);
  const [codice,     setCodice]     = useState('');
  const [modello,    setModello]    = useState('');
  const [categoria,  setCategoria]  = useState('');
  const [caratt,     setCaratt]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [busy,       setBusy]       = useState(false);

  const load = useCallback(() => {
    api.get<ProdArticleInfo[]>('/api/prod/article-info').then(setRows).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!codice.trim() || !categoria.trim() || !caratt.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/prod/article-info', {
        codiceArticolo: codice.trim(), modello: modello.trim() || undefined,
        categoria: categoria.trim(), caratteristicheManuali: caratt.trim(),
      });
      setCodice(''); setModello(''); setCategoria(''); setCaratt(''); load();
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/prod/article-info/${id}`);
    load();
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs text-gray-500">
          Categoria e caratteristiche possono contenere più valori separati da virgola —
          si applicano a tutte le commesse dell&apos;articolo.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input value={codice} onChange={e => setCodice(e.target.value)} placeholder="Codice articolo"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={modello} onChange={e => setModello(e.target.value)} placeholder="Modello (opzionale)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <input value={categoria} onChange={e => setCategoria(e.target.value)} placeholder="Categoria/e (separate da virgola)"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={caratt} onChange={e => setCaratt(e.target.value)} placeholder="Caratteristica/che (separate da virgola)"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-2">
          <button onClick={add} disabled={busy}
            className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Aggiungi
          </button>
          <ExcelImportButton
            endpoint="/api/prod/article-info/import-excel"
            onDone={load}
            label="Carica da Excel (Codice Articolo, Modello, Categoria, Caratteristiche Manuali)"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Codice</th>
              <th className="py-2.5 px-4 text-left font-medium">Modello</th>
              <th className="py-2.5 px-4 text-left font-medium">Categoria</th>
              <th className="py-2.5 px-4 text-left font-medium">Caratteristiche</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">Nessuna caratteristica manuale</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-mono">{r.codice_articolo}</td>
                <td className="py-2 px-4">{r.modello ?? '–'}</td>
                <td className="py-2 px-4">{r.categoria ?? '–'}</td>
                <td className="py-2 px-4">{r.caratteristiche_manuali ?? '–'}</td>
                <td className="py-2 px-4 text-right">
                  <button onClick={() => del(r.id)} className="text-xs text-red-500 hover:text-red-700">Elimina</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProduzioneImpostazioniPage() {
  const [tab, setTab] = useState<Tab>('Aree');

  return (
    <div>
      <div className="mb-6">
        <Link href="/produzione" className="text-sm text-gray-500 hover:text-gray-700">← Programma Produzione</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Impostazioni</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Aree' && <TabAree />}
      {tab === 'Categoria - Area' && <TabCategoriaArea />}
      {tab === 'Regole Parole Chiave' && <TabRegole />}
      {tab === 'Colori' && <TabColori />}
      {tab === 'Attributi BC' && <TabAttributi />}
      {tab === 'Caratteristiche Manuali' && <TabManuali />}
    </div>
  );
}
