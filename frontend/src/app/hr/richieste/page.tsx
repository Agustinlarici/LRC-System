'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProponiModificaModal } from '../dipendenti/[id]/ProponiModificaModal';
import type { HrEmployee, HrDepartment } from '@/types';

type Tipo = 'ferie' | 'permesso' | 'malattia' | 'infortunio';

interface HrRequest {
  id: number;
  employee_name: string;
  tipo: Tipo;
  data_inizio: string;
  data_fine: string;
  motivo: string | null;
  stato: 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';
  requested_by_name: string;
  requested_by_user_id: number;
  decision_note: string | null;
}

interface ChangeItem {
  id: number;
  campo: string;
  label_attuale: string | null;
  label_proposto: string | null;
  stato: 'in_attesa' | 'approvato' | 'rifiutato';
  stale: boolean;
}

interface ChangeRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  motivo: string | null;
  stato: 'in_attesa' | 'decisa' | 'annullata';
  requested_by_name: string;
  requested_by_user_id: number;
  decision_note: string | null;
  items: ChangeItem[];
}

const STATO: Record<HrRequest['stato'], { label: string; tone: Tone }> = {
  in_attesa: { label: 'In attesa', tone: 'warning' },
  approvata: { label: 'Approvata', tone: 'success' },
  rifiutata: { label: 'Rifiutata', tone: 'danger' },
  annullata: { label: 'Annullata', tone: 'neutral' },
};

const ITEM_STATO: Record<ChangeItem['stato'], { label: string; tone: Tone }> = {
  in_attesa: { label: 'In attesa', tone: 'warning' },
  approvato: { label: 'Approvato', tone: 'success' },
  rifiutato: { label: 'Rifiutato', tone: 'danger' },
};

const TIPO_LABEL: Record<Tipo, string> = { ferie: 'Ferie', permesso: 'Permesso', malattia: 'Malattia', infortunio: 'Infortunio' };

const CAMPO_LABEL: Record<string, string> = {
  mansione: 'Mansione', qualifica: 'Qualifica', reparto_id: 'Reparto', gruppo_orario: 'Gruppo orario',
  telefono: 'Telefono', email: 'Email', indirizzo: 'Indirizzo', citta: 'Città', provincia: 'Provincia', cap: 'CAP',
  taglia_pantaloni: 'Taglia pantaloni', taglia_maglia: 'Taglia maglia', taglia_scarpe: 'Taglia scarpe', taglia_campera: 'Taglia giubbotto', note: 'Note',
};

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type TabKey = 'ferie' | 'modifiche';

