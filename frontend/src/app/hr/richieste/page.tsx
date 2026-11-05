'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface HrRequest {
  id: number;
  employee_name: string;
  tipo: 'ferie' | 'permesso';
  data_inizio: string;
  data_fine: string;
  motivo: string | null;
  stato: 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';
  requested_by_name: string;
  requested_by_user_id: number;
  decided_by_name: string | null;
  decision_note: string | null;
}

const STATO: Record<HrRequest['stato'], { label: string; tone: Tone }> = {
  in_attesa: { label: 'In attesa', tone: 'warning' },
  approvata: { label: 'Approvata', tone: 'success' },
  rifiutata: { label: 'Rifiutata', tone: 'danger' },
  annullata: { label: 'Annullata', tone: 'neutral' },
};

function fmtDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function RichiestePage() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'admin' || !!user?.permissions.some(p => p.module_key === 'hr' && p.can_manage);

  const [requests, setRequests] = useState<HrRequest[] | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id: '', tipo: 'ferie', data_inizio: '', data_fine: '', motivo: '' });

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        api.get<HrRequest[]>('/api/hr/requests'),
        api.get<{ id: number; name: string }[]>('/api/hr/requests/employees'),
      ]);
      setRequests(r);
      setPeople(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore di caricamento');
      setRequests([]);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      <PageHeader
        back={{ label: 'Risorse Umane', href: '/hr' }}
        title="Richieste"
        description={canManage ? 'Ferie e permessi da approvare' : 'Ferie e permessi tuoi e del tuo team: li approva HR'}
        actions={<button type="button" className="btn-primary" onClick={() => setShowForm(v => !v)}>Nuova richiesta</button>}
      />

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
              <option value="ferie">Ferie</option>
              <option value="permesso">Permesso</option>
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
                  <td className="px-3 py-2 capitalize">{r.tipo}</td>
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
    </div>
  );
}
