'use client';

import { useEffect, useState, useCallback } from 'react';
import type { HrEmployee, HrEmployeeEvent, HrEventType, HrDepartment, HrPlant, HrDocument } from '@/types';
import { useToast } from '@/components/ui/Toast';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const EVENT_LABEL: Record<HrEventType, string> = {
  assunzione: 'Assunzione', cambio_reparto: 'Cambio reparto', cambio_mansione: 'Cambio mansione',
  cambio_livello: 'Cambio livello', cambio_capo: 'Cambio responsabile',
  trasferimento: 'Trasferimento', promozione: 'Promozione', cessazione: 'Cessazione/Dimissioni',
  malattia: 'Malattia', maternita_paternita: 'Maternità/Paternità', infortunio: 'Infortunio',
  congedo: 'Congedo', rientro: 'Rientro', altro: 'Altro',
};

// Eventi che un capo (senza gestione HR completa) può registrare per il proprio team
const CAPO_ALLOWED: HrEventType[] = ['malattia', 'maternita_paternita', 'rientro', 'trasferimento', 'altro'];
// Solo gli eventi gestiti dal sistema (infortunio e congedo restano in EVENT_LABEL per mostrare i vecchi eventi)
const ALL_EVENTS: HrEventType[] = [
  'assunzione', 'cambio_reparto', 'cambio_mansione', 'cambio_livello', 'cambio_capo',
  'trasferimento', 'promozione', 'cessazione', 'malattia', 'maternita_paternita', 'rientro', 'altro',
];

function fmtDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props {
  employeeId: number; employee: HrEmployee; canManage: boolean; canManageLimited: boolean;
  departments: HrDepartment[]; plants: HrPlant[]; allEmployees: HrEmployee[];
}

