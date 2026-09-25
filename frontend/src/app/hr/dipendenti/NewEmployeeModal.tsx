'use client';

import { useState } from 'react';
import type { HrDepartment, HrPlant, HrContractCompany } from '@/types';
import { PlantMultiSelect } from './PlantMultiSelect';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  departments: HrDepartment[];
  plants: HrPlant[];
  companies: HrContractCompany[];
  onClose: () => void;
  onCreated: () => void;
}

export function NewEmployeeModal({ departments: initialDepartments, plants: initialPlants, companies: initialCompanies, onClose, onCreated }: Props) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [plants, setPlants] = useState(initialPlants);
  const [companies, setCompanies] = useState(initialCompanies);
  const [form, setForm] = useState({
    matricola: '', nome: '', cognome: '', sesso: '', data_nascita: '', codice_fiscale: '', nazionalita: '',
    email: '', telefono: '', mansione: '', livello: '', categoria: '', tipo_contratto: '', funzione_aziendale: '',
    reparto_id: '', contract_company_id: '', data_assunzione: '',
  });
  const [plantIds, setPlantIds] = useState<number[]>([]);
  const [l68, setL68] = useState(false);
  const { ask, dialog } = usePromptDialog();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function addCatalogEntry(endpoint: string, label: string, setList: (fn: (l: { id: number; name: string; is_active: boolean }[]) => { id: number; name: string; is_active: boolean }[]) => void, field: 'reparto_id' | 'plant_id' | 'contract_company_id') {
    const name = await ask({ title: `Nuovo ${label}`, label: `Nome ${label}`, confirmLabel: 'Crea' });
    if (typeof name !== 'string') return;
    const res = await fetch(`${BACKEND}/api/hr/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const row = await res.json();
      setList(l => [...l, row]);
      if (field === 'plant_id') setPlantIds(ids => [...ids, row.id]);
      else set(field, String(row.id));
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.message ?? `Errore durante la creazione (${label})`);
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
        sesso: form.sesso || null,
        data_nascita: form.data_nascita || null,
        codice_fiscale: form.codice_fiscale || null,
        nazionalita: form.nazionalita || null,
        email: form.email || null,
        telefono: form.telefono || null,
        mansione: form.mansione || null,
        livello: form.livello || null,
        categoria: form.categoria || null,
        tipo_contratto: form.tipo_contratto || null,
        funzione_aziendale: form.funzione_aziendale || null,
        reparto_id: form.reparto_id ? Number(form.reparto_id) : null,
        plant_ids: plantIds,
        l68,
        contract_company_id: form.contract_company_id ? Number(form.contract_company_id) : null,
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
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-medium text-gray-900 mb-4">Nuovo dipendente</h2>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><label className="label">Nome *</label><input className="input" value={form.nome} onChange={e => set('nome', e.target.value)} /></div>
            <div><label className="label">Cognome *</label><input className="input" value={form.cognome} onChange={e => set('cognome', e.target.value)} /></div>
            <div><label className="label">Matricola</label><input className="input" value={form.matricola} onChange={e => set('matricola', e.target.value)} placeholder="Vuota per contrattisti/agenzia" /></div>
            <div><label className="label">Sesso</label>
              <select className="input" value={form.sesso} onChange={e => set('sesso', e.target.value)}>
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
            <div><label className="label">Data di nascita</label><input type="date" className="input" value={form.data_nascita} onChange={e => set('data_nascita', e.target.value)} /></div>
            <div><label className="label">Codice fiscale</label><input className="input" value={form.codice_fiscale} onChange={e => set('codice_fiscale', e.target.value)} /></div>
            <div><label className="label">Nazionalità</label><input className="input" value={form.nazionalita} onChange={e => set('nazionalita', e.target.value)} placeholder="es. UE, EXTRA UE, Italia…" /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div><label className="label">Telefono</label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>

            <div><label className="label">Funzione aziendale</label><input className="input" value={form.funzione_aziendale} onChange={e => set('funzione_aziendale', e.target.value)} /></div>
            <div><label className="label">Reparto</label>
              <div className="flex gap-1.5">
                <select className="input" value={form.reparto_id} onChange={e => set('reparto_id', e.target.value)}>
                  <option value="">—</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="button" onClick={() => addCatalogEntry('departments', 'reparto', setDepartments, 'reparto_id')} title="Nuovo reparto" className="btn-secondary text-sm px-3 shrink-0">+</button>
              </div>
            </div>
            <div className="col-span-full"><label className="label">Plant / Sede (anche più di una)</label>
              <PlantMultiSelect plants={plants} value={plantIds} onChange={setPlantIds} onAdd={() => addCatalogEntry('plants', 'plant', setPlants, 'plant_id')} />
            </div>
            <div><label className="label">Mansione</label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer self-end pb-2">
              <input type="checkbox" checked={l68} onChange={e => setL68(e.target.checked)} />
              Legge 68 (L.68)
            </label>
            <div><label className="label">Livello</label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
            <div><label className="label">Categoria</label><input className="input" value={form.categoria} onChange={e => set('categoria', e.target.value)} placeholder="es. DIRETTO, APL…" /></div>
            <div><label className="label">Società contratto</label>
              <div className="flex gap-1.5">
                <select className="input" value={form.contract_company_id} onChange={e => set('contract_company_id', e.target.value)}>
                  <option value="">—</option>
                  {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                </select>
                <button type="button" onClick={() => addCatalogEntry('contract-companies', 'società contratto', setCompanies, 'contract_company_id')} title="Nuova società" className="btn-secondary text-sm px-3 shrink-0">+</button>
              </div>
            </div>
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
    {dialog}
    </>
  );
}
