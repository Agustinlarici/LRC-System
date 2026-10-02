'use client';

import { useState, useEffect } from 'react';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag, HrCapoPair } from '@/types';
import { PlantMultiSelect } from '../PlantMultiSelect';
import { usePromptDialog } from '@/components/ui/PromptDialog';

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
  funzioni: string[];
  allEmployees: HrEmployee[];
  fullManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// Un capo senza gestione HR completa può aggiornare solo dati di contatto —
// tutto il resto (reparto, mansione, livello, capo, stato) resta esclusivo di HR.
export function EditEmployeeModal({ employee, departments, plants, companies, tags, funzioni: initialFunzioni, allEmployees, fullManage, onClose, onSaved }: Props) {
  const [funzioni, setFunzioni] = useState(initialFunzioni);
  const { ask, dialog } = usePromptDialog();
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

  // Coppia di co-responsabile: due persone che guidano insieme lo stesso team —
  // compaiono affiancate nell'organigramma. Si gestisce qui, non in una pagina a parte.
  const [existingPair, setExistingPair] = useState<HrCapoPair | null>(null);
  const [coResponsabileId, setCoResponsabileId] = useState('');
  useEffect(() => {
    if (!fullManage) return;
    (async () => {
      const res = await fetch(`${BACKEND}/api/hr/capo-pairs`, { credentials: 'include' });
      if (!res.ok) return;
      const pairs: HrCapoPair[] = await res.json();
      const mine = pairs.find(p => p.employee_a_id === employee.id || p.employee_b_id === employee.id);
      if (mine) {
        setExistingPair(mine);
        setCoResponsabileId(String(mine.employee_a_id === employee.id ? mine.employee_b_id : mine.employee_a_id));
      }
    })();
  }, [fullManage, employee.id]);

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
    if (!res.ok) {
      setSaving(false);
      const b = await res.json().catch(() => ({}));
      setError(b.message ?? 'Errore durante il salvataggio');
      return;
    }

    // Allinea la coppia di co-responsabile solo se è cambiata rispetto a quella esistente.
    if (fullManage) {
      const currentPartnerId = existingPair
        ? (existingPair.employee_a_id === employee.id ? existingPair.employee_b_id : existingPair.employee_a_id)
        : null;
      const newPartnerId = coResponsabileId ? Number(coResponsabileId) : null;
      if (newPartnerId !== currentPartnerId) {
        if (existingPair) {
          await fetch(`${BACKEND}/api/hr/capo-pairs/${existingPair.id}`, { method: 'DELETE', credentials: 'include' });
        }
        if (newPartnerId) {
          await fetch(`${BACKEND}/api/hr/capo-pairs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ employee_a_id: employee.id, employee_b_id: newPartnerId }),
          });
        }
      }
      // Chi guida lo stesso team insieme deve avere lo stesso responsabile sopra, altrimenti
      // il/la partner risulterebbe "senza responsabile" nell'organigramma pur avendone uno.
      if (newPartnerId) {
        await fetch(`${BACKEND}/api/hr/employees/${newPartnerId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ capo_id: form.capo_id ? Number(form.capo_id) : null }),
        });
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-base font-medium text-gray-900 mb-1">Modifica dipendente</h2>
        {!fullManage && <p className="text-xs text-amber-600 mb-4">Puoi modificare solo i dati di contatto del tuo team diretto.</p>}
        <form onSubmit={submit} className="space-y-4">
          {fullManage && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div><label className="label">Cognome</label><input className="input" required value={form.cognome} onChange={e => set('cognome', e.target.value)} /></div>
              <div><label className="label">Nome</label><input className="input" required value={form.nome} onChange={e => set('nome', e.target.value)} /></div>
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
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer self-end pb-2">
                <input type="checkbox" checked={l68} onChange={e => setL68(e.target.checked)} />
                Legge 68 (L.68)
              </label>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Anagrafica e contatti</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Sesso</label>
                  <select className="input" value={form.sesso} onChange={e => set('sesso', e.target.value)}>
                    <option value="">—</option>
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </div>
                <div><label className="label">Nazionalità</label><input className="input" value={form.nazionalita} onChange={e => set('nazionalita', e.target.value)} /></div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Contratto</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Matricola</label><input className="input" value={form.matricola} onChange={e => set('matricola', e.target.value)} placeholder="Vuota per contrattisti/agenzia" /></div>
                <div><label className="label">Società contratto</label>
                  <select className="input" value={form.contract_company_id} onChange={e => set('contract_company_id', e.target.value)}>
                    <option value="">—</option>
                    {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Categoria</label><input className="input" value={form.categoria} onChange={e => set('categoria', e.target.value)} /></div>
                <div><label className="label">Tipo contratto</label><input className="input" value={form.tipo_contratto} onChange={e => set('tipo_contratto', e.target.value)} /></div>
                <div><label className="label">Data cessazione / fine contratto</label>
                  <input type="date" className="input" value={form.data_cessazione} onChange={e => set('data_cessazione', e.target.value)} />
                  <p className="text-[11px] text-gray-400 mt-1">Con stato Cessato, se vuota verrà usata la data di oggi. Una data futura con stato Attivo indica la scadenza del contratto.</p>
                </div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Lavoro</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                  <select className="input" value={form.reparto_id} onChange={e => set('reparto_id', e.target.value)}>
                    <option value="">—</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="col-span-full"><label className="label">Plant / Sede (anche più di una)</label>
                  <PlantMultiSelect plants={plants} value={plantIds} onChange={setPlantIds} />
                </div>
                <div><label className="label">Mansione</label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
                <div><label className="label">Livello</label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
                <div><label className="label">Responsabile</label>
                  <select className="input" value={form.capo_id} onChange={e => set('capo_id', e.target.value)}>
                    <option value="">—</option>
                    {allEmployees.map(e => <option key={e.id} value={e.id}>{e.cognome} {e.nome}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          {fullManage && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700">{employee.nome} guida un team insieme a un&apos;altra persona?</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                Usalo solo se {employee.nome} è responsabile di qualcuno e condivide quel team con un&apos;altra persona (co-responsabili).
                Le due persone compariranno affiancate nell&apos;organigramma, separate da una riga sottile, con lo stesso team sotto a entrambe.
                Il/la co-responsabile prende automaticamente lo stesso "Responsabile" impostato sopra, così la catena resta corretta.
                Non serve per indicare un secondo responsabile di {employee.nome}.
              </p>
              <select className="input text-sm max-w-xs" value={coResponsabileId} onChange={e => setCoResponsabileId(e.target.value)}>
                <option value="">Nessun co-responsabile</option>
                {allEmployees.map(e => <option key={e.id} value={e.id}>Insieme a {e.cognome} {e.nome}</option>)}
              </select>
            </div>
          )}
          <div>
            {fullManage && <p className="text-sm font-semibold text-gray-700 mb-2">Contatti</p>}
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Telefono</label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
              <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Indirizzo</label><input className="input" value={form.indirizzo} onChange={e => set('indirizzo', e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={e => set('note', e.target.value)} /></div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Annulla</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Salva'}</button>
          </div>
        </form>
        </div>
      </div>
    </div>
    {dialog}
    </>
  );
}
