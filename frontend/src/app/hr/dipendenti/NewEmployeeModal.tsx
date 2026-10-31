'use client';

import { useState } from 'react';
import type { HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag } from '@/types';
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
  tags: HrEmployeeTag[];
  funzioni: string[];
  onClose: () => void;
  onCreated: () => void;
}

export function NewEmployeeModal({ departments: initialDepartments, plants: initialPlants, companies: initialCompanies, tags, funzioni: initialFunzioni, onClose, onCreated }: Props) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [plants, setPlants] = useState(initialPlants);
  const [companies, setCompanies] = useState(initialCompanies);
  const [funzioni, setFunzioni] = useState(initialFunzioni);
  const [form, setForm] = useState({
    matricola: '', nome: '', cognome: '', sesso: '', data_nascita: '', codice_fiscale: '', nazionalita: '',
    email: '', telefono: '', indirizzo: '', citta: '', provincia: '', cap: '', gruppo_orario: '', nome_osti: '', taglia_pantaloni: '', taglia_maglia: '', taglia_scarpe: '', mansione: '', livello: '', categoria: '', tipo_contratto: '', funzione_aziendale: '',
    reparto_id: '', contract_company_id: '', data_assunzione: '', tag_id: '',
  });
  const [plantIds, setPlantIds] = useState<number[]>([]);
  const [l68, setL68] = useState(false);
  const [inProva, setInProva] = useState(false);
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
        indirizzo: form.indirizzo || null,
        citta: form.citta || null,
        provincia: form.provincia || null,
        cap: form.cap || null,
        gruppo_orario: form.gruppo_orario || null,
        nome_osti: form.nome_osti || null,
        taglia_pantaloni: form.taglia_pantaloni || null,
        taglia_maglia: form.taglia_maglia || null,
        taglia_scarpe: form.taglia_scarpe || null,
        mansione: form.mansione || null,
        livello: form.livello || null,
        categoria: form.categoria || null,
        tipo_contratto: form.tipo_contratto || null,
        funzione_aziendale: form.funzione_aziendale || null,
        reparto_id: form.reparto_id ? Number(form.reparto_id) : null,
        plant_ids: plantIds,
        l68,
        in_prova: inProva,
        tag_id: form.tag_id ? Number(form.tag_id) : null,
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
      <div className="bg-white rounded-card shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-base font-medium text-ink-900 mb-4">Nuovo dipendente</h2>
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
            <div><label className="label">Nome Osti</label><input className="input" maxLength={200} value={form.nome_osti} onChange={e => set('nome_osti', e.target.value)} placeholder="Come compare in Osti" /></div>
            <div><label className="label">Nazionalità</label><input className="input" value={form.nazionalita} onChange={e => set('nazionalita', e.target.value)} placeholder="es. UE, EXTRA UE, Italia…" /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div><label className="label">Telefono</label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
            <div className="col-span-2"><label className="label">Indirizzo (residenza)</label><input className="input" value={form.indirizzo} onChange={e => set('indirizzo', e.target.value)} /></div>
            <div><label className="label">Città</label><input className="input" value={form.citta} onChange={e => set('citta', e.target.value)} /></div>
            <div><label className="label">Provincia</label><input className="input" maxLength={50} value={form.provincia} onChange={e => set('provincia', e.target.value.toUpperCase())} placeholder="es. MO" /></div>
            <div><label className="label">CAP</label><input className="input" maxLength={10} value={form.cap} onChange={e => set('cap', e.target.value)} /></div>
            <div><label className="label">Gruppo orario</label><input className="input" value={form.gruppo_orario} onChange={e => set('gruppo_orario', e.target.value)} /></div>
            <p className="col-span-full text-sm font-semibold text-ink-800 -mb-2">Vestiario</p>
            <div><label className="label">Taglia pantaloni</label><input className="input" maxLength={20} value={form.taglia_pantaloni} onChange={e => set('taglia_pantaloni', e.target.value)} placeholder="es. 48" /></div>
            <div><label className="label">Taglia maglia</label><input className="input" maxLength={20} value={form.taglia_maglia} onChange={e => set('taglia_maglia', e.target.value)} placeholder="es. L" /></div>
            <div><label className="label">Taglia scarpe</label><input className="input" maxLength={20} value={form.taglia_scarpe} onChange={e => set('taglia_scarpe', e.target.value)} placeholder="es. 42" /></div>

            <div><label className="label">Funzione aziendale</label>
              <div className="flex gap-1.5">
                <select className="input" value={form.funzione_aziendale} onChange={e => set('funzione_aziendale', e.target.value)}>
                  <option value="">—</option>
                  {funzioni.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const name = await ask({ title: 'Nuova funzione aziendale', label: 'Nome funzione', confirmLabel: 'Usa' });
                    if (typeof name !== 'string' || !name.trim()) return;
                    const trimmed = name.trim();
                    setFunzioni(f => f.includes(trimmed) ? f : [...f, trimmed].sort((a, b) => a.localeCompare(b)));
                    set('funzione_aziendale', trimmed);
                  }}
                  title="Nuova funzione aziendale" className="btn-secondary text-sm px-3 shrink-0"
                >+</button>
              </div>
            </div>
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
            <label className="flex items-center gap-2 text-sm text-ink-800 cursor-pointer self-end pb-2">
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
            <div><label className="label">Etichetta</label>
              <select className="input" value={form.tag_id} onChange={e => set('tag_id', e.target.value)}>
                <option value="">—</option>
                {tags.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-800 cursor-pointer self-end pb-2">
              <input type="checkbox" checked={inProva} onChange={e => setInProva(e.target.checked)} />
              In prova
            </label>
          </div>

          {error && <p className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-ctl px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Annulla</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Crea dipendente'}</button>
          </div>
        </form>
        </div>
      </div>
    </div>
    {dialog}
    </>
  );
}
