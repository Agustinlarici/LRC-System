'use client';

import { useState } from 'react';
import type { HrDepartment } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  departments: HrDepartment[];
  onClose: () => void;
  onCreated: () => void;
}

export function NewEmployeeModal({ departments: initialDepartments, onClose, onCreated }: Props) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [form, setForm] = useState({
    matricola: '', nome: '', cognome: '', data_nascita: '', codice_fiscale: '',
    email: '', telefono: '', ruolo: '', mansione: '', livello: '', tipo_contratto: '',
    reparto_id: '', data_assunzione: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function addDepartment() {
    const name = window.prompt('Nome del nuovo reparto:');
    if (!name?.trim()) return;
    const res = await fetch(`${BACKEND}/api/hr/departments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const dept = await res.json();
      setDepartments(d => [...d, dept]);
      set('reparto_id', String(dept.id));
    } else {
      const body = await res.json().catch(() => ({}));
      window.alert(body.message ?? 'Errore durante la creazione del reparto');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome || !form.cognome || !form.data_assunzione) {
      setError('Nome, cognome e data assunzione sono obbligatori');
      return;
    }
    setSaving(true);
    setError('');
    const res = await fetch(`${BACKEND}/api/hr/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ...form,
        matricola: form.matricola || null,
        data_nascita: form.data_nascita || null,
        codice_fiscale: form.codice_fiscale || null,
        email: form.email || null,
        telefono: form.telefono || null,
        ruolo: form.ruolo || null,
        mansione: form.mansione || null,
        livello: form.livello || null,
        tipo_contratto: form.tipo_contratto || null,
        reparto_id: form.reparto_id ? Number(form.reparto_id) : null,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? 'Errore durante la creazione');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-medium text-gray-900 mb-4">Nuovo dipendente</h2>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Nome *</label><input className="input" value={form.nome} onChange={e => set('nome', e.target.value)} /></div>
            <div><label className="label">Cognome *</label><input className="input" value={form.cognome} onChange={e => set('cognome', e.target.value)} /></div>
            <div><label className="label">Matricola</label><input className="input" value={form.matricola} onChange={e => set('matricola', e.target.value)} /></div>
            <div><label className="label">Data di nascita</label><input type="date" className="input" value={form.data_nascita} onChange={e => set('data_nascita', e.target.value)} /></div>
            <div><label className="label">Codice fiscale</label><input className="input" value={form.codice_fiscale} onChange={e => set('codice_fiscale', e.target.value)} /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div><label className="label">Telefono</label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
            <div><label className="label">Reparto</label>
              <div className="flex gap-1.5">
                <select className="input" value={form.reparto_id} onChange={e => set('reparto_id', e.target.value)}>
                  <option value="">—</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="button" onClick={addDepartment} title="Nuovo reparto" className="btn-secondary text-sm px-3 shrink-0">+</button>
              </div>
            </div>
            <div><label className="label">Ruolo</label><input className="input" value={form.ruolo} onChange={e => set('ruolo', e.target.value)} /></div>
            <div><label className="label">Mansione</label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
            <div><label className="label">Livello</label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
            <div><label className="label">Tipo contratto</label><input className="input" value={form.tipo_contratto} onChange={e => set('tipo_contratto', e.target.value)} /></div>
            <div><label className="label">Data assunzione *</label><input type="date" className="input" value={form.data_assunzione} onChange={e => set('data_assunzione', e.target.value)} /></div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Annulla</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Crea dipendente'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
