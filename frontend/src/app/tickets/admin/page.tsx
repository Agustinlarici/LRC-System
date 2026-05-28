'use client';

import React, { useEffect, useState } from 'react';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type User      = { id: number; username: string; display_name: string };
type ModuleKey = 'ingresso_merci' | 'packing' | 'monitor' | 'monitor_resumen' | 'buffer' | 'mappa' | 'tickets' | 'tickets_it' | 'tickets_admin' | 'impostazioni' | 'dashboards' | 'spma' | 'recepciones' | 'edi';
type Permission = { module_key: ModuleKey; can_view: boolean; can_manage: boolean };

const ALL_MODULES: { key: ModuleKey; label: string }[] = [
  { key: 'ingresso_merci',  label: 'Ingresso Merci' },
  { key: 'packing',         label: 'Packing' },
  { key: 'spma',            label: 'Avanzamento Prod' },
  { key: 'recepciones',    label: 'Ricezione DDT' },
  { key: 'edi',             label: 'EDI' },
  { key: 'monitor',         label: 'Andon' },
  { key: 'monitor_resumen', label: 'Riepilogo Andon' },
  { key: 'buffer',          label: 'Buffer' },
  { key: 'mappa',           label: 'Mappa' },
  { key: 'dashboards',      label: 'Dashboard' },
  { key: 'tickets',         label: 'Ticket IT' },
  { key: 'tickets_it',      label: 'Ticket IT — Dashboard' },
  { key: 'tickets_admin',   label: 'Ticket IT — Admin' },
  { key: 'impostazioni',    label: 'Impostazioni' },
];

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
  if (res.status === 401 || res.status === 403) { window.location.href = '/login'; throw new Error('auth'); }
  return res;
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
        ${checked ? 'bg-blue-600' : 'bg-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
        ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

// ─── Avanzata tab ─────────────────────────────────────────────────────────────

interface IKnowFlags {
  iknow_enabled:        boolean;
  iknow_andon_enabled:  boolean;
  iknow_buffer_enabled: boolean;
}

const IKNOW_QUERIES: { key: keyof Omit<IKnowFlags, 'iknow_enabled'>; label: string; description: string }[] = [
  { key: 'iknow_andon_enabled',  label: 'Andon / Monitor', description: 'Sincronizzazione dati produzione (esecutivo) — ogni 5 minuti' },
  { key: 'iknow_buffer_enabled', label: 'Buffer',          description: 'Sincronizzazione seriali in pre-area — ogni 30 minuti' },
];

function AvanzataTab() {
  const [flags,  setFlags]  = useState<IKnowFlags | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error,  setError]  = useState('');

  useEffect(() => {
    apiFetch('/api/system/iknow-flags')
      .then(r => r.json() as Promise<IKnowFlags>)
      .then(setFlags)
      .catch(() => setError('Errore caricamento configurazione'));
  }, []);

  async function toggle(key: keyof IKnowFlags, value: boolean) {
    if (!flags) return;
    setSaving(key); setError('');
    try {
      const updated = await apiFetch('/api/system/iknow-flags', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [key]: value }),
      }).then(r => r.json() as Promise<IKnowFlags>);
      setFlags(updated);
    } catch { setError('Errore salvataggio'); }
    finally { setSaving(null); }
  }

  if (!flags) return <div className="card"><p className="text-sm text-gray-400">{error || 'Caricamento...'}</p></div>;

  const masterOff = !flags.iknow_enabled;

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-1">Connessione iKnow</h2>
        <p className="text-xs text-gray-500 mb-4">
          Interruttore generale. Se disattivato, nessuna query viene eseguita verso iKnow (WebThron).
        </p>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-800">iKnow — Generale</p>
            <p className="text-xs text-gray-500">Abilita o disabilita tutte le connessioni iKnow</p>
          </div>
          <Toggle checked={flags.iknow_enabled} onChange={v => toggle('iknow_enabled', v)} disabled={saving === 'iknow_enabled'} />
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-1">Query iKnow per modulo</h2>
        <p className="text-xs text-gray-500 mb-4">Attiva o disattiva le singole query. Efficace solo se il toggle generale è attivo.</p>
        <div className="divide-y divide-gray-100">
          {IKNOW_QUERIES.map(q => (
            <div key={q.key} className="flex items-center justify-between py-3">
              <div>
                <p className={`text-sm font-medium ${masterOff ? 'text-gray-400' : 'text-gray-800'}`}>{q.label}</p>
                <p className="text-xs text-gray-500">{q.description}</p>
              </div>
              <Toggle checked={flags[q.key]} onChange={v => toggle(q.key, v)} disabled={masterOff || saving === q.key} />
            </div>
          ))}
        </div>
        {masterOff && (
          <p className="mt-3 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-3 py-2">
            ⚠ Il toggle generale è disattivato — le query individuali sono sospese.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── iKnow Tracked Lists tab ─────────────────────────────────────────────────

interface TrackedItem { id: number; value: string; active: boolean }

type ListKey = 'fasi' | 'modelli' | 'componenti';

const LIST_META: { key: ListKey; label: string; placeholder: string; lookupKey: string }[] = [
  { key: 'fasi',       label: 'Fasi',       placeholder: 'es. VERNICIATURA',  lookupKey: 'fasi'       },
  { key: 'modelli',    label: 'Modelli',     placeholder: 'es. K3 PARAURTI',   lookupKey: 'modelli'    },
  { key: 'componenti', label: 'Componenti',  placeholder: 'es. PARAURTI ANT',  lookupKey: 'componenti' },
];

function ListSection({ meta, lookup }: {
  meta: typeof LIST_META[number];
  lookup: string[];
}) {
  const [items,  setItems]  = useState<TrackedItem[]>([]);
  const [newVal, setNewVal] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    apiFetch(`/api/system/iknow/${meta.key}`).then(r => r.json()).then(setItems).catch(() => {});
  }, [meta.key]);

  async function add() {
    if (!newVal.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await apiFetch(`/api/system/iknow/${meta.key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newVal.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.message ?? 'Errore'); return; }
      const row: TrackedItem = await res.json();
      setItems(prev => [...prev.filter(i => i.id !== row.id), row].sort((a, b) => a.value.localeCompare(b.value)));
      setNewVal('');
    } catch { setErr('Errore di connessione'); }
    finally { setBusy(false); }
  }

  async function toggleActive(id: number, active: boolean) {
    const res = await apiFetch(`/api/system/iknow/${meta.key}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (res.ok) { const row: TrackedItem = await res.json(); setItems(prev => prev.map(i => i.id === row.id ? row : i)); }
  }

  async function del(id: number) {
    await apiFetch(`/api/system/iknow/${meta.key}/${id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  const active   = items.filter(i => i.active);
  const inactive = items.filter(i => !i.active);
  const listId   = `lookup-${meta.key}`;

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-3">{meta.label}</h3>

      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      {/* Add */}
      <div className="flex gap-2 mb-3">
        <input list={listId} value={newVal} onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={meta.placeholder}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <datalist id={listId}>{lookup.map(v => <option key={v} value={v} />)}</datalist>
        <button onClick={add} disabled={busy || !newVal.trim()}
          className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          +
        </button>
      </div>

      {/* Active items */}
      {active.length === 0
        ? <p className="text-xs text-gray-400 text-center py-2">Nessuna voce</p>
        : <div className="flex flex-wrap gap-1.5">
            {active.map(i => (
              <span key={i.id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-full px-2.5 py-1 text-xs font-mono">
                {i.value}
                <button onClick={() => toggleActive(i.id, false)} className="text-blue-400 hover:text-blue-700 ml-0.5 leading-none" title="Disattiva">–</button>
                <button onClick={() => del(i.id)} className="text-red-400 hover:text-red-600 leading-none" title="Elimina">×</button>
              </span>
            ))}
          </div>
      }

      {/* Inactive */}
      {inactive.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">{inactive.length} disattivate</summary>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {inactive.map(i => (
              <span key={i.id} className="inline-flex items-center gap-1 bg-gray-100 border border-gray-200 text-gray-500 rounded-full px-2.5 py-1 text-xs font-mono opacity-70">
                {i.value}
                <button onClick={() => toggleActive(i.id, true)} className="text-green-500 hover:text-green-700 ml-0.5 leading-none" title="Riattiva">+</button>
                <button onClick={() => del(i.id)} className="text-red-400 hover:text-red-600 leading-none" title="Elimina">×</button>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function IKnowCombosTab() {
  const [lookup, setLookup] = useState<Record<string, string[]>>({ fasi: [], modelli: [], componenti: [] });

  useEffect(() => {
    Promise.all([
      apiFetch('/api/system/iknow-lookup/fasi').then(r => r.json()).catch(() => []),
      apiFetch('/api/system/iknow-lookup/modelli').then(r => r.json()).catch(() => []),
      apiFetch('/api/system/iknow-lookup/componenti').then(r => r.json()).catch(() => []),
    ]).then(([fasi, modelli, componenti]) => setLookup({ fasi, modelli, componenti }));
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
        Il sistema legge da iKnow/WebThron <strong>tutte le combinazioni</strong> del prodotto cartesiano
        tra le fasi, i modelli e i componenti elencati qui sotto. Queste combinazioni si aggiungono a quelle
        già configurate nel monitor e nel buffer.
      </div>
      {LIST_META.map(meta => (
        <ListSection key={meta.key} meta={meta} lookup={lookup[meta.lookupKey] ?? []} />
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'permessi' | 'avanzata' | 'iknow';

export default function TicketAdminPage() {
  const [tab, setTab] = useState<Tab>('permessi');

  // ─── Permissions ───────────────────────────────────────────────────────────
  const [users,      setUsers]      = useState<User[]>([]);
  const [permUser,   setPermUser]   = useState<number | null>(null);
  const [permEdits,  setPermEdits]  = useState<Record<ModuleKey, { can_view: boolean; can_manage: boolean }>>({} as any);
  const [permSaving, setPermSaving] = useState(false);
  const [permError,  setPermError]  = useState('');
  const [permSaved,  setPermSaved]  = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/users').then(r => r.json()).then(setUsers).catch(() => {});
  }, []);

  async function loadPermissions(userId: number) {
    setPermError(''); setPermSaved(false);
    try {
      const res = await apiFetch(`/api/auth/users/${userId}/permissions`);
      const data: Permission[] = await res.json();
      const map = {} as Record<ModuleKey, { can_view: boolean; can_manage: boolean }>;
      ALL_MODULES.forEach(m => { map[m.key] = { can_view: false, can_manage: false }; });
      data.forEach(p => { map[p.module_key] = { can_view: p.can_view, can_manage: p.can_manage }; });
      setPermEdits(map);
    } catch { setPermError('Errore nel caricamento dei permessi'); }
  }

  function handlePermUserChange(userId: number) {
    setPermUser(userId);
    loadPermissions(userId);
  }

  async function savePermissions() {
    if (!permUser) return;
    setPermSaving(true); setPermError(''); setPermSaved(false);
    try {
      const permissions = ALL_MODULES.map(m => ({
        module_key: m.key,
        can_view:   permEdits[m.key]?.can_view   ?? false,
        can_manage: permEdits[m.key]?.can_manage ?? false,
      }));
      const res = await apiFetch(`/api/auth/users/${permUser}/permissions`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ permissions }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setPermError(d.message ?? 'Errore'); return; }
      setPermSaved(true);
    } catch { setPermError('Errore di connessione'); }
    finally { setPermSaving(false); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;


  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Impostazioni IT</h1>
        <p className="text-sm text-gray-500 mt-0.5">Permessi utenti e configurazione avanzata</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button className={tabClass('permessi')} onClick={() => setTab('permessi')}>Permessi</button>
        <button className={tabClass('avanzata')} onClick={() => setTab('avanzata')}>Avanzata</button>
        <button className={tabClass('iknow')}    onClick={() => setTab('iknow')}>Fasi iKnow</button>
      </div>

      {/* ── PERMISSIONS ── */}
      {tab === 'permessi' && (
        <div className="card space-y-5">
          <div>
            <h2 className="font-semibold text-gray-800 mb-1">Permessi moduli</h2>
            <p className="text-xs text-gray-500">Seleziona un utente per modificare i moduli a cui può accedere.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Utente</label>
            <select
              value={permUser ?? ''}
              onChange={e => handlePermUserChange(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            >
              <option value="">— Seleziona utente —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
              ))}
            </select>
          </div>

          {permUser && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="pb-2 text-left font-medium">Modulo</th>
                    <th className="pb-2 text-center font-medium w-24">Può vedere</th>
                    <th className="pb-2 text-center font-medium w-24">Può gestire</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_MODULES.map(m => (
                    <tr key={m.key} className="border-b border-gray-50">
                      <td className="py-2.5 pr-3 text-gray-700">{m.label}</td>
                      <td className="py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={permEdits[m.key]?.can_view ?? false}
                          onChange={e => setPermEdits(prev => ({ ...prev, [m.key]: { ...prev[m.key], can_view: e.target.checked } }))}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                      </td>
                      <td className="py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={permEdits[m.key]?.can_manage ?? false}
                          onChange={e => setPermEdits(prev => ({ ...prev, [m.key]: { ...prev[m.key], can_manage: e.target.checked } }))}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {permError && <p className="text-sm text-red-600">{permError}</p>}
              {permSaved && <p className="text-sm text-green-600">Permessi salvati.</p>}

              <button
                onClick={savePermissions}
                disabled={permSaving}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {permSaving ? 'Salvataggio…' : 'Salva permessi'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── AVANZATA ── */}
      {tab === 'avanzata' && <AvanzataTab />}

      {/* ── FASI IKNOW ── */}
      {tab === 'iknow' && <IKnowCombosTab />}
    </div>
  );
}
