'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type {
  ProdArea, ProdKeywordRule, ProdKeywordMode, ProdColorKeyword,
  ProdItemAttributeLabel, ProdArticleInfo,
} from '@/types';
import { ExcelImportButton } from '../_components/ExcelImportButton';

type Tab = 'Aree' | 'Regole Parole Chiave' | 'Colori' | 'Attributi BC' | 'Caratteristiche Manuali';
const TABS: Tab[] = ['Aree', 'Regole Parole Chiave', 'Colori', 'Attributi BC', 'Caratteristiche Manuali'];

// ─── Aree di montaggio ─────────────────────────────────────────────────────────

function TabAree() {
  const [aree,     setAree]     = useState<ProdArea[]>([]);
  const [code,     setCode]     = useState('');
  const [descr,    setDescr]    = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [codes,    setCodes]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);

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
    if (!confirm('Eliminare quest\'area? Vengono rimosse anche le assegnazioni articolo.')) return;
    await api.delete(`/api/prod/aree/${id}`);
    if (selected === id) setSelected(null);
    load();
  }

  async function selectArea(id: number) {
    setSelected(id);
    const rows = await api.get<{ article_code: string }[]>(`/api/prod/aree/${id}/articoli`);
    setCodes(rows.map(r => r.article_code).join('\n'));
  }

  async function saveArticoli() {
    if (selected == null) return;
    setBusy(true);
    try {
      const articleCodes = codes.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      await api.put(`/api/prod/aree/${selected}/articoli`, { articleCodes });
    } finally { setBusy(false); }
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
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
            <div key={a.id}
              onClick={() => selectArea(a.id)}
              className={`px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 ${selected === a.id ? 'bg-blue-50' : ''}`}>
              <div>
                <p className="font-medium text-gray-800">{a.description}</p>
                <p className="text-xs text-gray-400">{a.code}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); delArea(a.id); }}
                className="text-xs text-red-500 hover:text-red-700">Elimina</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        {selected == null ? (
          <p className="text-sm text-gray-400">Seleziona un&apos;area per assegnare gli articoli.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Articoli assegnati (uno per riga, o separati da virgola)
            </p>
            <textarea value={codes} onChange={e => setCodes(e.target.value)} rows={14}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="mt-2 flex items-center gap-2">
              <button onClick={saveArticoli} disabled={busy}
                className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                Salva
              </button>
              <ExcelImportButton
                endpoint={`/api/prod/aree/${selected}/articoli/import-excel`}
                onDone={() => selectArea(selected)}
                label="Carica da Excel (Codice Articolo)"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Regole parole chiave ──────────────────────────────────────────────────────

function TabRegole() {
  const [rules,   setRules]   = useState<ProdKeywordRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  const [modo,        setModo]        = useState<ProdKeywordMode>('simple');
  const [prefisso,    setPrefisso]    = useState('');
  const [categoria,   setCategoria]   = useState('');
  const [caratt,      setCaratt]      = useState('');
  const [parolaCh,    setParolaCh]    = useState('');
  const [ancora,      setAncora]      = useState('');
  const [obiettivo,   setObiettivo]   = useState('');
  const [distanza,    setDistanza]    = useState('20');
  const [note,        setNote]        = useState('');

  const load = useCallback(() => {
    api.get<ProdKeywordRule[]>('/api/prod/keyword-rules').then(setRules).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!prefisso.trim() || !categoria.trim() || !caratt.trim()) return;
    setBusy(true);
    try {
      const noteVal = note.trim() || undefined;
      const body = modo === 'simple'
        ? { modo, prefissoCommessa: prefisso.trim(), categoria: categoria.trim(), caratteristicaDerivata: caratt.trim(), parolaChiave: parolaCh.trim(), note: noteVal }
        : { modo, prefissoCommessa: prefisso.trim(), categoria: categoria.trim(), caratteristicaDerivata: caratt.trim(), parolaAncora: ancora.trim(), parolaObiettivo: obiettivo.trim(), distanzaMaxCaratteri: parseInt(distanza) || 1, note: noteVal };
      await api.post<ProdKeywordRule>('/api/prod/keyword-rules', body);
      setPrefisso(''); setCategoria(''); setCaratt(''); setParolaCh(''); setAncora(''); setObiettivo(''); setNote('');
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
          <input value={prefisso} onChange={e => setPrefisso(e.target.value)} placeholder="Prefisso commessa (es. 40)"
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
          <div className="grid grid-cols-3 gap-2">
            <input value={ancora} onChange={e => setAncora(e.target.value)} placeholder="Parola ancora"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input value={obiettivo} onChange={e => setObiettivo(e.target.value)} placeholder="Parola obiettivo (dopo l'ancora)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input value={distanza} onChange={e => setDistanza(e.target.value)} type="number" min={1} placeholder="Distanza max (caratteri)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
            label="Carica da Excel (Prefisso, Categoria, Parola Chiave, Significato, Note)"
          />
        </div>
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
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">Nessuna regola</td></tr>
            )}
            {rules.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-mono">{r.prefisso_commessa}</td>
                <td className="py-2 px-4">{r.categoria}</td>
                <td className="py-2 px-4">{r.caratteristica_derivata}</td>
                <td className="py-2 px-4 text-gray-500">
                  {r.modo === 'simple'
                    ? <span>&quot;{r.parola_chiave}&quot;</span>
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
  const [rows,    setRows]    = useState<ProdColorKeyword[]>([]);
  const [keyword, setKeyword] = useState('');
  const [color,   setColor]   = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(() => {
    api.get<ProdColorKeyword[]>('/api/prod/color-keywords').then(setRows).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!keyword.trim() || !color.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/prod/color-keywords', { keyword: keyword.trim(), color: color.trim() });
      setKeyword(''); setColor(''); load();
    } finally { setBusy(false); }
  }

  async function toggleActive(r: ProdColorKeyword) {
    await api.put(`/api/prod/color-keywords/${r.id}/active`, { active: !r.active });
    load();
  }

  async function del(id: number) {
    await api.delete(`/api/prod/color-keywords/${id}`);
    load();
  }

  if (loading) return <p className="text-gray-400">Caricamento...</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Parola chiave"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={color} onChange={e => setColor(e.target.value)} placeholder="Colore"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={busy}
          className="bg-blue-600 text-white px-4 py-2 text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Aggiungi
        </button>
      </div>

      <ExcelImportButton endpoint="/api/prod/color-keywords/import-excel" onDone={load} label="Carica da Excel (Parola Chiave, Colore)" />

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Parola chiave</th>
              <th className="py-2.5 px-4 text-left font-medium">Colore</th>
              <th className="py-2.5 px-4 text-center font-medium">Attiva</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-6">Nessuna parola chiave</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4">{r.keyword}</td>
                <td className="py-2 px-4">{r.color}</td>
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
      {tab === 'Regole Parole Chiave' && <TabRegole />}
      {tab === 'Colori' && <TabColori />}
      {tab === 'Attributi BC' && <TabAttributi />}
      {tab === 'Caratteristiche Manuali' && <TabManuali />}
    </div>
  );
}
