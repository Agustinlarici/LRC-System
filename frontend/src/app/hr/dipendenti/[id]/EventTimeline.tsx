'use client';

import { useEffect, useState, useCallback } from 'react';
import type { HrEmployeeEvent, HrEventType } from '@/types';

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

const EVENT_ICON: Record<HrEventType, string> = {
  assunzione: '🎉', cambio_reparto: '🔀', cambio_mansione: '🔀', cambio_livello: '📈',
  cambio_capo: '👤', trasferimento: '📍', promozione: '⭐', cessazione: '🚪',
  malattia: '🤒', maternita_paternita: '👶', infortunio: '🩹', congedo: '🌴', rientro: '↩️', altro: '📌',
};

// Eventi che un capo (senza gestione HR completa) può registrare per il proprio team
const CAPO_ALLOWED: HrEventType[] = ['malattia', 'maternita_paternita', 'infortunio', 'congedo', 'rientro', 'trasferimento', 'altro'];
const ALL_EVENTS = Object.keys(EVENT_LABEL) as HrEventType[];

function fmtDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props { employeeId: number; canManage: boolean; canManageLimited: boolean; }

export function EventTimeline({ employeeId, canManage, canManageLimited }: Props) {
  const [events, setEvents] = useState<HrEmployeeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/events`, { credentials: 'include' });
    if (res.ok) setEvents(await res.json());
    setLoading(false);
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const availableTypes = canManage ? ALL_EVENTS : CAPO_ALLOWED;

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
          availableTypes={availableTypes}
          onDone={() => { setShowForm(false); load(); }}
        />
      )}

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
                <span>{EVENT_ICON[ev.event_type]}</span>
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

function NewEventForm({ employeeId, availableTypes, onDone }: { employeeId: number; availableTypes: HrEventType[]; onDone: () => void }) {
  const [event_type, setEventType] = useState<HrEventType>(availableTypes[0]);
  const [event_date, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [end_date, setEndDate]     = useState('');
  const [note, setNote]            = useState('');
  const [saving, setSaving]        = useState(false);
  const [error, setError]          = useState('');

  const hasDuration = ['malattia', 'maternita_paternita', 'infortunio', 'congedo'].includes(event_type);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ event_type, event_date, end_date: hasDuration && end_date ? end_date : null, note: note || null }),
    });
    setSaving(false);
    if (res.ok) onDone();
    else { const b = await res.json().catch(() => ({})); setError(b.message ?? 'Errore'); }
  }

  return (
    <form onSubmit={submit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tipo evento</label>
          <select className="input" value={event_type} onChange={e => setEventType(e.target.value as HrEventType)}>
            {availableTypes.map(t => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Data{hasDuration ? ' inizio' : ''}</label>
          <input type="date" className="input" value={event_date} onChange={e => setEventDate(e.target.value)} />
        </div>
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
