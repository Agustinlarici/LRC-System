'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Department = { id: number; name: string };
type User = {
  id: number; username: string; display_name: string; email: string | null;
  phone: string | null; department_id: number | null; department_name: string | null;
  role: 'guest' | 'operator' | 'it' | 'admin'; is_active: boolean;
};
type ModuleKey = 'ingresso_merci' | 'packing' | 'monitor' | 'monitor_resumen' | 'buffer' | 'mappa' | 'tickets' | 'tickets_it' | 'tickets_admin' | 'impostazioni' | 'dashboards' | 'spma' | 'recepciones' | 'edi' | 'monitor_parate' | 'monitor_motivi' | 'webddt';
type Permission = { module_key: ModuleKey; can_view: boolean; can_manage: boolean };

const ALL_MODULES: { key: ModuleKey; label: string }[] = [
  { key: 'ingresso_merci',  label: 'Ingresso Merci' },
  { key: 'packing',         label: 'Packing' },
  { key: 'spma',            label: 'Avanzamento Prod' },
  { key: 'recepciones',    label: 'Ricezione DDT' },
  { key: 'edi',             label: 'EDI' },
  { key: 'webddt',          label: 'WebDDT' },
  { key: 'monitor',         label: 'Andon' },
  { key: 'monitor_resumen', label: 'Riepilogo Andon' },
  { key: 'monitor_parate',  label: 'Storico Fermate' },
  { key: 'monitor_motivi',  label: 'Motivi Fermate' },
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

// ─── Permissions table (shared between tabs) ──────────────────────────────────

function PermissionsTable({
  edits,
  onChange,
}: {
  edits: Record<ModuleKey, { can_view: boolean; can_manage: boolean }>;
  onChange: (key: ModuleKey, field: 'can_view' | 'can_manage', value: boolean) => void;
}) {
  return (
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
                checked={edits[m.key]?.can_view ?? false}
                onChange={e => onChange(m.key, 'can_view', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
            </td>
            <td className="py-2.5 text-center">
              <input
                type="checkbox"
                checked={edits[m.key]?.can_manage ?? false}
                onChange={e => onChange(m.key, 'can_manage', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Create user tab ──────────────────────────────────────────────────────────

function emptyPermEdits(): Record<ModuleKey, { can_view: boolean; can_manage: boolean }> {
  const map = {} as Record<ModuleKey, { can_view: boolean; can_manage: boolean }>;
  ALL_MODULES.forEach(m => { map[m.key] = { can_view: false, can_manage: false }; });
  return map;
}

function CreateUserTab({ departments, onCreated }: { departments: Department[]; onCreated: () => void }) {
  const [form, setForm] = useState({
    username:      '',
    password:      '',
    display_name:  '',
    email:         '',
    phone:         '',
    department_id: '',
    role:          'operator' as 'guest' | 'operator' | 'it' | 'admin',
  });
  const [permEdits, setPermEdits] = useState<Record<ModuleKey, { can_view: boolean; can_manage: boolean }>>(emptyPermEdits);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  function handlePerm(key: ModuleKey, field: 'can_view' | 'can_manage', value: boolean) {
    setPermEdits(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!form.username || !form.password || !form.display_name) {
      setError('Username, password e nome sono obbligatori');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...form,
          email:         form.email || undefined,
          phone:         form.phone || undefined,
          department_id: form.department_id ? Number(form.department_id) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Errore nella creazione'); return; }

      const newUserId: number = data.id;
      const permissions = ALL_MODULES.map(m => ({
        module_key: m.key,
        can_view:   permEdits[m.key]?.can_view   ?? false,
        can_manage: permEdits[m.key]?.can_manage ?? false,
      }));
      await apiFetch(`/api/auth/users/${newUserId}/permissions`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ permissions }),
      });

      setSuccess(`Utente "${data.display_name}" creato.`);
      setForm({ username: '', password: '', display_name: '', email: '', phone: '', department_id: '', role: 'operator' });
      setPermEdits(emptyPermEdits());
      onCreated();
    } catch { setError('Errore di connessione'); }
    finally { setSaving(false); }
  }

  const inputClass = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-800">Dati utente</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Username *</label>
            <input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              className={inputClass} placeholder="es. mrossi" autoComplete="off" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nome visualizzato *</label>
            <input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
              className={inputClass} placeholder="es. Mario Rossi" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Password *</label>
            <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              className={inputClass} placeholder="min. 6 caratteri" autoComplete="new-password" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className={inputClass} placeholder="facoltativa" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Telefono</label>
            <input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              className={inputClass} placeholder="facoltativo" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Reparto</label>
            <select value={form.department_id} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}
              className={`${inputClass} bg-white`}>
              <option value="">— Nessuno —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Ruolo</label>
          <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as typeof form.role }))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48">
            <option value="guest">guest — sola lettura</option>
            <option value="operator">operator</option>
            <option value="it">it</option>
            <option value="admin">admin — accesso totale</option>
          </select>
          {form.role === 'admin' && (
            <p className="text-xs text-orange-600 mt-1">Gli admin hanno accesso a tutti i moduli indipendentemente dai permessi sotto.</p>
          )}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-800">Permessi moduli</h2>
        <PermissionsTable edits={permEdits} onChange={handlePerm} />
      </div>

      {error   && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <button type="submit" disabled={saving}
        className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {saving ? 'Creazione…' : 'Crea utente'}
      </button>
    </form>
  );
}

