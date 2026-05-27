'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type {
  SpmaLine, SpmaCategory, SpmaModelReq, SpmaStation,
  SpmaCalendarDefault, SpmaFaseSequence, SpmaAlertConfig,
} from '@/types';

type Tab = 'Linee' | 'Categorie' | 'Modelli' | 'Stazioni' | 'Mapping iKnow' | 'Calendario' | 'Sequenza Fasi' | 'Alert';

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

// ─── Calendario defaults ──────────────────────────────────────────────────────

const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

function TabCalendario() {
  const [rows,    setRows]    = useState<SpmaCalendarDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    api.get<SpmaCalendarDefault[]>('/api/spma/calendar-defaults')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  function update(dow: number, field: keyof SpmaCalendarDefault, value: unknown) {
    setRows(prev => prev.map(r => r.day_of_week === dow ? { ...r, [field]: value } : r));
  }

  async function save() {
    setBusy(true); setSaved(false);
    try {
      const updated = await api.put<SpmaCalendarDefault[]>('/api/spma/calendar-defaults', rows);
      setRows(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Orari di lavoro predefiniti per giorno della settimana. Applicati automaticamente ai giorni presenti nei nuovi Excel importati (solo se il giorno non esiste già nel calendario).
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Giorno</th>
              <th className="py-2.5 px-4 text-center font-medium">Lavorativo</th>
              <th className="py-2.5 px-4 text-left font-medium">Inizio turno</th>
              <th className="py-2.5 px-4 text-left font-medium">Fine turno</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.day_of_week} className="border-b border-gray-100">
                <td className="py-2 px-4 font-medium text-gray-700">{DAY_NAMES[r.day_of_week]}</td>
                <td className="py-2 px-4 text-center">
                  <input type="checkbox" checked={r.is_working}
                    onChange={e => update(r.day_of_week, 'is_working', e.target.checked)}
                    className="w-4 h-4 accent-blue-600" />
                </td>
                <td className="py-2 px-4">
                  <input type="time" value={r.shift_start ?? ''} disabled={!r.is_working}
                    onChange={e => update(r.day_of_week, 'shift_start', e.target.value || null)}
                    className="border border-gray-200 rounded px-2 py-1 text-sm disabled:opacity-40" />
                </td>
                <td className="py-2 px-4">
                  <input type="time" value={r.shift_end ?? ''} disabled={!r.is_working}
                    onChange={e => update(r.day_of_week, 'shift_end', e.target.value || null)}
                    className="border border-gray-200 rounded px-2 py-1 text-sm disabled:opacity-40" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {busy ? 'Salvataggio...' : 'Salva defaults'}
        </button>
        {saved && <span className="text-sm text-green-600">Salvato</span>}
      </div>
      <p className="text-xs text-gray-400">
        Per visualizzare e modificare il calendario giornaliero →{' '}
        <Link href="/spma/calendario" className="text-blue-600 hover:underline">Calendario SPMA</Link>
      </p>
    </div>
  );
}

// ─── Sequenza fasi ────────────────────────────────────────────────────────────

function TabSequenzaFasi() {
  const [cats,    setCats]    = useState<SpmaCategory[]>([]);
  const [catId,   setCatId]   = useState('');
  const [phases,  setPhases]  = useState<SpmaFaseSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [faseName,    setFaseName]    = useState('');
  const [orderIndex,  setOrderIndex]  = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [faseAll,     setFaseAll]     = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<SpmaCategory[]>('/api/spma/categories'),
      api.get<string[]>('/api/dashboards/lead-time/fasi').catch(() => []),
    ]).then(([c, f]) => { setCats(c); setFaseAll(f); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!catId) { setPhases([]); return; }
    api.get<SpmaFaseSequence[]>(`/api/spma/fase-sequence?category_id=${catId}`)
      .then(setPhases);
  }, [catId]);

  async function add() {
    if (!catId || !faseName.trim() || !orderIndex || !durationMin) return;
    setBusy(true);
    try {
      const row = await api.post<SpmaFaseSequence>('/api/spma/fase-sequence', {
        componentCategoryId: parseInt(catId),
        orderIndex:          parseInt(orderIndex),
        faseName:            faseName.trim(),
        durationMinutes:     parseInt(durationMin),
      });
      setPhases(prev => {
        const without = prev.filter(p => p.id !== row.id && p.fase_name !== row.fase_name);
        return [...without, row].sort((a, b) => a.order_index - b.order_index);
      });
      setFaseName(''); setOrderIndex(''); setDurationMin('');
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    await api.delete(`/api/spma/fase-sequence/${id}`);
    setPhases(prev => prev.filter(p => p.id !== id));
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Configura le fasi iKnow in ordine per ogni categoria di componente, con la durata stimata in minuti di lavoro.
        Il sistema usa queste fasi per calcolare dove dovrebbe essere ogni componente rispetto al montaggio.
      </p>
      <select value={catId} onChange={e => setCatId(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="">Seleziona categoria</option>
        {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {catId && (
        <>
          {phases.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                    <th className="py-2.5 px-4 text-left font-medium">Ordine</th>
                    <th className="py-2.5 px-4 text-left font-medium">Fase iKnow</th>
                    <th className="py-2.5 px-4 text-left font-medium">Durata (min)</th>
                    <th className="py-2.5 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {phases.map(p => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-4 text-gray-500">{p.order_index}</td>
                      <td className="py-2 px-4 font-medium">{p.fase_name}</td>
                      <td className="py-2 px-4 text-gray-600">{p.duration_minutes} min</td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => del(p.id)}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors">
                          Elimina
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Ordine</label>
              <input value={orderIndex} onChange={e => setOrderIndex(e.target.value)}
                type="number" min="1" placeholder="1"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-52">
              <label className="text-xs text-gray-500">Fase iKnow</label>
              <input value={faseName} onChange={e => setFaseName(e.target.value)}
                list="fasi-list" placeholder="es. DELIBERA VERNICIATURA"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <datalist id="fasi-list">{faseAll.map(f => <option key={f} value={f} />)}</datalist>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Durata (min)</label>
              <input value={durationMin} onChange={e => setDurationMin(e.target.value)}
                type="number" min="1" placeholder="240"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={add} disabled={busy || !faseName.trim() || !orderIndex || !durationMin}
              className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Aggiungi
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Alert config ─────────────────────────────────────────────────────────────

function TabAlert() {
  const [config,  setConfig]  = useState<SpmaAlertConfig>({ warning_pct: 15, critical_pct: 30, smtp_host: null, smtp_port: 587, smtp_secure: false, smtp_user: null, smtp_from: null, smtp_to: null });
  const [pass,    setPass]    = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [testing,      setTesting]      = useState(false);
  const [testResult,   setTestResult]   = useState<string | null>(null);
  const [reporting,    setReporting]    = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);

  useEffect(() => {
    api.get<SpmaAlertConfig>('/api/spma/alert-config')
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  function field(key: keyof SpmaAlertConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setConfig(prev => ({ ...prev, [key]: e.target.value || null }));
  }

  async function save() {
    setBusy(true); setSaved(false);
    try {
      const updated = await api.put<SpmaAlertConfig>('/api/spma/alert-config', {
        warningPct:  config.warning_pct,
        criticalPct: config.critical_pct,
        smtpHost:    config.smtp_host   || null,
        smtpPort:    config.smtp_port   ?? 587,
        smtpSecure:  config.smtp_secure ?? false,
        smtpUser:    config.smtp_user   || null,
        smtpPass:    pass               || null,
        smtpFrom:    config.smtp_from   || null,
        smtpTo:      config.smtp_to     || null,
      });
      setConfig(updated); setPass('');
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.post<{ to: string }>('/api/spma/email-test', {});
      setTestResult(`Email inviata a ${r.to}`);
    } catch (e) { setTestResult((e as Error).message); }
    finally { setTesting(false); }
  }

  async function sendReportNow() {
    setReporting(true); setReportResult(null);
    try {
      const r = await api.post<{ delayed: number }>('/api/spma/email-report-now', {});
      setReportResult(r.delayed > 0 ? `Report inviato (${r.delayed} ritardi)` : 'Nessun ritardo attivo');
    } catch (e) { setReportResult((e as Error).message); }
    finally { setReporting(false); }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  const inp = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-6 max-w-lg">

      {/* Soglie */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Soglie di ritardo</h3>
        <div className="space-y-1">
          <label className="text-sm font-medium text-yellow-700">Soglia avviso</label>
          <div className="flex items-center gap-3">
            <input type="number" min="1" max="99" value={config.warning_pct}
              onChange={e => setConfig(prev => ({ ...prev, warning_pct: parseInt(e.target.value) || prev.warning_pct }))}
              className={`${inp} w-24`} />
            <span className="text-sm text-gray-500">% del tempo rimanente</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-red-700">Soglia critica</label>
          <div className="flex items-center gap-3">
            <input type="number" min="1" max="100" value={config.critical_pct}
              onChange={e => setConfig(prev => ({ ...prev, critical_pct: parseInt(e.target.value) || prev.critical_pct }))}
              className={`${inp} w-24`} />
            <span className="text-sm text-gray-500">% del tempo rimanente</span>
          </div>
        </div>
      </div>

      {/* SMTP */}
      <div className="space-y-3 border-t border-gray-100 pt-5">
        <h3 className="text-sm font-semibold text-gray-700">Configurazione email (SMTP)</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-gray-500">Server SMTP</label>
            <input value={config.smtp_host ?? ''} onChange={field('smtp_host')}
              placeholder="smtp.office365.com" className={`${inp} w-full`} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Porta</label>
            <input type="number" value={config.smtp_port ?? 587}
              onChange={e => setConfig(prev => ({ ...prev, smtp_port: parseInt(e.target.value) || 587 }))}
              className={`${inp} w-full`} />
          </div>
          <div className="space-y-1 flex flex-col justify-end">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer pb-2">
              <input type="checkbox" checked={config.smtp_secure ?? false}
                onChange={e => setConfig(prev => ({ ...prev, smtp_secure: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              SSL/TLS
            </label>
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-gray-500">Utente (email mittente)</label>
            <input value={config.smtp_user ?? ''} onChange={field('smtp_user')}
              placeholder="alerts@azienda.it" className={`${inp} w-full`} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-gray-500">Password</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)}
              placeholder="Lascia vuoto per non modificare"
              className={`${inp} w-full`} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-gray-500">Da (opzionale, default = utente)</label>
            <input value={config.smtp_from ?? ''} onChange={field('smtp_from')}
              placeholder="SPMA Alerts <alerts@azienda.it>" className={`${inp} w-full`} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-gray-500">A (destinatari, separati da virgola)</label>
            <input value={config.smtp_to ?? ''} onChange={field('smtp_to')}
              placeholder="responsabile@azienda.it, capo@azienda.it" className={`${inp} w-full`} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button onClick={save} disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {busy ? 'Salvataggio...' : 'Salva'}
        </button>
        <button onClick={sendTest} disabled={testing}
          className="border border-gray-200 px-4 py-2 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {testing ? 'Invio...' : 'Test email'}
        </button>
        <button onClick={sendReportNow} disabled={reporting}
          className="border border-gray-200 px-4 py-2 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {reporting ? 'Calcolo...' : 'Invia report ora'}
        </button>
        {saved && <span className="text-sm text-green-600">Salvato</span>}
        {testResult && <span className={`text-sm ${testResult.startsWith('Email') ? 'text-green-600' : 'text-red-600'}`}>{testResult}</span>}
        {reportResult && <span className={`text-sm ${reportResult.startsWith('Nessun') ? 'text-gray-500' : reportResult.includes('inviato') ? 'text-green-600' : 'text-red-600'}`}>{reportResult}</span>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: Tab[] = ['Linee', 'Categorie', 'Modelli', 'Stazioni', 'Mapping iKnow', 'Calendario', 'Sequenza Fasi', 'Alert'];

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
        {tab === 'Linee'          && <TabLinee />}
        {tab === 'Categorie'      && <TabCategorie />}
        {tab === 'Modelli'        && <TabModelli />}
        {tab === 'Stazioni'       && <TabStazioni />}
        {tab === 'Mapping iKnow'  && <TabMapping />}
        {tab === 'Calendario'     && <TabCalendario />}
        {tab === 'Sequenza Fasi'  && <TabSequenzaFasi />}
        {tab === 'Alert'          && <TabAlert />}
      </div>
    </div>
  );
}
