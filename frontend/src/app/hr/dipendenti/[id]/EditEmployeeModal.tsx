'use client';

import { useState } from 'react';
import type { HrEmployee, HrDepartment } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  employee: HrEmployee;
  departments: HrDepartment[];
  allEmployees: HrEmployee[];
  fullManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// Un capo senza gestione HR completa può aggiornare solo dati di contatto —
// tutto il resto (reparto, ruolo, livello, capo, stato) resta esclusivo di HR.
export function EditEmployeeModal({ employee, departments, allEmployees, fullManage, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    reparto_id: employee.reparto_id ? String(employee.reparto_id) : '',
    capo_id: employee.capo_id ? String(employee.capo_id) : '',
    ruolo: employee.ruolo ?? '',
    mansione: employee.mansione ?? '',
    livello: employee.livello ?? '',
    tipo_contratto: employee.tipo_contratto ?? '',
    stato: employee.stato,
    data_cessazione: employee.data_cessazione ?? '',
    telefono: employee.telefono ?? '',
    email: employee.email ?? '',
    indirizzo: employee.indirizzo ?? '',
    note: employee.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const body = fullManage
      ? {
          ...form,
          reparto_id: form.reparto_id ? Number(form.reparto_id) : null,
          capo_id: form.capo_id ? Number(form.capo_id) : null,
          // Se si riattiva un dipendente cessato, non deve restare appesa una vecchia data di cessazione
          data_cessazione: form.stato === 'cessato' ? (form.data_cessazione || null) : null,
        }
      : { telefono: form.telefono, email: form.email, indirizzo: form.indirizzo, note: form.note };

    const res = await fetch(`${BACKEND}/api/hr/employees/${employee.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const b = await res.json().catch(() => ({}));
      setError(b.message ?? 'Errore durante il salvataggio');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-medium text-gray-900 mb-1">Modifica dipendente</h2>
        {!fullManage && <p className="text-xs text-amber-600 mb-4">Puoi modificare solo i dati di contatto del tuo team diretto.</p>}
        <form onSubmit={submit} className="space-y-4">
          {fullManage && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Reparto</label>
                <select className="input" value={form.reparto_id} onChange={e => set('reparto_id', e.target.value)}>
                  <option value="">—</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div><label className="label">Capo / Responsabile</label>
                <select className="input" value={form.capo_id} onChange={e => set('capo_id', e.target.value)}>
                  <option value="">—</option>
                  {allEmployees.map(e => <option key={e.id} value={e.id}>{e.cognome} {e.nome}</option>)}
                </select>
              </div>
              <div><label className="label">Ruolo</label><input className="input" value={form.ruolo} onChange={e => set('ruolo', e.target.value)} /></div>
              <div><label className="label">Mansione</label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
              <div><label className="label">Livello</label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
              <div><label className="label">Tipo contratto</label><input className="input" value={form.tipo_contratto} onChange={e => set('tipo_contratto', e.target.value)} /></div>
              <div><label className="label">Stato</label>
                <select className="input" value={form.stato} onChange={e => set('stato', e.target.value)}>
                  <option value="attivo">Attivo</option>
                  <option value="aspettativa">Aspettativa</option>
                  <option value="malattia">Malattia</option>
                  <option value="maternita_paternita">Maternità/Paternità</option>
                  <option value="cessato">Cessato</option>
                </select>
              </div>
              {form.stato === 'cessato' && (
                <div><label className="label">Data cessazione</label>
                  <input type="date" className="input" value={form.data_cessazione} onChange={e => set('data_cessazione', e.target.value)} />
                  <p className="text-[11px] text-gray-400 mt-1">Se lasciata vuota, verrà usata la data di oggi.</p>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Telefono</label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div className="col-span-2"><label className="label">Indirizzo</label><input className="input" value={form.indirizzo} onChange={e => set('indirizzo', e.target.value)} /></div>
            <div className="col-span-2"><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={e => set('note', e.target.value)} /></div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Annulla</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Salva'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
