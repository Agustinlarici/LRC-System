'use client';

import { useState } from 'react';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag } from '@/types';
import { PlantMultiSelect } from '../PlantMultiSelect';

// Il set di stati validi è stato ridotto a questi 3: "aspettativa" e "malattia" restano
// nel database solo per chi li aveva già (nessuna migrazione automatica, vedi migrate-hr-tags.sql),
// ma non sono più selezionabili per nuovi cambi di stato.
const STATO_OPTIONS: { value: string; label: string }[] = [
  { value: 'attivo', label: 'Attivo' },
  { value: 'maternita_paternita', label: 'Maternità/Paternità' },
  { value: 'cessato', label: 'Cessato' },
];
const LEGACY_STATO_LABEL: Record<string, string> = { aspettativa: 'Aspettativa (legacy)', malattia: 'Malattia (legacy)' };

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  employee: HrEmployee;
  departments: HrDepartment[];
  plants: HrPlant[];
  companies: HrContractCompany[];
  tags: HrEmployeeTag[];
  allEmployees: HrEmployee[];
  fullManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// Un capo senza gestione HR completa può aggiornare solo dati di contatto —
// tutto il resto (reparto, mansione, livello, capo, stato) resta esclusivo di HR.
export function EditEmployeeModal({ employee, departments, plants, companies, tags, allEmployees, fullManage, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    matricola: employee.matricola ?? '',
    nome: employee.nome,
    cognome: employee.cognome,
    reparto_id: employee.reparto_id ? String(employee.reparto_id) : '',
    contract_company_id: employee.contract_company_id ? String(employee.contract_company_id) : '',
    capo_id: employee.capo_id ? String(employee.capo_id) : '',
    sesso: employee.sesso ?? '',
    nazionalita: employee.nazionalita ?? '',
    mansione: employee.mansione ?? '',
    livello: employee.livello ?? '',
    categoria: employee.categoria ?? '',
    funzione_aziendale: employee.funzione_aziendale ?? '',
    tipo_contratto: employee.tipo_contratto ?? '',
    stato: employee.stato,
    tag_id: employee.tag_id ? String(employee.tag_id) : '',
    // <input type="date"> richiede esattamente "YYYY-MM-DD": il backend restituisce
    // le colonne DATE come timestamp ISO completo, va troncato.
    data_cessazione: employee.data_cessazione?.slice(0, 10) ?? '',
    telefono: employee.telefono ?? '',
    email: employee.email ?? '',
    indirizzo: employee.indirizzo ?? '',
    note: employee.note ?? '',
  });
  const [plantIds, setPlantIds] = useState<number[]>(employee.plant_ids ?? []);
  const [l68, setL68] = useState(!!employee.l68);
  const [inProva, setInProva] = useState(!!employee.in_prova);
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
          plant_ids: plantIds,
          l68,
          in_prova: inProva,
          tag_id: form.tag_id ? Number(form.tag_id) : null,
          contract_company_id: form.contract_company_id ? Number(form.contract_company_id) : null,
          capo_id: form.capo_id ? Number(form.capo_id) : null,
          data_cessazione: form.data_cessazione || null,
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-medium text-gray-900 mb-1">Modifica dipendente</h2>
        {!fullManage && <p className="text-xs text-amber-600 mb-4">Puoi modificare solo i dati di contatto del tuo team diretto.</p>}
        <form onSubmit={submit} className="space-y-4">
          {fullManage && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div><label className="label">Matricola</label><input className="input" value={form.matricola} onChange={e => set('matricola', e.target.value)} placeholder="Vuota per contrattisti/agenzia" /></div>
              <div><label className="label">Cognome</label><input className="input" required value={form.cognome} onChange={e => set('cognome', e.target.value)} /></div>
              <div><label className="label">Nome</label><input className="input" required value={form.nome} onChange={e => set('nome', e.target.value)} /></div>
              <div><label className="label">Sesso</label>
                <select className="input" value={form.sesso} onChange={e => set('sesso', e.target.value)}>
                  <option value="">—</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </div>
              <div><label className="label">Nazionalità</label><input className="input" value={form.nazionalita} onChange={e => set('nazionalita', e.target.value)} /></div>
              <div><label className="label">Funzione aziendale</label><input className="input" value={form.funzione_aziendale} onChange={e => set('funzione_aziendale', e.target.value)} /></div>
              <div><label className="label">Reparto</label>
                <select className="input" value={form.reparto_id} onChange={e => set('reparto_id', e.target.value)}>
                  <option value="">—</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="col-span-full"><label className="label">Plant / Sede (anche più di una)</label>
                <PlantMultiSelect plants={plants} value={plantIds} onChange={setPlantIds} />
              </div>
              <div><label className="label">Responsabile</label>
                <select className="input" value={form.capo_id} onChange={e => set('capo_id', e.target.value)}>
                  <option value="">—</option>
                  {allEmployees.map(e => <option key={e.id} value={e.id}>{e.cognome} {e.nome}</option>)}
                </select>
              </div>
              <div><label className="label">Mansione</label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer self-end pb-2">
                <input type="checkbox" checked={l68} onChange={e => setL68(e.target.checked)} />
                Legge 68 (L.68)
              </label>
              <div><label className="label">Livello</label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
              <div><label className="label">Categoria</label><input className="input" value={form.categoria} onChange={e => set('categoria', e.target.value)} /></div>
              <div><label className="label">Società contratto</label>
                <select className="input" value={form.contract_company_id} onChange={e => set('contract_company_id', e.target.value)}>
                  <option value="">—</option>
                  {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                </select>
              </div>
              <div><label className="label">Tipo contratto</label><input className="input" value={form.tipo_contratto} onChange={e => set('tipo_contratto', e.target.value)} /></div>
              <div><label className="label">Stato</label>
                <select className="input" value={form.stato} onChange={e => set('stato', e.target.value)}>
                  {STATO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {LEGACY_STATO_LABEL[employee.stato] && (
                    <option value={employee.stato}>{LEGACY_STATO_LABEL[employee.stato]}</option>
                  )}
                </select>
              </div>
              <div><label className="label">Etichetta</label>
                <select className="input" value={form.tag_id} onChange={e => set('tag_id', e.target.value)}>
                  <option value="">—</option>
                  {tags.filter(t => t.is_active || String(t.id) === form.tag_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer self-end pb-2">
                <input type="checkbox" checked={inProva} onChange={e => setInProva(e.target.checked)} />
                In prova
              </label>
              <div><label className="label">Data cessazione / fine contratto</label>
                <input type="date" className="input" value={form.data_cessazione} onChange={e => set('data_cessazione', e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-1">Con stato Cessato, se vuota verrà usata la data di oggi. Una data futura con stato Attivo indica la scadenza del contratto.</p>
              </div>
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
