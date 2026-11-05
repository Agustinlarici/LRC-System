'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { HrEmployee, HrDepartment } from '@/types';

// Campi che il capo può proporre di cambiare: HR approva o rifiuta ciascuno.
const TEXT_FIELDS: { key: keyof HrEmployee & string; label: string }[] = [
  { key: 'mansione', label: 'Mansione' },
  { key: 'qualifica', label: 'Qualifica' },
  { key: 'gruppo_orario', label: 'Gruppo orario' },
  { key: 'telefono', label: 'Telefono' },
  { key: 'email', label: 'Email' },
  { key: 'indirizzo', label: 'Indirizzo' },
  { key: 'citta', label: 'Città' },
  { key: 'provincia', label: 'Provincia' },
  { key: 'cap', label: 'CAP' },
  { key: 'taglia_pantaloni', label: 'Taglia pantaloni' },
  { key: 'taglia_maglia', label: 'Taglia maglia' },
  { key: 'taglia_scarpe', label: 'Taglia scarpe' },
  { key: 'note', label: 'Note' },
];

interface Props {
  employee: HrEmployee;
  departments: HrDepartment[];
  onClose: () => void;
  onSent: () => void;
}

export function ProponiModificaModal({ employee, departments, onClose, onSent }: Props) {
  const initial: Record<string, string> = { reparto_id: employee.reparto_id ? String(employee.reparto_id) : '' };
  for (const f of TEXT_FIELDS) initial[f.key] = String((employee[f.key] as string | null) ?? '');

  const [form, setForm] = useState(initial);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const changes: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === initial[k]) continue;
      changes[k] = k === 'reparto_id' ? (v ? Number(v) : null) : v.trim() || null;
    }
    if (!Object.keys(changes).length) { setError('Non hai cambiato nulla'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/api/hr/change-requests', { employee_id: employee.id, motivo: motivo.trim() || null, changes });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-card shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <form onSubmit={submit} className="max-h-[90vh] overflow-y-auto p-6 space-y-4">
          <div>
            <h2 className="text-base font-medium text-ink-900">Proponi modifica — {employee.cognome} {employee.nome}</h2>
            <p className="text-xs text-muted mt-1">La scheda non cambia finché HR non approva, campo per campo.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Reparto</label>
              <select className="input" value={form.reparto_id} onChange={e => setForm({ ...form, reparto_id: e.target.value })}>
                <option value="">—</option>
                {departments.filter(d => d.is_active || String(d.id) === initial.reparto_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {TEXT_FIELDS.map(f => (
              <div key={f.key} className={f.key === 'note' ? 'sm:col-span-2' : ''}>
                <label className="label">{f.label}</label>
                <input className="input" value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div>
            <label className="label">Motivo della richiesta (facoltativo)</label>
            <input className="input" maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn-primary" disabled={busy}>Invia a HR</button>
          </div>
        </form>
      </div>
    </div>
  );
}
