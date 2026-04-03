'use client';

import React, { useEffect, useState, useMemo } from 'react';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type SLARule      = { priority: string; response_hours: number; resolution_hours: number };
type Department   = { id: number; name: string; is_active: boolean };
type PriorityRule = { category: string; blocca_lavoro: boolean; priority: string };
type CategoryRow  = { id: number; category: string; subcategory: string | null; is_active: boolean };

const PRIORITY_OPTIONS = ['bassa', 'media', 'alta', 'critica'];
const PRIORITY_COLORS: Record<string, string> = {
  bassa:   'bg-green-100 text-green-700',
  media:   'bg-yellow-100 text-yellow-700',
  alta:    'bg-orange-100 text-orange-700',
  critica: 'bg-red-100 text-red-700',
};

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
  if (res.status === 401 || res.status === 403) { window.location.href = '/login'; throw new Error('auth'); }
  return res;
}

type Tab = 'priorita' | 'sla' | 'categorie' | 'reparti';

export default function TicketImpostazioniPage() {
  const [tab, setTab] = useState<Tab>('priorita');

  // ─── SLA ───────────────────────────────────────────────────────────────────
  const [slaRules, setSlaRules] = useState<SLARule[]>([]);
  const [slaEdits, setSlaEdits] = useState<Record<string, { response: string; resolution: string }>>({});
  const [slaSaving, setSlaSaving] = useState(false);
  const [slaError,  setSlaError]  = useState('');

  // ─── Priority rules ────────────────────────────────────────────────────────
  const [prioRules,  setPrioRules]  = useState<PriorityRule[]>([]);
  const [prioSaving, setPrioSaving] = useState<string | null>(null);
  const [prioError,  setPrioError]  = useState('');

  // ─── Departments ───────────────────────────────────────────────────────────
  const [departments,    setDepartments]    = useState<Department[]>([]);
  const [newDeptName,    setNewDeptName]    = useState('');
  const [deptError,      setDeptError]      = useState('');
  const [deptSaving,     setDeptSaving]     = useState(false);
  const [editingDeptId,  setEditingDeptId]  = useState<number | null>(null);
  const [editingDeptVal, setEditingDeptVal] = useState('');

  // ─── Categories ────────────────────────────────────────────────────────────
  const [categories,       setCategories]       = useState<CategoryRow[]>([]);
  const [catError,         setCatError]         = useState('');
  const [catSaving,        setCatSaving]        = useState(false);
  const [newCatCategory,   setNewCatCategory]   = useState('');
  const [newCatSub,        setNewCatSub]        = useState('');
  const [addingSubFor,     setAddingSubFor]     = useState<string | null>(null);
  const [addingSubVal,     setAddingSubVal]     = useState('');
  const [editingSubId,     setEditingSubId]     = useState<number | null>(null);
  const [editingSubVal,    setEditingSubVal]    = useState('');
  const [editingCatGroup,  setEditingCatGroup]  = useState<string | null>(null);
  const [editingCatGrpVal, setEditingCatGrpVal] = useState('');

  const categoryGroups = useMemo(() => {
    const map = new Map<string, CategoryRow[]>();
    for (const row of categories) {
      const arr = map.get(row.category) ?? [];
      arr.push(row);
      map.set(row.category, arr);
    }
    return map;
  }, [categories]);

  // ─── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/tickets/admin/departments').then(r => r.json()).then(setDepartments).catch(() => {});
    apiFetch('/api/tickets/admin/sla').then(r => r.json()).then(setSlaRules).catch(() => {});
    apiFetch('/api/tickets/admin/priority-rules').then(r => r.json()).then(setPrioRules).catch(() => {});
    apiFetch('/api/tickets/admin/categories').then(r => r.json()).then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const init: Record<string, { response: string; resolution: string }> = {};
    slaRules.forEach(r => { init[r.priority] = { response: String(r.response_hours), resolution: String(r.resolution_hours) }; });
    setSlaEdits(init);
  }, [slaRules]);

  // ─── SLA handlers ─────────────────────────────────────────────────────────
  async function saveSLA(priority: string) {
    const edit = slaEdits[priority];
    if (!edit) return;
    setSlaSaving(true); setSlaError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/sla/${priority}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ response_hours: parseFloat(edit.response), resolution_hours: parseFloat(edit.resolution) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSlaError(d.message ?? 'Errore'); }
      else {
        const updated = await res.json();
        setSlaRules(prev => prev.map(r => r.priority === priority ? { ...r, response_hours: updated.response_hours, resolution_hours: updated.resolution_hours } : r));
      }
    } catch { setSlaError('Errore di connessione'); }
    finally { setSlaSaving(false); }
  }

  // ─── Priority handlers ─────────────────────────────────────────────────────
  async function savePriorityRule(category: string, blocca_lavoro: boolean, priority: string) {
    const key = `${category}-${blocca_lavoro}`;
    setPrioSaving(key); setPrioError('');
    try {
      const res = await apiFetch('/api/tickets/admin/priority-rules', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category, blocca_lavoro, priority }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setPrioError(d.message ?? 'Errore'); return; }
      setPrioRules(prev => prev.map(r =>
        r.category === category && r.blocca_lavoro === blocca_lavoro ? { ...r, priority } : r
      ));
    } catch { setPrioError('Errore di connessione'); }
    finally { setPrioSaving(null); }
  }

  // ─── Department handlers ──────────────────────────────────────────────────
  async function createDept(e: React.FormEvent) {
    e.preventDefault();
    setDeptError(''); setDeptSaving(true);
    try {
      const res = await apiFetch('/api/tickets/admin/departments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newDeptName }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setDeptError(d.message ?? 'Errore'); return; }
      const created = await res.json();
      setDepartments(prev => [...prev, created]);
      setNewDeptName('');
    } catch { setDeptError('Errore di connessione'); }
    finally { setDeptSaving(false); }
  }

  async function toggleDept(dept: Department) {
    setDeptError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/departments/${dept.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: !dept.is_active }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setDeptError(d.message ?? 'Errore'); return; }
      const updated = await res.json();
      setDepartments(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch { setDeptError('Errore di connessione'); }
  }

  async function saveDeptName(id: number) {
    const val = editingDeptVal.trim();
    setEditingDeptId(null);
    if (!val) return;
    setDeptError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/departments/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: val }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setDeptError(d.message ?? 'Errore'); return; }
      const updated = await res.json();
      setDepartments(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch { setDeptError('Errore di connessione'); }
  }

  // ─── Category handlers ────────────────────────────────────────────────────
  async function addCategoryRow(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatCategory.trim()) return;
    setCatSaving(true); setCatError('');
    try {
      const res = await apiFetch('/api/tickets/admin/categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category: newCatCategory.trim(), subcategory: newCatSub.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setCatError(d.message ?? 'Errore'); return; }
      const row = await res.json();
      setCategories(prev => {
        const exists = prev.find(r => r.id === row.id);
        return exists ? prev.map(r => r.id === row.id ? row : r) : [...prev, row];
      });
      setNewCatCategory(''); setNewCatSub('');
    } catch { setCatError('Errore di connessione'); }
    finally { setCatSaving(false); }
  }

  async function addSubcategoryToGroup(category: string) {
    const val = addingSubVal.trim();
    if (!val) return;
    setCatError('');
    try {
      const res = await apiFetch('/api/tickets/admin/categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category, subcategory: val }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setCatError(d.message ?? 'Errore'); return; }
      const row = await res.json();
      setCategories(prev => {
        const exists = prev.find(r => r.id === row.id);
        return exists ? prev.map(r => r.id === row.id ? row : r) : [...prev, row];
      });
      setAddingSubFor(null); setAddingSubVal('');
    } catch { setCatError('Errore di connessione'); }
  }

  async function toggleCategoryRow(row: CategoryRow) {
    setCatError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/categories/${row.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: !row.is_active }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setCatError(d.message ?? 'Errore'); return; }
      const updated = await res.json();
      setCategories(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch { setCatError('Errore di connessione'); }
  }

  async function deleteCategoryRow(row: CategoryRow) {
    if (!confirm(`Eliminare "${row.category}${row.subcategory ? ` / ${row.subcategory}` : ''}"?`)) return;
    setCatError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/categories/${row.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setCatError(d.message ?? 'Errore'); return; }
      setCategories(prev => prev.filter(r => r.id !== row.id));
    } catch { setCatError('Errore di connessione'); }
  }

  async function saveSubEdit(id: number) {
    const val = editingSubVal.trim();
    setEditingSubId(null);
    if (!val) return;
    setCatError('');
    try {
      const res = await apiFetch(`/api/tickets/admin/categories/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subcategory: val }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setCatError(d.message ?? 'Errore'); return; }
      const updated = await res.json();
      setCategories(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch { setCatError('Errore di connessione'); }
  }

  async function saveCatGroupRename(oldName: string) {
    const newName = editingCatGrpVal.trim();
    setEditingCatGroup(null);
    if (!newName || newName === oldName) return;
    setCatError('');
    const rowsInGroup = categories.filter(r => r.category === oldName);
    try {
      await Promise.all(rowsInGroup.map(row =>
        apiFetch(`/api/tickets/admin/categories/${row.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ category: newName }),
        })
      ));
      setCategories(prev => prev.map(r => r.category === oldName ? { ...r, category: newName } : r));
    } catch { setCatError('Errore di connessione'); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Impostazioni Ticket IT</h1>
        <p className="text-sm text-gray-500 mt-0.5">Priorità automatiche, SLA, categorie e reparti</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button className={tabClass('priorita')}  onClick={() => setTab('priorita')}>Priorità automatica</button>
        <button className={tabClass('sla')}       onClick={() => setTab('sla')}>Regole SLA</button>
        <button className={tabClass('categorie')} onClick={() => setTab('categorie')}>Categorie</button>
        <button className={tabClass('reparti')}   onClick={() => setTab('reparti')}>Reparti</button>
      </div>

      {/* ── PRIORITY RULES ── */}
      {tab === 'priorita' && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-1">Priorità automatica</h2>
          <p className="text-xs text-gray-500 mb-4">
            Priorità assegnata automaticamente al momento della creazione del ticket, in base alla categoria e al flag "blocca lavoro".
          </p>
          {prioError && <p className="text-sm text-red-600 mb-3">{prioError}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="pb-2 text-left font-medium">Categoria</th>
                <th className="pb-2 text-center font-medium w-32">Blocca lavoro</th>
                <th className="pb-2 text-left font-medium w-40">Priorità</th>
                <th className="pb-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {prioRules.map(r => {
                const key = `${r.category}-${r.blocca_lavoro}`;
                return (
                  <tr key={key} className="border-b border-gray-50">
                    <td className="py-2 pr-3 text-gray-700">{r.category}</td>
                    <td className="py-2 text-center">
                      {r.blocca_lavoro
                        ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Sì</span>
                        : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">No</span>
                      }
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={r.priority}
                        onChange={e => setPrioRules(prev => prev.map(x =>
                          x.category === r.category && x.blocca_lavoro === r.blocca_lavoro
                            ? { ...x, priority: e.target.value }
                            : x
                        ))}
                        className={`border rounded-lg px-2 py-1 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${PRIORITY_COLORS[r.priority] ?? ''}`}
                      >
                        {PRIORITY_OPTIONS.map(p => (
                          <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => savePriorityRule(r.category, r.blocca_lavoro, r.priority)}
                        disabled={prioSaving === key}
                        className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {prioSaving === key ? '…' : 'Salva'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SLA ── */}
      {tab === 'sla' && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-1">Regole SLA</h2>
          <p className="text-xs text-gray-500 mb-4">Ore lavorative (Lun–Ven 8:00–17:00 fuso orario Roma)</p>
          {slaError && <p className="text-sm text-red-600 mb-3">{slaError}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="pb-2 text-left font-medium">Priorità</th>
                <th className="pb-2 text-left font-medium">Ore risposta</th>
                <th className="pb-2 text-left font-medium">Ore risoluzione</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {slaRules.map(r => (
                <tr key={r.priority} className="border-b border-gray-50">
                  <td className="py-2 pr-3 font-semibold text-gray-700 capitalize">{r.priority}</td>
                  <td className="py-2 pr-3">
                    <input
                      type="number" min="0.5" step="0.5"
                      value={slaEdits[r.priority]?.response ?? r.response_hours}
                      onChange={e => setSlaEdits(prev => ({ ...prev, [r.priority]: { ...prev[r.priority], response: e.target.value } }))}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number" min="1" step="1"
                      value={slaEdits[r.priority]?.resolution ?? r.resolution_hours}
                      onChange={e => setSlaEdits(prev => ({ ...prev, [r.priority]: { ...prev[r.priority], resolution: e.target.value } }))}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-2">
                    <button onClick={() => saveSLA(r.priority)} disabled={slaSaving} className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      Salva
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── CATEGORIES ── */}
      {tab === 'categorie' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Aggiungi categoria</h2>
            <form onSubmit={addCategoryRow} className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newCatCategory}
                  onChange={e => setNewCatCategory(e.target.value)}
                  required
                  placeholder="Nome categoria…"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newCatSub}
                  onChange={e => setNewCatSub(e.target.value)}
                  placeholder="Sottocategoria (opz.)…"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="submit" disabled={catSaving} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {catSaving ? '…' : 'Aggiungi'}
                </button>
              </div>
              {catError && <p className="text-sm text-red-600">{catError}</p>}
            </form>
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Categorie e sottocategorie</h2>
            <p className="text-xs text-gray-500 mb-4">Clicca su un nome per rinominarlo. Il badge verde/grigio attiva o disattiva la voce.</p>
            {categoryGroups.size === 0 ? (
              <p className="text-sm text-gray-400">Nessuna categoria</p>
            ) : (
              <div className="space-y-3">
                {[...categoryGroups.entries()].map(([catName, rows]) => (
                  <div key={catName} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                      {editingCatGroup === catName ? (
                        <input
                          autoFocus
                          value={editingCatGrpVal}
                          onChange={e => setEditingCatGrpVal(e.target.value)}
                          onBlur={() => saveCatGroupRename(catName)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveCatGroupRename(catName); }
                            if (e.key === 'Escape') setEditingCatGroup(null);
                          }}
                          className="text-sm font-semibold text-gray-800 border-b border-blue-400 bg-transparent outline-none min-w-0"
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-sm font-semibold text-gray-800 hover:text-blue-600 text-left"
                          title="Clicca per rinominare la categoria"
                          onClick={() => { setEditingCatGroup(catName); setEditingCatGrpVal(catName); }}
                        >
                          {catName}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setAddingSubFor(catName); setAddingSubVal(''); }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium ml-3 shrink-0"
                      >
                        + Sottocategoria
                      </button>
                    </div>

                    <ul>
                      {rows.map(row => (
                        <li key={row.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-50 last:border-b-0 text-sm gap-2">
                          {row.subcategory === null ? (
                            <span className="text-gray-400 italic text-xs flex-1">nessuna sottocategoria</span>
                          ) : editingSubId === row.id ? (
                            <input
                              autoFocus
                              value={editingSubVal}
                              onChange={e => setEditingSubVal(e.target.value)}
                              onBlur={() => saveSubEdit(row.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); saveSubEdit(row.id); }
                                if (e.key === 'Escape') setEditingSubId(null);
                              }}
                              className="flex-1 text-sm border-b border-blue-400 bg-transparent outline-none min-w-0"
                            />
                          ) : (
                            <button
                              type="button"
                              className="flex-1 text-gray-700 hover:text-blue-600 text-left text-sm min-w-0 truncate"
                              title="Clicca per rinominare"
                              onClick={() => { setEditingSubId(row.id); setEditingSubVal(row.subcategory ?? ''); }}
                            >
                              {row.subcategory}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleCategoryRow(row)}
                            className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                              row.is_active
                                ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600'
                                : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                            }`}
                          >
                            {row.is_active ? 'Attivo' : 'Inattivo'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCategoryRow(row)}
                            className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors ml-1"
                          >
                            Elimina
                          </button>
                        </li>
                      ))}

                      {addingSubFor === catName && (
                        <li className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-t border-gray-100">
                          <input
                            autoFocus
                            value={addingSubVal}
                            onChange={e => setAddingSubVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); addSubcategoryToGroup(catName); }
                              if (e.key === 'Escape') { setAddingSubFor(null); setAddingSubVal(''); }
                            }}
                            placeholder="Nome sottocategoria…"
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                          <button type="button" onClick={() => addSubcategoryToGroup(catName)} className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 hover:bg-blue-700 shrink-0">
                            Aggiungi
                          </button>
                          <button type="button" onClick={() => { setAddingSubFor(null); setAddingSubVal(''); }} className="text-xs text-gray-500 hover:text-gray-700 shrink-0">
                            Annulla
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DEPARTMENTS ── */}
      {tab === 'reparti' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">Aggiungi reparto</h2>
            <form onSubmit={createDept} className="flex gap-3">
              <input
                type="text"
                value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)}
                required minLength={2}
                placeholder="Nome reparto…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" disabled={deptSaving} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {deptSaving ? '…' : 'Aggiungi'}
              </button>
            </form>
            {deptError && <p className="text-sm text-red-600 mt-2">{deptError}</p>}
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-1">Reparti</h2>
            <p className="text-xs text-gray-500 mb-4">Clicca sul nome per rinominare. Il badge attiva o disattiva il reparto.</p>
            {departments.length === 0 ? (
              <p className="text-sm text-gray-400">Nessun reparto</p>
            ) : (
              <ul className="space-y-1">
                {departments.map(d => (
                  <li key={d.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 text-sm gap-3">
                    {editingDeptId === d.id ? (
                      <input
                        autoFocus
                        value={editingDeptVal}
                        onChange={e => setEditingDeptVal(e.target.value)}
                        onBlur={() => saveDeptName(d.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveDeptName(d.id);
                          if (e.key === 'Escape') setEditingDeptId(null);
                        }}
                        className="flex-1 text-sm border-b border-blue-400 bg-transparent outline-none text-gray-800 min-w-0"
                      />
                    ) : (
                      <button
                        type="button"
                        className="flex-1 text-left text-gray-800 hover:text-blue-600 min-w-0 truncate"
                        title="Clicca per rinominare"
                        onClick={() => { setEditingDeptId(d.id); setEditingDeptVal(d.name); }}
                      >
                        {d.name}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleDept(d)}
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                        d.is_active
                          ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600'
                          : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                      }`}
                    >
                      {d.is_active ? 'Attivo' : 'Inattivo'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