export default function RichiestePage() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'admin' || !!user?.permissions.some(p => p.module_key === 'hr' && p.can_manage);

  const [tab, setTab] = useState<TabKey>('ferie');
  const [requests, setRequests] = useState<HrRequest[] | null>(null);
  const [changes, setChanges] = useState<ChangeRequest[] | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id: '', tipo: 'ferie', data_inizio: '', data_fine: '', motivo: '' });
  // Per ogni campo proposto: true = approva (default), false = rifiuta
  const [decisions, setDecisions] = useState<Record<number, boolean>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  // Nuova proposta di modifica scheda: prima si sceglie la persona, poi si apre il modulo
  const [showPick, setShowPick] = useState(false);
  const [pickId, setPickId] = useState('');
  const [proposeFor, setProposeFor] = useState<{ employee: HrEmployee; departments: HrDepartment[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, c, p] = await Promise.all([
        api.get<HrRequest[]>('/api/hr/requests'),
        api.get<ChangeRequest[]>('/api/hr/change-requests'),
        api.get<{ id: number; name: string }[]>('/api/hr/requests/employees'),
      ]);
      setRequests(r);
      setChanges(c);
      setPeople(p);
      // Aggiorna il contatore rosso nella sidebar di HR
      window.dispatchEvent(new Event('hr-requests-changed'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di caricamento');
      setRequests([]);
      setChanges([]);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const pendingRequests = requests?.filter(r => r.stato === 'in_attesa').length ?? 0;
  const pendingChanges = changes?.filter(c => c.stato === 'in_attesa').length ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/hr/requests', {
        employee_id: Number(form.employee_id),
        tipo: form.tipo,
        data_inizio: form.data_inizio,
        data_fine: form.data_fine || form.data_inizio,
        motivo: form.motivo.trim() || null,
      });
      setShowForm(false);
      setForm({ employee_id: '', tipo: 'ferie', data_inizio: '', data_fine: '', motivo: '' });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function startPropose(e: React.FormEvent) {
    e.preventDefault();
    try {
      const [employee, departments] = await Promise.all([
        api.get<HrEmployee>(`/api/hr/employees/${pickId}`),
        api.get<HrDepartment[]>('/api/hr/departments'),
      ]);
      setProposeFor({ employee, departments });
      setShowPick(false);
      setPickId('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function act(id: number, action: 'approvata' | 'rifiutata' | 'cancel') {
    try {
      if (action === 'cancel') {
        await api.post(`/api/hr/requests/${id}/cancel`);
      } else {
        const note = action === 'rifiutata' ? window.prompt('Motivo del rifiuto (facoltativo)') : null;
        if (action === 'rifiutata' && note === null) return;
        await api.post(`/api/hr/requests/${id}/decide`, { stato: action, decision_note: note || null });
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function decideChange(req: ChangeRequest) {
    try {
      await api.post(`/api/hr/change-requests/${req.id}/decide`, {
        items: req.items.map(i => ({ id: i.id, approva: decisions[i.id] ?? true })),
        decision_note: notes[req.id]?.trim() || null,
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function cancelChange(id: number) {
    try {
      await api.post(`/api/hr/change-requests/${id}/cancel`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    }
  }

  return (
    <div>
      <PageHeader
        back={{ label: 'Risorse Umane', href: '/hr' }}
        title="Richieste"
        description={canManage ? 'Ferie, permessi, malattie e modifiche scheda da approvare' : 'Richieste tue e del tuo team: le approva HR'}
        actions={<button type="button" className="btn-primary"
          onClick={() => (tab === 'ferie' ? setShowForm(v => !v) : setShowPick(v => !v))}>Nuova richiesta</button>}
      />

      <Tabs
        tabs={['ferie', 'modifiche'] as const}
        value={tab}
        onChange={setTab}
        labels={{ ferie: 'Ferie e assenze', modifiche: 'Modifiche scheda' }}
        badges={{ ferie: pendingRequests, modifiche: pendingChanges }}
      />

      {tab === 'ferie' && (
        <>
          {showForm && (
            <form onSubmit={submit} className="card mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Per</label>
                <select className="input" required value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">—</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                  {(Object.keys(TIPO_LABEL) as Tipo[]).map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Dal</label>
                <input type="date" className="input" required value={form.data_inizio} onChange={e => setForm({ ...form, data_inizio: e.target.value })} />
              </div>
              <div>
                <label className="label">Al (vuoto = un solo giorno)</label>
                <input type="date" className="input" min={form.data_inizio} value={form.data_fine} onChange={e => setForm({ ...form, data_fine: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Motivo (facoltativo)</label>
                <input className="input" maxLength={1000} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annulla</button>
                <button type="submit" className="btn-primary">Invia a HR</button>
              </div>
            </form>
          )}

          {requests === null ? <SkeletonTable rows={5} cols={5} /> : requests.length === 0 ? (
            <EmptyState title="Nessuna richiesta" />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="px-3 py-2">Persona</th><th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Periodo</th><th className="px-3 py-2">Richiesta da</th>
                    <th className="px-3 py-2">Stato</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium text-ink-800">{r.employee_name}</td>
                      <td className="px-3 py-2">{TIPO_LABEL[r.tipo]}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDate(r.data_inizio)}{r.data_fine !== r.data_inizio && ` → ${fmtDate(r.data_fine)}`}
                        {r.motivo && <div className="text-xs text-muted">{r.motivo}</div>}
                      </td>
                      <td className="px-3 py-2">{r.requested_by_name}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={STATO[r.stato].tone}>{STATO[r.stato].label}</StatusBadge>
                        {r.decision_note && <div className="text-xs text-muted mt-1">{r.decision_note}</div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.stato === 'in_attesa' && (
                          <div className="flex justify-end gap-2">
                            {canManage && <button type="button" className="btn-primary" onClick={() => act(r.id, 'approvata')}>Approva</button>}
                            {canManage && <button type="button" className="btn-danger" onClick={() => act(r.id, 'rifiutata')}>Rifiuta</button>}
                            {(canManage || r.requested_by_user_id === user?.id) && (
                              <button type="button" className="btn-secondary" onClick={() => act(r.id, 'cancel')}>Annulla</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'modifiche' && showPick && (
        <form onSubmit={startPropose} className="card mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="label">Per chi vuoi proporre una modifica?</label>
            <select className="input" required value={pickId} onChange={e => setPickId(e.target.value)}>
              <option value="">—</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setShowPick(false)}>Annulla</button>
          <button type="submit" className="btn-primary">Continua</button>
        </form>
      )}

      {proposeFor && (
        <ProponiModificaModal
          employee={proposeFor.employee}
          departments={proposeFor.departments}
          onClose={() => setProposeFor(null)}
          onSent={() => { setProposeFor(null); toast.success('Proposta inviata a HR'); load(); }}
        />
      )}

      {tab === 'modifiche' && (
        changes === null ? <SkeletonTable rows={4} cols={4} /> : changes.length === 0 ? (
          <EmptyState title="Nessuna proposta di modifica" hint="Il capo propone dalla scheda del dipendente: Proponi modifica." />
        ) : (
          <div className="space-y-4">
            {changes.map(req => {
              const pending = req.stato === 'in_attesa';
              return (
                <div key={req.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-medium text-ink-900">{req.employee_name}</p>
                      <p className="text-xs text-muted">Proposta di {req.requested_by_name}{req.motivo && ` · ${req.motivo}`}</p>
                    </div>
                    {req.stato === 'in_attesa' && <StatusBadge tone="warning">In attesa</StatusBadge>}
                    {req.stato === 'decisa' && <StatusBadge tone="info">Decisa</StatusBadge>}
                    {req.stato === 'annullata' && <StatusBadge tone="neutral">Annullata</StatusBadge>}
                  </div>

                  <ul className="divide-y divide-line">
                    {req.items.map(i => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <span className="text-muted">{CAMPO_LABEL[i.campo] ?? i.campo}: </span>
                          <span className="text-ink-800">{i.label_attuale ?? '—'}</span>
                          <span aria-hidden className="mx-1.5 text-muted">→</span>
                          <span className="font-medium text-ink-900">{i.label_proposto ?? '—'}</span>
                          {pending && i.stale && (
                            <div className="text-xs text-warning">Il valore in scheda è cambiato dopo la proposta</div>
                          )}
                        </div>
                        {pending && canManage ? (
                          <label className="flex items-center gap-2 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={decisions[i.id] ?? true}
                              onChange={e => setDecisions({ ...decisions, [i.id]: e.target.checked })}
                            />
                            Approva
                          </label>
                        ) : (
                          !pending && req.stato === 'decisa' && <StatusBadge tone={ITEM_STATO[i.stato].tone}>{ITEM_STATO[i.stato].label}</StatusBadge>
                        )}
                      </li>
                    ))}
                  </ul>

                  {req.decision_note && <p className="text-xs text-muted mt-2">{req.decision_note}</p>}

                  {pending && (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {canManage && (
                        <>
                          <input
                            className="input max-w-xs"
                            placeholder="Nota (facoltativa)"
                            value={notes[req.id] ?? ''}
                            onChange={e => setNotes({ ...notes, [req.id]: e.target.value })}
                          />
                          <button type="button" className="btn-primary" onClick={() => decideChange(req)}>Conferma decisione</button>
                        </>
                      )}
                      {(canManage || req.requested_by_user_id === user?.id) && (
                        <button type="button" className="btn-secondary" onClick={() => cancelChange(req.id)}>Annulla</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
