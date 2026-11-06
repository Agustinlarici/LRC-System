'use client';

import { useState, useEffect } from 'react';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag, HrCapoPair } from '@/types';
import { PlantMultiSelect } from '../PlantMultiSelect';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import { OstiMark, OstiLegend } from '@/components/ui/OstiMark';

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
    data_nascita: employee.data_nascita?.slice(0, 10) ?? '',
    gruppo_orario: employee.gruppo_orario ?? '',
    nome_osti: employee.nome_osti ?? '',
    taglia_pantaloni: employee.taglia_pantaloni ?? '',
    taglia_maglia: employee.taglia_maglia ?? '',
    taglia_scarpe: employee.taglia_scarpe ?? '',
    badge: employee.badge ?? '',
    transponder: employee.transponder ?? '',
    terminale: employee.terminale ?? '',
    qualifica: employee.qualifica ?? '',
    indeterminato: employee.indeterminato == null ? '' : employee.indeterminato ? 'si' : 'no',
    indeterminato_data: employee.indeterminato_data?.slice(0, 10) ?? '',
    part_time: employee.part_time ?? '',
    luogo_nascita: employee.luogo_nascita ?? '',
    titolo_studio: employee.titolo_studio ?? '',
    stato_civile: employee.stato_civile ?? '',
    tipo_nazionalita: employee.tipo_nazionalita ?? '',
    domicilio_indirizzo: employee.domicilio_indirizzo ?? '',
    domicilio_citta: employee.domicilio_citta ?? '',
    domicilio_provincia: employee.domicilio_provincia ?? '',
    domicilio_cap: employee.domicilio_cap ?? '',
    note_hr: employee.note_hr ?? '',
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
    citta: employee.citta ?? '',
    provincia: employee.provincia ?? '',
    cap: employee.cap ?? '',
    note: employee.note ?? '',
  });
  const [plantIds, setPlantIds] = useState<number[]>(employee.plant_ids ?? []);
  const [l68, setL68] = useState(!!employee.l68);
  const [inProva, setInProva] = useState(!!employee.in_prova);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Account di sistema collegato alla scheda (serve ai capi per usare Team e Richieste)
  const [userId, setUserId] = useState(employee.user_id ? String(employee.user_id) : '');
  const [accounts, setAccounts] = useState<{ id: number; username: string; display_name: string; employee_id: number | null; employee_name: string | null }[]>([]);
  useEffect(() => {
    if (!fullManage) return;
    (async () => {
      const res = await fetch(`${BACKEND}/api/hr/users`, { credentials: 'include' });
      if (res.ok) setAccounts(await res.json());
    })();
  }, [fullManage]);

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
          user_id: userId ? Number(userId) : null,
          data_cessazione: form.data_cessazione || null,
          indeterminato: form.indeterminato === '' ? null : form.indeterminato === 'si',
          indeterminato_data: form.indeterminato_data || null,
        }
      : { telefono: form.telefono, email: form.email, indirizzo: form.indirizzo, citta: form.citta, provincia: form.provincia, cap: form.cap, note: form.note };

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
          const delRes = await fetch(`${BACKEND}/api/hr/capo-pairs/${existingPair.id}`, { method: 'DELETE', credentials: 'include' });
          if (!delRes.ok) {
            setSaving(false);
            const b = await delRes.json().catch(() => ({}));
            setError(b.message ?? 'Errore durante la rimozione del co-responsabile precedente');
            return;
          }
        }
        if (newPartnerId) {
          const pairRes = await fetch(`${BACKEND}/api/hr/capo-pairs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ employee_a_id: employee.id, employee_b_id: newPartnerId }),
          });
          if (!pairRes.ok) {
            setSaving(false);
            const b = await pairRes.json().catch(() => ({}));
            setError(b.message ?? 'Errore durante il salvataggio del co-responsabile');
            return;
          }
        }
      }
      // Chi guida lo stesso team insieme deve avere lo stesso responsabile sopra, altrimenti
      // il/la partner risulterebbe "senza responsabile" nell'organigramma pur avendone uno.
      if (newPartnerId) {
        const partnerRes = await fetch(`${BACKEND}/api/hr/employees/${newPartnerId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ capo_id: form.capo_id ? Number(form.capo_id) : null }),
        });
        if (!partnerRes.ok) {
          setSaving(false);
          const b = await partnerRes.json().catch(() => ({}));
          setError(b.message ?? 'Co-responsabile salvato, ma non è stato possibile allineare il suo responsabile');
          return;
        }
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-card shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-base font-medium text-ink-900 mb-1">Modifica dipendente</h2>
        <OstiLegend className="mb-2" />
        {!fullManage && <p className="text-xs text-warning mb-4">Puoi modificare solo i dati di contatto del tuo team diretto.</p>}
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
            </div>
          )}

          {fullManage && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={() => setInProva(v => !v)}
                className={`text-sm px-3 py-1.5 rounded-ctl border transition-colors ${inProva ? 'bg-ink-800 border-ink-800 text-white' : 'bg-white border-stone-300 text-muted hover:border-accent'}`}
              >In prova</button>
              <button
                type="button" onClick={() => setL68(v => !v)}
                className={`text-sm px-3 py-1.5 rounded-ctl border transition-colors ${l68 ? 'bg-ink-800 border-ink-800 text-white' : 'bg-white border-stone-300 text-muted hover:border-accent'}`}
              >Legge 68 (L.68)</button>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-ink-800 mb-2">Anagrafica e contatti</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Sesso<OstiMark /></label>
                  <select className="input" value={form.sesso} onChange={e => set('sesso', e.target.value)}>
                    <option value="">—</option>
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </div>
                <div><label className="label">Data di nascita<OstiMark /></label><input type="date" className="input" value={form.data_nascita} onChange={e => set('data_nascita', e.target.value)} /></div>
                <div><label className="label">Nazionalità<OstiMark /></label><input className="input" value={form.nazionalita} onChange={e => set('nazionalita', e.target.value)} /></div>
                <div><label className="label">Extra UE / Italia<OstiMark /></label><select className="input" value={form.tipo_nazionalita} onChange={e => set('tipo_nazionalita', e.target.value)}><option value="">—</option><option value="ITALIANO">ITALIA</option><option value="UE">UE</option><option value="EXTRA UE">EXTRA UE</option></select></div>
                <div><label className="label">Nome Osti<OstiMark /></label><input className="input" maxLength={200} value={form.nome_osti} onChange={e => set('nome_osti', e.target.value)} placeholder="Come compare in Osti" /></div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-ink-800 mb-2">Contratto</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Matricola<OstiMark /></label><input className="input" value={form.matricola} onChange={e => set('matricola', e.target.value)} placeholder="Vuota per contrattisti/agenzia" /></div>
                <div><label className="label">Società contratto</label>
                  <select className="input" value={form.contract_company_id} onChange={e => set('contract_company_id', e.target.value)}>
                    <option value="">—</option>
                    {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Categoria</label><input className="input" value={form.categoria} onChange={e => set('categoria', e.target.value)} /></div>
                <div><label className="label">Tipo contratto</label><input className="input" value={form.tipo_contratto} onChange={e => set('tipo_contratto', e.target.value)} /></div>
                <div><label className="label">Data cessazione / fine contratto<OstiMark /></label>
                  <input type="date" className="input" value={form.data_cessazione} onChange={e => set('data_cessazione', e.target.value)} />
                  <p className="text-[11px] text-muted mt-1">Con stato Cessato, se vuota verrà usata la data di oggi. Una data futura con stato Attivo indica la scadenza del contratto.</p>
                </div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-ink-800 mb-2">Lavoro</p>
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
                <div><label className="label">Mansione<OstiMark /></label><input className="input" value={form.mansione} onChange={e => set('mansione', e.target.value)} /></div>
                <div><label className="label">Livello<OstiMark /></label><input className="input" value={form.livello} onChange={e => set('livello', e.target.value)} /></div>
                <div><label className="label">Gruppo orario</label><input className="input" value={form.gruppo_orario} onChange={e => set('gruppo_orario', e.target.value)} /></div>
                <div><label className="label">Responsabile</label>
                  <select className="input" value={form.capo_id} onChange={e => set('capo_id', e.target.value)}>
                    <option value="">—</option>
                    {allEmployees.map(e => <option key={e.id} value={e.id}>{e.cognome} {e.nome}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2"><label className="label">Account di sistema</label>
                  <select className="input" value={userId} onChange={e => setUserId(e.target.value)}>
                    <option value="">— Nessun account —</option>
                    {accounts.map(a => {
                      const taken = a.employee_id != null && a.employee_id !== employee.id;
                      return (
                        <option key={a.id} value={a.id} disabled={taken}>
                          {a.display_name} ({a.username}){taken ? ` — già collegato a ${a.employee_name}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-xs text-muted mt-1">Serve ai capi: con l&apos;account collegato vedono il proprio team e possono fare richieste.</p>
                </div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-ink-800 mb-2">Vestiario</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Taglia pantaloni</label><input className="input" maxLength={20} value={form.taglia_pantaloni} onChange={e => set('taglia_pantaloni', e.target.value)} placeholder="es. 48" /></div>
                <div><label className="label">Taglia maglia</label><input className="input" maxLength={20} value={form.taglia_maglia} onChange={e => set('taglia_maglia', e.target.value)} placeholder="es. L" /></div>
                <div><label className="label">Taglia scarpe</label><input className="input" maxLength={20} value={form.taglia_scarpe} onChange={e => set('taglia_scarpe', e.target.value)} placeholder="es. 42" /></div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Altri dati (Osti)</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Badge<OstiMark /></label><input className="input" maxLength={50} value={form.badge} onChange={e => set('badge', e.target.value)} /></div>
                <div><label className="label">Transponder<OstiMark /></label><input className="input" maxLength={50} value={form.transponder} onChange={e => set('transponder', e.target.value)} /></div>
                <div><label className="label">Terminale di timbratura<OstiMark /></label><input className="input" maxLength={50} value={form.terminale} onChange={e => set('terminale', e.target.value)} /></div>
                <div><label className="label">Qualifica<OstiMark /></label><input className="input" maxLength={100} value={form.qualifica} onChange={e => set('qualifica', e.target.value)} /></div>
                <div><label className="label">Tempo indeterminato<OstiMark /></label>
                  <select className="input" value={form.indeterminato} onChange={e => set('indeterminato', e.target.value)}>
                    <option value="">—</option>
                    <option value="si">Sì</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div><label className="label">Data passaggio a indeterminato<OstiMark /></label><input type="date" className="input" value={form.indeterminato_data} onChange={e => set('indeterminato_data', e.target.value)} /></div>
                <div><label className="label">Part-time<OstiMark /></label><input className="input" maxLength={30} value={form.part_time} onChange={e => set('part_time', e.target.value)} /></div>
                <div><label className="label">Luogo di nascita<OstiMark /></label><input className="input" maxLength={150} value={form.luogo_nascita} onChange={e => set('luogo_nascita', e.target.value)} /></div>
                <div><label className="label">Titolo di studio</label><input className="input" maxLength={100} value={form.titolo_studio} onChange={e => set('titolo_studio', e.target.value)} /></div>
                <div><label className="label">Stato civile<OstiMark /></label><input className="input" maxLength={50} value={form.stato_civile} onChange={e => set('stato_civile', e.target.value)} /></div>
              </div>
            </div>
          )}

          {fullManage && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Domicilio</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label className="label">Indirizzo<OstiMark /></label><input className="input" maxLength={255} value={form.domicilio_indirizzo} onChange={e => set('domicilio_indirizzo', e.target.value)} /></div>
                <div><label className="label">Città<OstiMark /></label><input className="input" maxLength={100} value={form.domicilio_citta} onChange={e => set('domicilio_citta', e.target.value)} /></div>
                <div><label className="label">Provincia<OstiMark /></label><input className="input" maxLength={50} value={form.domicilio_provincia} onChange={e => set('domicilio_provincia', e.target.value.toUpperCase())} /></div>
                <div><label className="label">CAP<OstiMark /></label><input className="input" maxLength={10} value={form.domicilio_cap} onChange={e => set('domicilio_cap', e.target.value)} /></div>
                <div className="col-span-full"><label className="label">Note HR<OstiMark /></label><textarea className="input" rows={2} value={form.note_hr} onChange={e => set('note_hr', e.target.value)} /></div>
              </div>
            </div>
          )}
          {fullManage && (
            <div className="bg-stone-50 border border-line rounded-ctl p-3">
              <p className="text-sm font-medium text-ink-800">{employee.nome} guida un team insieme a un&apos;altra persona?</p>
              <p className="text-xs text-muted mt-0.5 mb-2">Compariranno affiancate nell&apos;organigramma, con lo stesso team sotto a entrambe.</p>
              <select className="input text-sm max-w-xs" value={coResponsabileId} onChange={e => setCoResponsabileId(e.target.value)}>
                <option value="">Nessun co-responsabile</option>
                {allEmployees.map(e => <option key={e.id} value={e.id}>{e.cognome} {e.nome}</option>)}
              </select>
            </div>
          )}
          <div>
            {fullManage && <p className="text-sm font-semibold text-ink-800 mb-2">Contatti</p>}
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Telefono<OstiMark /></label><input className="input" value={form.telefono} onChange={e => set('telefono', e.target.value)} /></div>
              <div><label className="label">Email<OstiMark /></label><input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Indirizzo (residenza)<OstiMark /></label><input className="input" value={form.indirizzo} onChange={e => set('indirizzo', e.target.value)} /></div>
              <div><label className="label">Città<OstiMark /></label><input className="input" value={form.citta} onChange={e => set('citta', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Provincia<OstiMark /></label><input className="input" maxLength={50} value={form.provincia} onChange={e => set('provincia', e.target.value.toUpperCase())} placeholder="es. MO" /></div>
                <div><label className="label">CAP<OstiMark /></label><input className="input" maxLength={10} value={form.cap} onChange={e => set('cap', e.target.value)} /></div>
              </div>
              <div className="col-span-2"><label className="label">Note<OstiMark /></label><textarea className="input" rows={2} value={form.note} onChange={e => set('note', e.target.value)} /></div>
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-ctl px-3 py-2">{error}</p>}

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