// ─── Edit user tab ──────────────────────────────────────────────────────────

function EditUserTab({ users, departments, onSaved }: { users: User[]; departments: Department[]; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [form, setForm] = useState({
    display_name:  '',
    email:         '',
    phone:         '',
    department_id: '',
    role:          'operator' as 'guest' | 'operator' | 'it' | 'admin',
    is_active:     true,
    password:      '',
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  function selectUser(id: number | '') {
    setSelectedId(id);
    setError(''); setSuccess('');
    const u = users.find(u => u.id === id);
    if (!u) return;
    setForm({
      display_name:  u.display_name,
      email:         u.email ?? '',
      phone:         u.phone ?? '',
      department_id: u.department_id?.toString() ?? '',
      role:          u.role,
      is_active:     u.is_active,
      password:      '',
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setError(''); setSuccess(''); setSaving(true);
    try {
      const res = await apiFetch(`/api/auth/users/${selectedId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          display_name:  form.display_name,
          email:         form.email || null,
          phone:         form.phone || null,
          department_id: form.department_id ? Number(form.department_id) : null,
          role:          form.role,
          is_active:     form.is_active,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.message ?? 'Errore nel salvataggio'); return; }
      setSuccess('Dati salvati.');
      setForm(p => ({ ...p, password: '' }));
      onSaved();
    } catch { setError('Errore di connessione'); }
    finally { setSaving(false); }
  }

  const inputClass = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-semibold text-gray-800 mb-1">Modifica utente</h2>
        <p className="text-xs text-gray-500">Seleziona un utente per modificarne i dati (nome, email, telefono, reparto, ruolo, password).</p>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">Utente</label>
        <select
          value={selectedId}
          onChange={e => selectUser(e.target.value ? Number(e.target.value) : '')}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        >
          <option value="">— Seleziona utente —</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
          ))}
        </select>
      </div>

      {selectedId && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Nome visualizzato *</label>
              <input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className={inputClass} placeholder="facoltativa" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Telefono</label>
              <input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                className={inputClass} placeholder="facoltativo" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Reparto</label>
              <select value={form.department_id} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}
                className={`${inputClass} bg-white`}>
                <option value="">— Nessuno —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Ruolo</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as typeof form.role }))}
                className={`${inputClass} bg-white`}>
                <option value="guest">guest — sola lettura</option>
                <option value="operator">operator</option>
                <option value="it">it</option>
                <option value="admin">admin — accesso totale</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Nuova password</label>
              <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                className={inputClass} placeholder="lascia vuoto per non cambiarla" autoComplete="new-password" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-gray-700">Utente attivo</span>
          </label>

          {error   && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <button type="submit" disabled={saving}
            className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio…' : 'Salva modifiche'}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Departments tab (Reparti) ────────────────────────────────────────────────

type AdminDepartment = { id: number; name: string; is_active: boolean };

function DepartmentsTab({ onChanged }: { onChanged: () => void }) {
  const [departments,    setDepartments]    = useState<AdminDepartment[]>([]);
  const [newDeptName,    setNewDeptName]    = useState('');
  const [deptError,      setDeptError]      = useState('');
  const [deptSaving,     setDeptSaving]     = useState(false);
  const [editingDeptId,  setEditingDeptId]  = useState<number | null>(null);
  const [editingDeptVal, setEditingDeptVal] = useState('');

  useEffect(() => {
    apiFetch('/api/tickets/admin/departments').then(r => r.json()).then(setDepartments).catch(() => {});
  }, []);

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
      onChanged();
    } catch { setDeptError('Errore di connessione'); }
    finally { setDeptSaving(false); }
  }

  async function toggleDept(dept: AdminDepartment) {
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
      onChanged();
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
      onChanged();
    } catch { setDeptError('Errore di connessione'); }
  }

  return (
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
  );
}

// ─── Aggiornamenti sistema tab (stato servizi, sync jobs, alert) ──────────────

type HealthStatus = { status: 'ok' | 'degraded' | 'error'; ts: string; deps: { postgres: string; webthron: string } };

type RunStats = {
  lastStartedAt:    string | null;
  lastFinishedAt:   string | null;
  lastDurationSec:  number | null;
  lastRowCount:     number | null;
  lastError:        string | null;
  runCount:         number;
  consecutiveErrors: number;
  nextScheduledAt:  string | null;
  status:           'idle' | 'running' | 'ok' | 'error';
};

type SystemAlert = {
  id:               number;
  alert_key:        string;
  severity:         'critical' | 'warning' | 'info';
  title:            string;
  message:          string | null;
  resolved_at:      string | null;
  resolved_message: string | null;
  created_at:       string;
  is_active:        boolean;
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false });
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.round(diff / 60_000);
  if (min < 1)  return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  return `${h} h fa`;
}

function statusBadge(s: string) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold';
  if (s === 'ok')      return `${base} bg-green-100 text-green-700`;
  if (s === 'error')   return `${base} bg-red-100 text-red-700`;
  if (s === 'running') return `${base} bg-blue-100 text-blue-700`;
  if (s === 'degraded')return `${base} bg-yellow-100 text-yellow-700`;
  return `${base} bg-gray-100 text-gray-500`;
}

function severityBadge(s: string) {
  const base = 'inline-block px-2 py-0.5 rounded text-xs font-semibold';
  if (s === 'critical') return `${base} bg-red-100 text-red-700`;
  if (s === 'warning')  return `${base} bg-yellow-100 text-yellow-700`;
  return `${base} bg-blue-100 text-blue-700`;
}

const JOB_LABELS: Record<string, string> = {
  sync_incremental:  'Sync WebThron (10 min)',
  sync_full_day:     'Sync Full Day (01:00)',
  heatmap_snapshot:  'Snapshot OEE (01:00)',
  lookup_refresh:    'Lookup Tables (02:00)',
  bc_sync:           'Sync Business Central (03:00)',
  buffer_refresh:    'Buffer Refresh (30 min)',
  spma_onedrive_poll: 'OneDrive SPMA (10 min)',
};

function SystemCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

function HealthDep({ label, status }: { label: string; status: string }) {
  const dot = status === 'ok' ? 'bg-green-500' : status === 'unavailable' ? 'bg-yellow-400' : 'bg-red-500';
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={statusBadge(status === 'unavailable' ? 'degraded' : status)}>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {status}
      </span>
    </div>
  );
}

function AggiornamentiTab() {
  const [health,    setHealth]    = useState<HealthStatus | null>(null);
  const [syncStats, setSyncStats] = useState<Record<string, RunStats>>({});
  const [alerts,    setAlerts]    = useState<SystemAlert[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState('');
  const [acting,    setActing]    = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [hRes, sRes, aRes] = await Promise.all([
        apiFetch('/health'),
        apiFetch('/api/system/sync-status'),
        apiFetch('/api/system/alerts'),
      ]);
      setHealth(await hRes.json());
      setSyncStats(await sRes.json());
      setAlerts(await aRes.json());
    } catch { /* ignore on auto-refresh */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) intervalRef.current = setInterval(load, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4_000);
  }

  async function forceAction(endpoint: string, label: string) {
    if (acting) return;
    setActing(endpoint);
    try {
      const res = await apiFetch(`/api/system/${endpoint}`, { method: 'POST' });
      const data = await res.json() as { message?: string };
      showToast(data.message ?? `${label} avviato`);
      setTimeout(load, 3_000); // refresh after 3s
    } catch (e) {
      showToast(`Errore: ${e}`);
    } finally {
      setActing(null);
    }
  }

  async function sendTestAlert() {
    await forceAction('test-alert', 'Alert di test');
  }

  const activeAlerts = alerts.filter(a => a.is_active);
  const historyAlerts = alerts.filter(a => !a.is_active);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <span
            onClick={() => setAutoRefresh(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${autoRefresh ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-4' : ''}`} />
          </span>
          Auto-refresh 30s
        </label>
        <button onClick={load} className="btn-secondary text-sm">Aggiorna ora</button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Caricamento...</div>
      ) : (
        <>
          {/* Active alerts banner */}
          {activeAlerts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-600 font-semibold text-sm">{activeAlerts.length} alert attivi</span>
              </div>
              <div className="space-y-1">
                {activeAlerts.map(a => (
                  <div key={a.id} className="flex items-start gap-2 text-sm">
                    <span className={severityBadge(a.severity)}>{a.severity}</span>
                    <span className="font-medium text-red-700">{a.title}</span>
                    {a.message && <span className="text-red-600">— {a.message}</span>}
                    <span className="ml-auto text-red-400 text-xs shrink-0">{ago(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Health */}
            <SystemCard title="Servizi">
              {health ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Stato globale</span>
                    <span className={statusBadge(health.status)}>{health.status.toUpperCase()}</span>
                  </div>
                  <HealthDep label="PostgreSQL"   status={health.deps.postgres} />
                  <HealthDep label="WebThron"     status={health.deps.webthron} />
                  <p className="text-xs text-gray-400 mt-3">Verificato: {fmt(health.ts)}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">Non disponibile</p>
              )}
            </SystemCard>

            {/* Quick actions */}
            <SystemCard title="Azioni manuali">
              <div className="space-y-2">
                {([
                  ['force-sync',           'Sync WebThron ora'],
                  ['force-bc-sync',        'Sync Business Central ora'],
                  ['force-lookup',         'Refresh lookup tables'],
                  ['force-snapshot',       'Snapshot OEE ieri'],
                  ['force-onedrive-poll',  'Poll OneDrive SPMA ora'],
                ] as [string, string][]).map(([ep, label]) => (
                  <button
                    key={ep}
                    onClick={() => forceAction(ep, label)}
                    disabled={!!acting}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors
                      ${acting === ep
                        ? 'bg-blue-50 border-blue-200 text-blue-600'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                  >
                    {acting === ep ? '⟳ In corso...' : label}
                  </button>
                ))}
                <button
                  onClick={sendTestAlert}
                  disabled={!!acting}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-500 transition-colors"
                >
                  Invia alert di test
                </button>
              </div>
            </SystemCard>

            {/* Alert history summary */}
            <SystemCard title="Ultimi alert risolti">
              {historyAlerts.length === 0 ? (
                <p className="text-sm text-gray-400">Nessun alert in storico</p>
              ) : (
                <div className="space-y-2">
                  {historyAlerts.slice(0, 5).map(a => (
                    <div key={a.id} className="text-sm">
                      <div className="flex items-center gap-1">
                        <span className={severityBadge(a.severity)}>{a.severity}</span>
                        <span className="text-gray-700 font-medium truncate">{a.title}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {fmt(a.created_at)} → {a.resolved_at ? ago(a.resolved_at) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SystemCard>
          </div>

          {/* Sync jobs table */}
          <SystemCard title="Sync Jobs">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="pb-2 pr-4 font-medium">Job</th>
                    <th className="pb-2 pr-4 font-medium">Stato</th>
                    <th className="pb-2 pr-4 font-medium">Ultimo run</th>
                    <th className="pb-2 pr-4 font-medium">Durata</th>
                    <th className="pb-2 pr-4 font-medium">Righe</th>
                    <th className="pb-2 pr-4 font-medium">Prossimo</th>
                    <th className="pb-2 font-medium">Errore</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Object.entries(syncStats).map(([job, s]) => (
                    <tr key={job} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-4 font-medium text-gray-700">
                        {JOB_LABELS[job] ?? job}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={statusBadge(s.status)}>{s.status}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500">{ago(s.lastFinishedAt)}</td>
                      <td className="py-2.5 pr-4 text-gray-500">
                        {s.lastDurationSec != null ? `${s.lastDurationSec}s` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500">{s.lastRowCount ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-gray-500">{ago(s.nextScheduledAt)}</td>
                      <td className="py-2.5 max-w-xs">
                        {s.lastError ? (
                          <span className="text-red-500 text-xs truncate block" title={s.lastError}>
                            {s.lastError.length > 60 ? s.lastError.slice(0, 60) + '…' : s.lastError}
                            {s.consecutiveErrors > 1 && (
                              <span className="ml-1 text-red-400 font-semibold">×{s.consecutiveErrors}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(syncStats).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-400">
                        Nessun dato disponibile — il server sta caricando
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SystemCard>

          {/* Full alert history */}
          {alerts.length > 0 && (
            <SystemCard title="Storico alert (ultimi 100)">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="pb-2 pr-4 font-medium">Tipo</th>
                      <th className="pb-2 pr-4 font-medium">Titolo</th>
                      <th className="pb-2 pr-4 font-medium">Messaggio</th>
                      <th className="pb-2 pr-4 font-medium">Aperto</th>
                      <th className="pb-2 font-medium">Risolto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {alerts.map(a => (
                      <tr key={a.id} className={a.is_active ? 'bg-red-50' : ''}>
                        <td className="py-2 pr-4">
                          <span className={severityBadge(a.severity)}>{a.severity}</span>
                        </td>
                        <td className="py-2 pr-4 font-medium text-gray-700">{a.title}</td>
                        <td className="py-2 pr-4 text-gray-500 text-xs max-w-xs truncate">{a.message ?? '—'}</td>
                        <td className="py-2 pr-4 text-gray-500 text-xs whitespace-nowrap">{fmt(a.created_at)}</td>
                        <td className="py-2 text-gray-500 text-xs whitespace-nowrap">
                          {a.resolved_at ? fmt(a.resolved_at) : <span className="text-red-500 font-medium">Aperto</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SystemCard>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'utenti' | 'modifica' | 'reparti' | 'permessi' | 'avanzata' | 'iknow' | 'aggiornamenti';

export default function AdminSystemPage() {
  const [tab, setTab] = useState<Tab>('utenti');

  useEffect(() => { document.title = 'Sistema — STR'; }, []);

  // ─── Users list (shared) ───────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  function reloadUsers() {
    apiFetch('/api/auth/users').then(r => r.json()).then(setUsers).catch(() => {});
  }

  function reloadDepartments() {
    apiFetch('/api/tickets/departments').then(r => r.json()).then(setDepartments).catch(() => {});
  }

  useEffect(() => {
    reloadUsers();
    reloadDepartments();
  }, []);

  // ─── Permissions ───────────────────────────────────────────────────────────
  const [permUser,   setPermUser]   = useState<number | null>(null);
  const [permEdits,  setPermEdits]  = useState<Record<ModuleKey, { can_view: boolean; can_manage: boolean }>>(emptyPermEdits);
  const [permSaving, setPermSaving] = useState(false);
  const [permError,  setPermError]  = useState('');
  const [permSaved,  setPermSaved]  = useState(false);

  async function loadPermissions(userId: number) {
    setPermError(''); setPermSaved(false);
    try {
      const res = await apiFetch(`/api/auth/users/${userId}/permissions`);
      const data: Permission[] = await res.json();
      const map = emptyPermEdits();
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
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sistema</h1>
        <p className="text-sm text-gray-500 mt-0.5">Utenti, permessi, configurazioni e stato del sistema</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button className={tabClass('utenti')}        onClick={() => setTab('utenti')}>Crea utente</button>
        <button className={tabClass('modifica')}      onClick={() => setTab('modifica')}>Modifica utente</button>
        <button className={tabClass('reparti')}       onClick={() => setTab('reparti')}>Reparti</button>
        <button className={tabClass('permessi')}      onClick={() => setTab('permessi')}>Permessi</button>
        <button className={tabClass('avanzata')}      onClick={() => setTab('avanzata')}>Avanzata</button>
        <button className={tabClass('iknow')}         onClick={() => setTab('iknow')}>Fasi iKnow</button>
        <button className={tabClass('aggiornamenti')} onClick={() => setTab('aggiornamenti')}>Aggiornamenti sistema</button>
      </div>

      <div className={tab === 'aggiornamenti' ? '' : 'max-w-3xl'}>
        {/* ── CREATE USER ── */}
        {tab === 'utenti' && <CreateUserTab departments={departments} onCreated={reloadUsers} />}

        {/* ── EDIT USER ── */}
        {tab === 'modifica' && <EditUserTab users={users} departments={departments} onSaved={reloadUsers} />}

        {/* ── DEPARTMENTS ── */}
        {tab === 'reparti' && <DepartmentsTab onChanged={reloadDepartments} />}

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
                <PermissionsTable
                  edits={permEdits}
                  onChange={(key, field, value) =>
                    setPermEdits(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
                  }
                />

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

        {/* ── AGGIORNAMENTI SISTEMA ── */}
        {tab === 'aggiornamenti' && <AggiornamentiTab />}
      </div>
    </div>
  );
}