export function EventTimeline({ employeeId, employee, departments, plants, allEmployees, canManage, canManageLimited }: Props) {
  const [events, setEvents] = useState<HrEmployeeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [offer, setOffer] = useState<{ docs: HrDocument[]; eventId: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/events`, { credentials: 'include' });
    if (res.ok) setEvents(await res.json());
    setLoading(false);
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const availableTypes = canManage ? ALL_EVENTS : CAPO_ALLOWED;

  // Dopo la registrazione: se HR ha un modello Word collegato a questo tipo di evento, lo propone.
  // La generazione richiede la gestione HR completa, quindi un capo non vede la proposta.
  async function offerDocuments(ev: HrEmployeeEvent) {
    if (!canManage) return;
    const res = await fetch(`${BACKEND}/api/hr/documents`, { credentials: 'include' });
    if (!res.ok) return;
    const docs: HrDocument[] = await res.json();
    const matching = docs.filter(d => d.kind === 'modello' && d.is_active && d.has_file && d.event_type === ev.event_type);
    if (matching.length) setOffer({ docs: matching, eventId: ev.id });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-gray-600">Storico eventi</p>
          <p className="text-xs text-gray-400">Timeline completa — assunzione, cambi, congedi e altri eventi</p>
        </div>
        {canManageLimited && (
          <button onClick={() => setShowForm(s => !s)} className="btn-secondary text-sm">{showForm ? 'Chiudi' : '+ Registra evento'}</button>
        )}
      </div>

      {showForm && (
        <NewEventForm
          employeeId={employeeId}
          employee={employee}
          lookups={{ departments, plants, allEmployees }}
          availableTypes={availableTypes}
          onDone={ev => { setShowForm(false); load(); offerDocuments(ev); }}
        />
      )}

      {offer && <GenerateWordDialog employee={employee} offer={offer} onClose={() => setOffer(null)} />}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">Caricamento…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Nessun evento registrato</p>
      ) : (
        <div className="relative pl-6 mt-4 space-y-5">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
          {events.map(ev => (
            <div key={ev.id} className="relative">
              <div className="absolute -left-6 top-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white shadow" />
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">{EVENT_LABEL[ev.event_type]}</span>
                <span className="text-xs text-gray-400">{fmtDate(ev.event_date)}{ev.end_date ? ` → ${fmtDate(ev.end_date)}` : ''}</span>
              </div>
              {(ev.from_value || ev.to_value) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {ev.from_value ? <>da <span className="font-medium">{ev.from_value}</span> </> : null}
                  {ev.to_value ? <>a <span className="font-medium">{ev.to_value}</span></> : null}
                </p>
              )}
              {ev.note && <p className="text-xs text-gray-500 mt-0.5">{ev.note}</p>}
              {ev.created_by_name && <p className="text-[10px] text-gray-300 mt-0.5">registrato da {ev.created_by_name}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Eventi di cambio: etichetta del dato e valore attuale del dipendente
// `options` → menu a tendina con i valori esistenti nel sistema; senza → testo libero
interface Lookups { departments: HrDepartment[]; plants: HrPlant[]; allEmployees: HrEmployee[]; }
const distinct = (vals: (string | null)[]) =>
  Array.from(new Set(vals.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));

const CHANGE_FIELD: Partial<Record<HrEventType, { label: string; current: (e: HrEmployee) => string; options?: (l: Lookups) => string[] }>> = {
  cambio_reparto:  { label: 'Reparto',       current: e => e.reparto_name ?? '', options: l => l.departments.map(d => d.name) },
  cambio_mansione: { label: 'Mansione',      current: e => e.mansione ?? '',     options: l => distinct(l.allEmployees.map(e => e.mansione)) },
  cambio_livello:  { label: 'Livello',       current: e => e.livello ?? '',      options: l => distinct(l.allEmployees.map(e => e.livello)) },
  cambio_capo:     { label: 'Responsabile',  current: e => e.capo_nome ?? '',    options: l => l.allEmployees.map(e => `${e.cognome} ${e.nome}`) },
  trasferimento:   { label: 'Stabilimento',  current: e => e.plant_name ?? '',   options: l => l.plants.map(p => p.name) },
  promozione:      { label: 'Mansione/Livello', current: e => [e.mansione, e.livello].filter(Boolean).join(' · ') },
};

function NewEventForm({ employeeId, employee, lookups, availableTypes, onDone }: { employeeId: number; employee: HrEmployee; lookups: Lookups; availableTypes: HrEventType[]; onDone: (ev: HrEmployeeEvent) => void }) {
  const [event_type, setEventType] = useState<HrEventType>(availableTypes[0]);
  const [event_date, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [end_date, setEndDate]     = useState('');
  const [from_value, setFromValue] = useState(CHANGE_FIELD[availableTypes[0]]?.current(employee) ?? '');
  const [to_value, setToValue]     = useState('');
  const [note, setNote]            = useState('');
  const [saving, setSaving]        = useState(false);
  const [error, setError]          = useState('');

  const hasDuration = ['malattia', 'maternita_paternita'].includes(event_type);
  const change = CHANGE_FIELD[event_type];

  function changeType(t: HrEventType) {
    setEventType(t);
    setFromValue(CHANGE_FIELD[t]?.current(employee) ?? '');
    setToValue('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (change && !to_value.trim()) { setError(`Indica il nuovo valore (${change.label})`); return; }
    setSaving(true); setError('');
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        event_type, event_date, end_date: hasDuration && end_date ? end_date : null, note: note || null,
        from_value: change && from_value.trim() ? from_value.trim() : null,
        to_value: change ? to_value.trim() : null,
      }),
    });
    setSaving(false);
    if (res.ok) onDone(await res.json());
    else { const b = await res.json().catch(() => ({})); setError(b.message ?? 'Errore'); }
  }

  return (
    <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tipo evento</label>
          <select className="input" value={event_type} onChange={e => changeType(e.target.value as HrEventType)}>
            {availableTypes.map(t => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Data{hasDuration ? ' inizio' : ''}</label>
          <input type="date" className="input" value={event_date} onChange={e => setEventDate(e.target.value)} />
        </div>
        {change && (
          <>
            <div>
              <label className="label">{change.label} attuale</label>
              <input className="input" value={from_value} onChange={e => setFromValue(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className="label">{change.label} nuovo *</label>
              {change.options ? (
                <select className="input" value={to_value} onChange={e => setToValue(e.target.value)}>
                  <option value="">—</option>
                  {change.options(lookups).filter(o => o !== from_value).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="input" value={to_value} onChange={e => setToValue(e.target.value)} />
              )}
            </div>
          </>
        )}
        {hasDuration && (
          <div>
            <label className="label">Data fine (se conclusa)</label>
            <input type="date" className="input" value={end_date} onChange={e => setEndDate(e.target.value)} />
          </div>
        )}
        <div className="col-span-2">
          <label className="label">Note</label>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Salvataggio…' : 'Registra evento'}</button>
      </div>
    </form>
  );
}

// ─── Proposta di generare il Word dopo la registrazione ──────────────────────

function GenerateWordDialog({ employee, offer, onClose }: {
  employee: HrEmployee; offer: { docs: HrDocument[]; eventId: number }; onClose: () => void;
}) {
  const toast = useToast();
  const [docId, setDocId] = useState(offer.docs[0].id);
  const [fields, setFields] = useState<{ key: string; label: string; value: string }[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [busy, setBusy] = useState(false);

  // Valori del cambiamento precompilati dall'evento appena registrato, correggibili prima di generare
  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    fetch(`${BACKEND}/api/hr/documents/${docId}/preview/${employee.id}?event_id=${offer.eventId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { editable: [] })
      .then(b => { if (!cancelled) { setFields(b.editable); setLoadingPreview(false); } });
    return () => { cancelled = true; };
  }, [docId, employee.id, offer.eventId]);

  async function generate() {
    setBusy(true);
    const res = await fetch(`${BACKEND}/api/hr/documents/${docId}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ employee_id: employee.id, event_id: offer.eventId, values: Object.fromEntries(fields.map(f => [f.key, f.value])) }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.message ?? b.error ?? 'Errore durante la generazione');
      return;
    }
    const blob = await res.blob();
    const m = (res.headers.get('Content-Disposition') ?? '').match(/filename\*=UTF-8''([^;]+)/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = m ? decodeURIComponent(m[1]) : 'documento.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-sm font-semibold text-gray-700">Evento registrato</p>
          <p className="text-xs text-gray-500 mt-0.5">Vuoi generare il documento Word per {employee.cognome} {employee.nome}?</p>
        </div>

        {offer.docs.length > 1 && (
          <div>
            <label className="label">Documento</label>
            <select className="input text-sm" value={docId} onChange={e => setDocId(Number(e.target.value))}>
              {offer.docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        {offer.docs.length === 1 && <p className="text-sm font-medium text-gray-800">{offer.docs[0].name}</p>}

        {loadingPreview ? <p className="text-xs text-gray-400">Caricamento…</p> : fields.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">Controlla i dati del cambiamento. I campi vuoti restano come riga ________.</p>
            {fields.map((f, i) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input className="input text-sm" value={f.value}
                  onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">No, grazie</button>
          <button type="button" onClick={generate} disabled={busy || loadingPreview} className="btn-primary text-sm">
            {busy ? 'Generazione…' : 'Genera e scarica .docx'}
          </button>
        </div>
      </div>
    </div>
  );
}
