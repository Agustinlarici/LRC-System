'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { SpmaLine, SpmaCategory, SpmaModelReq, SpmaStation } from '@/types';

type Tab = 'Linee' | 'Categorie' | 'Modelli' | 'Stazioni' | 'Mapping iKnow';

// ─── Linee ────────────────────────────────────────────────────────────────────

function TabLinee() {
  const [lines,   setLines]   = useState<SpmaLine[]>([]);
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    api.get<SpmaLine[]>('/api/spma/lines')
      .then(setLines)
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const row = await api.post<SpmaLine>('/api/spma/lines', { name: name.trim() });
      setLines(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questa linea? Verranno rimossi anche commesse e stazioni associate.')) return;
    await api.delete(`/api/spma/lines/${id}`);
    setLines(prev => prev.filter(l => l.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Nome linea (es. Linea 1)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={busy || !name.trim()}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>
      <TableList
        headers={['ID', 'Nome']}
        rows={lines.map(l => ({ id: l.id, cells: [l.id, l.name] }))}
        onDelete={del}
      />
    </div>
  );
}

// ─── Categorie ────────────────────────────────────────────────────────────────

function TabCategorie() {
  const [cats,    setCats]    = useState<SpmaCategory[]>([]);
  const [name,    setName]    = useState('');
  const [order,   setOrder]   = useState('0');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    api.get<SpmaCategory[]>('/api/spma/categories')
      .then(setCats)
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const row = await api.post<SpmaCategory>('/api/spma/categories', {
        name: name.trim(), sortOrder: parseInt(order) || 0,
      });
      setCats(prev => [...prev, row].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      setName(''); setOrder('0');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!confirm('Eliminare questa categoria? Rimuoverà tutti i requisiti e le stazioni associate.')) return;
    await api.delete(`/api/spma/categories/${id}`);
    setCats(prev => prev.filter(c => c.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Nome categoria (es. Paraurti Anteriore)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <input value={order} onChange={e => setOrder(e.target.value)}
          placeholder="Ordine"
          type="number" min="0"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={add} disabled={busy || !name.trim()}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>
      <TableList
        headers={['ID', 'Nome', 'Ordine']}
        rows={cats.map(c => ({ id: c.id, cells: [c.id, c.name, c.sort_order] }))}
        onDelete={del}
      />
    </div>
  );
}

// ─── Requisiti Modello ────────────────────────────────────────────────────────

function TabModelli() {
  const [reqs,    setReqs]    = useState<SpmaModelReq[]>([]);
  const [cats,    setCats]    = useState<SpmaCategory[]>([]);
  const [models,  setModels]  = useState<string[]>([]);
  const [model,   setModel]   = useState('');
  const [catId,   setCatId]   = useState('');
  const [prod,    setProd]    = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<SpmaModelReq[]>('/api/spma/model-requirements'),
      api.get<SpmaCategory[]>('/api/spma/categories'),
      api.get<string[]>('/api/spma/models'),
    ]).then(([r, c, m]) => { setReqs(r); setCats(c); setModels(m); })
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!model.trim() || !catId) return;
    setBusy(true);
    try {
      const row = await api.post<SpmaModelReq>('/api/spma/model-requirements', {
        modelCode: model.trim(),
        componentCategoryId: parseInt(catId),
        producerName: prod.trim() || undefined,
      });
      setReqs(prev => [...prev, row]);
      setCatId(''); setProd('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/spma/model-requirements/${id}`);
    setReqs(prev => prev.filter(r => r.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Definisce quali categorie di componenti sono necessarie per ogni codice modello.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input value={model} onChange={e => setModel(e.target.value)}
          placeholder="Codice modello (es. X500)"
          list="models-list"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <datalist id="models-list">{models.map(m => <option key={m} value={m} />)}</datalist>
        <select value={catId} onChange={e => setCatId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Seleziona categoria</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={prod} onChange={e => setProd(e.target.value)}
          placeholder="Produttore (opz.)"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={add} disabled={busy || !model.trim() || !catId}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>
      <TableList
        headers={['ID', 'Modello', 'Categoria', 'Produttore']}
        rows={reqs.map(r => ({ id: r.id, cells: [r.id, r.model_code, r.category_name, r.producer_name ?? '–'] }))}
        onDelete={del}
      />
    </div>
  );
}

// ─── Stazioni ─────────────────────────────────────────────────────────────────

function TabStazioni() {
  const [stations, setStations] = useState<SpmaStation[]>([]);
  const [lines,    setLines]    = useState<SpmaLine[]>([]);
  const [cats,     setCats]     = useState<SpmaCategory[]>([]);
  const [lineId,   setLineId]   = useState('');
  const [catId,    setCatId]    = useState('');
  const [station,  setStation]  = useState('');
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<SpmaStation[]>('/api/spma/stations'),
      api.get<SpmaLine[]>('/api/spma/lines'),
      api.get<SpmaCategory[]>('/api/spma/categories'),
    ]).then(([s, l, c]) => { setStations(s); setLines(l); setCats(c); })
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!lineId || !catId || !station) return;
    setBusy(true);
    try {
      const row = await api.post<SpmaStation>('/api/spma/stations', {
        lineId:              parseInt(lineId),
        componentCategoryId: parseInt(catId),
        stationIndex:        parseInt(station),
      });
      setStations(prev => {
        const without = prev.filter(s =>
          !(s.line_id === row.line_id && s.component_category_id === row.component_category_id)
        );
        return [...without, row];
      });
      setCatId(''); setStation('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/spma/stations/${id}`);
    setStations(prev => prev.filter(s => s.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Stazione N = il componente viene montato N posizioni avanti nella sequenza.
        Es. stazione 1 = montato sullo stesso veicolo, stazione 3 = montato sul 3° veicolo successivo.
      </p>
      <div className="flex gap-2 flex-wrap">
        <select value={lineId} onChange={e => setLineId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Linea</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={catId} onChange={e => setCatId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Categoria</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={station} onChange={e => setStation(e.target.value)}
          placeholder="N° stazione" type="number" min="1"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={add} disabled={busy || !lineId || !catId || !station}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Salva
        </button>
      </div>
      <TableList
        headers={['ID', 'Linea', 'Categoria', 'Stazione']}
        rows={stations.map(s => ({ id: s.id, cells: [s.id, s.line_name, s.category_name, s.station_index] }))}
        onDelete={del}
      />
    </div>
  );
}

// ─── Shared table ─────────────────────────────────────────────────────────────

function TableList({
  headers, rows, onDelete,
}: {
  headers: string[];
  rows: { id: number; cells: (string | number)[] }[];
  onDelete: (id: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">Nessun elemento</p>;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
            {headers.map(h => <th key={h} className="py-2.5 px-4 text-left font-medium">{h}</th>)}
            <th className="py-2.5 px-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
              {row.cells.map((c, i) => (
                <td key={i} className="py-2 px-4 text-gray-700">{c}</td>
              ))}
              <td className="py-2 px-4 text-right">
                <button
                  onClick={() => onDelete(row.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Elimina
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Mapping iKnow ↔ Categoria SPMA ─────────────────────────────────────────

interface CompMap { id: number; componente_iknow: string; component_category_id: number; category_name: string; active: boolean }

function TabMapping() {
  const [maps,    setMaps]    = useState<CompMap[]>([]);
  const [cats,    setCats]    = useState<SpmaCategory[]>([]);
  const [compAll, setCompAll] = useState<string[]>([]);
  const [iknow,   setIknow]   = useState('');
  const [catId,   setCatId]   = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<CompMap[]>('/api/spma/componente-map'),
      api.get<SpmaCategory[]>('/api/spma/categories'),
      api.get<string[]>('/api/dashboards/lead-time/componenti'),
    ]).then(([m, c, comp]) => { setMaps(m); setCats(c); setCompAll(comp); })
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!iknow.trim() || !catId) return;
    setBusy(true);
    try {
      const row = await api.post<CompMap>('/api/spma/componente-map', {
        componenteIknow:     iknow.trim(),
        componentCategoryId: parseInt(catId),
      });
      setMaps(prev => {
        const without = prev.filter(m => !(m.componente_iknow === row.componente_iknow && m.component_category_id === row.component_category_id));
        return [...without, row];
      });
      setIknow(''); setCatId('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/spma/componente-map/${id}`);
    setMaps(prev => prev.filter(m => m.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Collega il nome del componente in iKnow/WebThron alla categoria SPMA corrispondente.
        Usato dal grafico Lead Time per filtrare e abbinare le fasi.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input value={iknow} onChange={e => setIknow(e.target.value)}
          placeholder="Nome componente iKnow (es. PARAURTI ANT)"
          list="iknow-list"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <datalist id="iknow-list">{compAll.map(c => <option key={c} value={c} />)}</datalist>
        <select value={catId} onChange={e => setCatId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Categoria SPMA</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={add} disabled={busy || !iknow.trim() || !catId}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>
      <TableList
        headers={['ID', 'Componente iKnow', 'Categoria SPMA']}
        rows={maps.map(m => ({ id: m.id, cells: [m.id, m.componente_iknow, m.category_name] }))}
        onDelete={del}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: Tab[] = ['Linee', 'Categorie', 'Modelli', 'Stazioni', 'Mapping iKnow'];

export default function SpmaImpostazioniPage() {
  const [tab, setTab] = useState<Tab>('Linee');

  return (
    <div>
      <div className="mb-6">
        <Link href="/spma" className="text-sm text-gray-500 hover:text-gray-700">← SPMA</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Impostazioni SPMA</h1>
        <p className="mt-1 text-gray-500">
          Configura linee, categorie di componenti, requisiti per modello e stazioni di montaggio.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="max-w-3xl">
        {tab === 'Linee'         && <TabLinee />}
        {tab === 'Categorie'     && <TabCategorie />}
        {tab === 'Modelli'       && <TabModelli />}
        {tab === 'Stazioni'      && <TabStazioni />}
        {tab === 'Mapping iKnow' && <TabMapping />}
      </div>
    </div>
  );
}
