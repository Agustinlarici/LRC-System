'use client';

import { useEffect, useState, useCallback } from 'react';
import type { HrEmployeeSalary } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtCurrency(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

export function SalaryHistory({ employeeId, canManageSalary }: { employeeId: number; canManageSalary: boolean }) {
  const [entries, setEntries] = useState<HrEmployeeSalary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ data_decorrenza: new Date().toISOString().slice(0, 10), livello_retributivo: '', retribuzione_annua_lorda: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/salary`, { credentials: 'include' });
    if (res.ok) setEntries(await res.json());
    setLoading(false);
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/salary`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        data_decorrenza: form.data_decorrenza,
        livello_retributivo: form.livello_retributivo || null,
        retribuzione_annua_lorda: form.retribuzione_annua_lorda ? Number(form.retribuzione_annua_lorda) : null,
        note: form.note || null,
      }),
    });
    setSaving(false);
    if (res.ok) { setShowForm(false); load(); }
  }

  const latest = entries[0];

  return (
    <div className="card border-amber-200 bg-amber-50/30">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-gray-600">Dati retributivi <span className="text-[10px] text-amber-600 font-normal">(riservato)</span></p>
          {latest && <p className="text-xs text-gray-500 mt-0.5">Attuale: {latest.livello_retributivo ?? '—'} · {fmtCurrency(latest.retribuzione_annua_lorda)}/anno</p>}
        </div>
        {canManageSalary && <button onClick={() => setShowForm(s => !s)} className="btn-secondary text-sm">{showForm ? 'Chiudi' : '+ Nuovo livello'}</button>}
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 mb-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Decorrenza</label><input type="date" className="input" value={form.data_decorrenza} onChange={e => setForm(f => ({ ...f, data_decorrenza: e.target.value }))} /></div>
            <div><label className="label">Livello retributivo</label><input className="input" value={form.livello_retributivo} onChange={e => setForm(f => ({ ...f, livello_retributivo: e.target.value }))} /></div>
            <div><label className="label">Retribuzione annua lorda (€)</label><input type="number" step="0.01" className="input" value={form.retribuzione_annua_lorda} onChange={e => setForm(f => ({ ...f, retribuzione_annua_lorda: e.target.value }))} /></div>
            <div className="col-span-3"><label className="label">Note</label><input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Salva'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Caricamento…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Nessuno storico retributivo registrato</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide">
              <th className="font-medium py-1">Decorrenza</th><th className="font-medium py-1">Livello</th><th className="font-medium py-1 text-right">Retribuzione annua</th><th className="font-medium py-1">Note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-t border-gray-100">
                <td className="py-1.5">{fmtDate(e.data_decorrenza)}</td>
                <td className="py-1.5">{e.livello_retributivo ?? '—'}</td>
                <td className="py-1.5 text-right">{fmtCurrency(e.retribuzione_annua_lorda)}</td>
                <td className="py-1.5 text-gray-500">{e.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
