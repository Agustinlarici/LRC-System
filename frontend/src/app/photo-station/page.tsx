'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Job = {
  id: number; commessa: string; source: string; status: string; attempts: number;
  capture_status: string | null; capture_errors: { camera: string; error: string }[]; error: string | null;
  created_by: string | null; created_at: string; finished_at: string | null; station_name: string | null; photos: number;
};
type FileRow = { id: number; camera: string; bytes: number };
type Station = { id: number; name: string; last_seen_at: string | null; revoked_at: string | null; online: boolean };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending:   { label: 'In coda',     tone: 'neutral' },
  claimed:   { label: 'In corso',    tone: 'info' },
  captured:  { label: 'Foto pronte', tone: 'success' },
  analyzing: { label: 'In analisi',  tone: 'info' },
  done:      { label: 'Completato',  tone: 'success' },
  failed:    { label: 'Fallito',     tone: 'danger' },
  cancelled: { label: 'Annullato',   tone: 'neutral' },
};

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:${window.location.protocol === 'https:' ? 3444 : 3001}`
  : '';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export default function PhotoStationPage() {
  const { canManage } = useAuth();
  const manage = canManage('photo_station');
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [commessa, setCommessa] = useState('');
  const [stationName, setStationName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [open, setOpen] = useState<{ job: Job; files: FileRow[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [j, s] = await Promise.all([
        api.get<{ jobs: Job[] }>('/api/photo-station/jobs?limit=50'),
        api.get<{ stations: Station[] }>('/api/photo-station/stations'),
      ]);
      setJobs(j.jobs); setStations(s.stations);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Errore di caricamento'); }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);   // l'elenco si aggiorna da solo mentre la stazione lavora
    return () => clearInterval(t);
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Errore'); }
    finally { setBusy(false); }
  }

  const createJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commessa.trim()) return;
    act(async () => { await api.post('/api/photo-station/jobs', { commessa }); setCommessa(''); }, 'Ordine creato');
  };
  const createStation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationName.trim()) return;
    act(async () => {
      const r = await api.post<{ token: string }>('/api/photo-station/stations', { name: stationName });
      setNewToken(r.token); setStationName('');
    });
  };
  const show = (job: Job) => act(async () => {
    const r = await api.get<{ job: Job; files: FileRow[] }>(`/api/photo-station/jobs/${job.id}`);
    setOpen(r);
  });

  return (
    <div>
      <PageHeader
        title="Photo Station"
        description="Ordini di foto per la PC Camere. Ora si creano a mano; la chiamata iKnow userà la stessa coda."
        badge={stations.some(s => s.online) ? <StatusBadge tone="success">Stazione collegata</StatusBadge> : <StatusBadge tone="warning">Nessuna stazione collegata</StatusBadge>}
      />

      {manage && (
        <form onSubmit={createJob} className="card mb-6 flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="commessa">Commessa</label>
            <input id="commessa" className="input w-full" value={commessa} maxLength={64} autoComplete="off"
                   onChange={e => setCommessa(e.target.value)} placeholder="es. 123456" />
          </div>
          <Button variant="primary" type="submit" disabled={busy || !commessa.trim()}>Scatta foto</Button>
        </form>
      )}

      <div className="card mb-6 overflow-x-auto">
        {jobs === null ? <SkeletonTable rows={5} cols={6} /> : jobs.length === 0 ? (
          <EmptyState title="Nessun ordine" hint="Inserisci una commessa: la PC Camere la prende e scatta le foto." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="px-4 py-3">#</th><th className="px-4 py-3">Commessa</th><th className="px-4 py-3">Stato</th>
              <th className="px-4 py-3">Foto</th><th className="px-4 py-3">Stazione</th><th className="px-4 py-3">Creato</th><th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {jobs.map(j => {
                const st = STATUS[j.status] ?? { label: j.status, tone: 'neutral' as Tone };
                return (
                  <tr key={j.id} className="border-t border-line align-top">
                    <td className="px-4 py-3 tabular-nums text-muted">{j.id}</td>
                    <td className="px-4 py-3 font-medium text-ink-900">{j.commessa}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={j.capture_status === 'partial' && j.status === 'captured' ? 'warning' : st.tone}>
                        {j.capture_status === 'partial' && j.status === 'captured' ? 'Parziale' : st.label}
                      </StatusBadge>
                      {(j.error || j.capture_errors.length > 0) && (
                        <div className="mt-1 max-w-xs text-xs text-danger">
                          {j.error ?? j.capture_errors.map(e => `${e.camera}: ${e.error}`).join('; ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{j.photos}</td>
                    <td className="px-4 py-3 text-muted">{j.station_name ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{fmt(j.created_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {j.photos > 0 && <Button variant="ghost" onClick={() => show(j)}>Vedi foto</Button>}
                      {manage && (j.status === 'pending' || j.status === 'claimed') &&
                        <Button variant="ghost" disabled={busy} onClick={() => act(() => api.post(`/api/photo-station/jobs/${j.id}/cancel`))}>Annulla</Button>}
                      {manage && (j.status === 'failed' || j.status === 'cancelled') &&
                        <Button variant="ghost" disabled={busy} onClick={() => act(() => api.post(`/api/photo-station/jobs/${j.id}/retry`), 'Ordine rimesso in coda')}>Riprova</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mb-3 text-lg font-semibold text-ink-900">Stazioni</h2>
      <div className="card p-5">
        {newToken && (
          <div className="mb-4 rounded-ctl bg-warning-soft p-4 text-sm">
            <p className="font-medium text-warning">Copia il token adesso: non si potrà rivedere.</p>
            <code className="mt-2 block break-all rounded-ctl bg-white p-2 text-xs text-ink-900">{newToken}</code>
            <p className="mt-2 text-muted">Va in <code>vm_token</code> nelle impostazioni di Photo Station.</p>
            <Button className="mt-2" onClick={() => setNewToken(null)}>Fatto</Button>
          </div>
        )}
        <ul className="divide-y divide-line">
          {stations.map(s => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-medium text-ink-900">{s.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted">ultimo contatto {fmt(s.last_seen_at)}</span>
                {s.revoked_at ? <StatusBadge tone="neutral">Revocata</StatusBadge>
                  : <StatusBadge tone={s.online ? 'success' : 'warning'}>{s.online ? 'Online' : 'Offline'}</StatusBadge>}
                {manage && !s.revoked_at &&
                  <Button variant="ghost" disabled={busy} onClick={() => { if (confirm(`Revocare la stazione "${s.name}"? Smette di funzionare subito.`)) act(() => api.post(`/api/photo-station/stations/${s.id}/revoke`)); }}>Revoca</Button>}
              </span>
            </li>
          ))}
          {stations.length === 0 && <li className="py-2 text-sm text-muted">Nessuna stazione. Creane una per ottenere il token.</li>}
        </ul>
        {manage && (
          <form onSubmit={createStation} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem]">
              <label className="label" htmlFor="stname">Nuova stazione</label>
              <input id="stname" className="input w-full" value={stationName} maxLength={60} onChange={e => setStationName(e.target.value)} placeholder="es. PC Camere" />
            </div>
            <Button type="submit" disabled={busy || !stationName.trim()}>Crea e mostra token</Button>
          </form>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-full w-full max-w-4xl overflow-auto rounded-card bg-white p-5 shadow-float" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink-900">Commessa {open.job.commessa}</h3>
              <Button variant="ghost" onClick={() => setOpen(null)}>Chiudi</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {open.files.map(f => (
                <figure key={f.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${BACKEND}/api/photo-station/jobs/${open.job.id}/files/${f.id}`} alt={f.camera} className="w-full rounded-ctl bg-stone-100" />
                  <figcaption className="mt-1 text-xs text-muted">{f.camera} · {(f.bytes / 1e6).toFixed(1)} MB</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
