'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface Accessi {
  kpi:   { logins: number; utenti: number; falliti: number; logins_dispositivi: number; utenti_attivi: number };
  daily: { day: string; ok: number; dev: number; ko: number }[];
  dispositivi: {
    id: number; label: string; utente: string; created_at: string; last_used_at: string | null;
    revoked_at: string | null; logins: number; pagine: number; ultimo_segnale: string | null;
  }[];
  utenti: {
    id: number; username: string; display_name: string; role: string;
    ultimo_login: string | null; logins: number; pagine: number; ultimo_segnale: string | null;
  }[];
}
interface Moduli {
  totale: { pagine: number; da: string | null };
  moduli: { module: string; pagine: number; utenti: number; ultimo: string }[];
  pagine: { module: string; path: string; visite: number; utenti: number; dispositivi: number; ultimo: string }[];
  heat:   { dow: number; hour: number; n: number }[];
  utenti: { nome: string; module: string; pagine: number }[];
}
interface Online {
  online: { username: string; display_name: string; role: string; device_label: string | null; last_path: string; last_seen: string; module: string }[];
}
interface Sicurezza {
  fallitiIp:     { ip: string; tentativi: number; utenti: number; ultimo: string }[];
  fallitiUtente: { username: string; tentativi: number; ultimo: string }[];
  eventi:        { created_at: string; username: string | null; action: string; ip: string | null; details: Record<string, unknown> | null }[];
}

const TABS = ['accessi', 'moduli', 'online', 'sicurezza'] as const;
type Tab = typeof TABS[number];
const TAB_LABELS: Record<Tab, string> = {
  accessi: 'Accessi', moduli: 'Uso dei moduli', online: 'Online ora', sicurezza: 'Sicurezza',
};
const PERIODS = [7, 30, 90, 180];

// Colori dei grafici: stessi valori dei token (recharts non legge le classi Tailwind)
const C_OK   = '#2B5BA8'; // accent-ink
const C_DEV  = '#8A8A91'; // dispositivi (grigio neutro)
const C_KO   = '#B42318'; // danger
const C_GRID = '#E7E5E4'; // line
const C_AXIS = '#636369'; // muted

const ACTION_LABEL: Record<string, string> = {
  user_created: 'Utente creato', user_updated: 'Utente modificato', password_changed: 'Password cambiata',
  change_password_failed: 'Cambio password fallito', device_pair_code_generated: 'Codice dispositivo generato',
  device_pair_redeem_failed: 'Accoppiamento dispositivo fallito',
};
const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  return `${Math.floor(min / 60)} h fa`;
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-3 text-sm font-semibold text-ink-900">{title}</h2>
      {children}
    </section>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
function Td({ children, right, muted }: { children?: React.ReactNode; right?: boolean; muted?: boolean }) {
  return <td className={`px-3 py-2 text-sm ${right ? 'text-right tabular-nums' : ''} ${muted ? 'text-muted' : 'text-ink-900'}`}>{children}</td>;
}

// Dati caricati per tab: ricaricati al cambio di scheda o periodo
function useTabData<T>(path: string, days: number | null, escludi: boolean) {
  const [data, setData]   = useState<T | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    const q = new URLSearchParams();
    if (days != null) q.set('days', String(days));
    if (escludi) q.set('escludi_me', '1');
    const qs = q.toString();
    api.get<T>(qs ? `${path}?${qs}` : path)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Errore'));
  }, [path, days, escludi]);

  useEffect(() => { setData(null); load(); }, [load]);
  return { data, error, reload: load };
}

// ─── Accessi ──────────────────────────────────────────────────────────────────

function AccessiTab({ days, escludi }: { days: number; escludi: boolean }) {
  const { data, error } = useTabData<Accessi>('/api/activity/accessi', days, escludi);
  if (error) return <EmptyState title="Impossibile caricare i dati" hint={error} />;
  if (!data) return <SkeletonTable rows={6} cols={5} />;

  const mai = data.utenti.filter(u => !u.ultimo_login).length;
  const chart = data.daily.map(d => ({ ...d, label: d.day.slice(5).replace('-', '/') }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Accessi" value={data.kpi.logins} hint={`ultimi ${days} giorni`} />
        <Kpi label="Accessi dispositivi" value={data.kpi.logins_dispositivi} hint="kiosk e tablet senza password" />
        <Kpi label="Utenti diversi" value={data.kpi.utenti} hint={`su ${data.kpi.utenti_attivi} attivi`} />
        <Kpi label="Tentativi falliti" value={data.kpi.falliti} />
        <Kpi label="Mai entrati" value={mai} hint="utenti attivi senza alcun accesso" />
      </div>

      <Panel title="Accessi per giorno">
        <div className="h-64" role="img" aria-label="Accessi riusciti e falliti per giorno">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={C_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C_GRID }}
                     interval={Math.max(0, Math.ceil(chart.length / 12) - 1)} />
              <YAxis allowDecimals={false} tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(20,20,22,0.04)' }} contentStyle={{ borderRadius: 12, border: '1px solid #E7E5E4', fontSize: 12 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ok"  name="Riusciti"    stackId="a" fill={C_OK}  radius={[0, 0, 0, 0]} />
              <Bar dataKey="dev" name="Dispositivi" stackId="a" fill={C_DEV} radius={[0, 0, 0, 0]} />
              <Bar dataKey="ko" name="Falliti"  stackId="a" fill={C_KO} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Dispositivi (accesso senza password)">
        {data.dispositivi.length === 0 ? <p className="text-sm text-muted">Nessun dispositivo accoppiato.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr><Th>Dispositivo</Th><Th>Utente</Th><Th>Ultimo segnale</Th><Th right>Accessi</Th><Th right>Pagine viste</Th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.dispositivi.map(d => (
                  <tr key={d.id} className={d.revoked_at ? 'opacity-50' : undefined}>
                    <Td>{d.label}{d.revoked_at && <span className="ml-2 text-xs text-muted">(revocato)</span>}</Td>
                    <Td muted>{d.utente}</Td>
                    <Td muted>{fmtDateTime(d.ultimo_segnale ?? d.last_used_at)}</Td>
                    <Td right>{d.logins}</Td>
                    <Td right>{d.pagine}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Utenti">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr><Th>Utente</Th><Th>Ruolo</Th><Th>Ultimo accesso</Th><Th right>Accessi</Th><Th right>Pagine viste</Th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.utenti.map(u => (
                <tr key={u.id}>
                  <Td>{u.display_name} <span className="text-muted">({u.username})</span></Td>
                  <Td muted>{u.role}</Td>
                  <Td muted>{u.ultimo_login ? fmtDateTime(u.ultimo_login) : 'mai'}</Td>
                  <Td right>{u.logins}</Td>
                  <Td right>{u.pagine}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ─── Uso dei moduli ───────────────────────────────────────────────────────────

function HeatMap({ heat }: { heat: Moduli['heat'] }) {
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    for (const r of heat) { g[r.dow - 1][r.hour] = r.n; m = Math.max(m, r.n); }
    return { grid: g, max: m };
  }, [heat]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="ml-10 mb-1 grid grid-cols-24 gap-0.5 text-[10px] text-muted" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ''}</span>)}
        </div>
        {grid.map((row, d) => (
          <div key={d} className="mb-0.5 flex items-center gap-1">
            <span className="w-9 text-xs text-muted">{DOW[d]}</span>
            <div className="grid flex-1 gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
              {row.map((n, h) => (
                <div
                  key={h}
                  title={`${DOW[d]} ${String(h).padStart(2, '0')}:00 — ${n} pagine`}
                  className="h-6 rounded-[4px] bg-stone-100"
                  style={n ? { backgroundColor: C_OK, opacity: 0.15 + 0.85 * (n / max) } : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModuliTab({ days, escludi }: { days: number; escludi: boolean }) {
  const { data, error } = useTabData<Moduli>('/api/activity/moduli', days, escludi);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <EmptyState title="Impossibile caricare i dati" hint={error} />;
  if (!data) return <SkeletonTable rows={6} cols={4} />;
  if (data.totale.pagine === 0) {
    return <EmptyState title="Ancora nessuna visita registrata" hint="Il conteggio parte dal primo accesso dopo l'aggiornamento: tra qualche ora compaiono i primi dati." />;
  }

  const topUtenti = open ? data.utenti.filter(u => u.module === open).slice(0, 10) : [];
  const pagineModulo = open ? data.pagine.filter(p => p.module === open).slice(0, 30) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Pagine viste" value={data.totale.pagine} hint={`ultimi ${days} giorni`} />
        <Kpi label="Moduli usati" value={data.moduli.length} />
        <Kpi label="Più usato" value={data.moduli[0].module} />
        <Kpi label="Dati dal" value={data.totale.da ? new Date(data.totale.da).toLocaleDateString('it-IT') : '—'} />
      </div>

      <Panel title="Pagine viste per modulo">
        <div style={{ height: Math.max(180, data.moduli.length * 34) }} role="img" aria-label="Pagine viste per modulo">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.moduli} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={C_GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: C_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="module" width={170} tick={{ fill: C_AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(20,20,22,0.04)' }} contentStyle={{ borderRadius: 12, border: '1px solid #E7E5E4', fontSize: 12 }} />
              <Bar dataKey="pagine" name="Pagine viste" fill={C_OK} radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Quando si usa il sistema (pagine viste per giorno e ora)">
        <HeatMap heat={data.heat} />
      </Panel>

      <Panel title="Dettaglio per modulo (clicca un modulo per vedere le pagine)">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr><Th>Modulo</Th><Th right>Pagine</Th><Th right>Utenti</Th><Th>Ultimo uso</Th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.moduli.map(m => (
                <tr key={m.module} onClick={() => setOpen(open === m.module ? null : m.module)} className="cursor-pointer hover:bg-stone-50">
                  <Td>{m.module}</Td><Td right>{m.pagine}</Td><Td right>{m.utenti}</Td><Td muted>{fmtDateTime(m.ultimo)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {open && (
          <div className="mt-4 space-y-4 rounded-ctl bg-stone-50 p-3">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Pagine di «{open}»</p>
              <table className="w-full">
                <thead className="border-b border-line"><tr><Th>Pagina</Th><Th right>Visite</Th><Th right>Utenti</Th><Th right>Dispositivi</Th><Th>Ultima</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {pagineModulo.map(p => (
                    <tr key={p.path}><Td>{p.path}</Td><Td right>{p.visite}</Td><Td right>{p.utenti}</Td><Td right>{p.dispositivi}</Td><Td muted>{fmtDateTime(p.ultimo)}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Chi usa «{open}»</p>
            <ul className="space-y-1 text-sm">
              {topUtenti.map(u => (
                <li key={u.nome} className="flex justify-between"><span>{u.nome}</span><span className="tabular-nums text-muted">{u.pagine}</span></li>
              ))}
            </ul>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Online ora ───────────────────────────────────────────────────────────────

function OnlineTab({ escludi }: { escludi: boolean }) {
  const { data, error, reload } = useTabData<Online>('/api/activity/online', null, escludi);
  useEffect(() => { const id = setInterval(reload, 30_000); return () => clearInterval(id); }, [reload]);

  if (error) return <EmptyState title="Impossibile caricare i dati" hint={error} />;
  if (!data) return <SkeletonTable rows={4} cols={4} />;
  if (data.online.length === 0) return <EmptyState title="Nessuno online" hint="Conta chi ha mandato un segnale negli ultimi 5 minuti." />;

  return (
    <Panel title={`${data.online.length} utenti connessi (ultimi 5 minuti, aggiornato ogni 30 s)`}>
      <table className="w-full">
        <thead className="border-b border-line"><tr><Th>Utente</Th><Th>Modulo</Th><Th>Pagina</Th><Th>Ultimo segnale</Th></tr></thead>
        <tbody className="divide-y divide-line">
          {data.online.map(o => (
            <tr key={`${o.username}-${o.device_label ?? ''}`}>
              <Td><span className="mr-2 inline-block h-2 w-2 rounded-full bg-success align-middle" aria-hidden />{o.device_label ? `${o.device_label} (dispositivo)` : o.display_name}</Td>
              <Td>{o.module}</Td><Td muted>{o.last_path}</Td><Td muted>{ago(o.last_seen)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── Sicurezza ────────────────────────────────────────────────────────────────

function SicurezzaTab({ days, escludi }: { days: number; escludi: boolean }) {
  const { data, error } = useTabData<Sicurezza>('/api/activity/sicurezza', days, escludi);
  if (error) return <EmptyState title="Impossibile caricare i dati" hint={error} />;
  if (!data) return <SkeletonTable rows={6} cols={4} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Accessi falliti per indirizzo IP">
          {data.fallitiIp.length === 0 ? <p className="text-sm text-muted">Nessun tentativo fallito.</p> : (
            <table className="w-full">
              <thead className="border-b border-line"><tr><Th>IP</Th><Th right>Tentativi</Th><Th right>Utenti</Th><Th>Ultimo</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.fallitiIp.map(r => (
                  <tr key={r.ip}><Td>{r.ip}</Td><Td right>{r.tentativi}</Td><Td right>{r.utenti}</Td><Td muted>{fmtDateTime(r.ultimo)}</Td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Accessi falliti per utente">
          {data.fallitiUtente.length === 0 ? <p className="text-sm text-muted">Nessun tentativo fallito.</p> : (
            <table className="w-full">
              <thead className="border-b border-line"><tr><Th>Utente</Th><Th right>Tentativi</Th><Th>Ultimo</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.fallitiUtente.map(r => (
                  <tr key={r.username}><Td>{r.username}</Td><Td right>{r.tentativi}</Td><Td muted>{fmtDateTime(r.ultimo)}</Td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="Eventi sugli account">
        {data.eventi.length === 0 ? <p className="text-sm text-muted">Nessun evento nel periodo.</p> : (
          <table className="w-full">
            <thead className="border-b border-line"><tr><Th>Quando</Th><Th>Chi</Th><Th>Evento</Th><Th>IP</Th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.eventi.map((e, i) => (
                <tr key={i}>
                  <Td muted>{fmtDateTime(e.created_at)}</Td><Td>{e.username ?? '—'}</Td>
                  <Td>{ACTION_LABEL[e.action] ?? e.action}</Td><Td muted>{e.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

// ─── Pagina ───────────────────────────────────────────────────────────────────

export default function AttivitaPage() {
  const { user } = useAuth();
  const [tab, setTab]   = useState<Tab>('accessi');
  const [days, setDays] = useState(30);
  // «Non contare i miei dati»: esclude visite e accessi dell'utente che guarda il pannello (chi sviluppa)
  const [escludi, setEscludi] = useState(true);
  useEffect(() => { try { setEscludi(localStorage.getItem('attivita_escludi_me') !== '0'); } catch {} }, []);
  const toggleEscludi = () => {
    setEscludi(v => { try { localStorage.setItem('attivita_escludi_me', v ? '0' : '1'); } catch {} return !v; });
  };

  if (user?.role !== 'admin') {
    return <EmptyState title="Accesso riservato" hint="Questa sezione è visibile solo agli amministratori." />;
  }

  return (
    <div>
      <PageHeader
        title="Attività"
        description="Chi entra nel sistema e come lo usa."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-ink-900 shadow-card">
              <input type="checkbox" checked={escludi} onChange={toggleEscludi} className="h-4 w-4 accent-ink-800" />
              Non contare i miei dati
            </label>
          {tab !== 'online' && (
            <div className="inline-flex gap-1 rounded-full bg-white p-1 shadow-card" role="group" aria-label="Periodo">
              {PERIODS.map(p => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  aria-pressed={p === days}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    p === days ? 'bg-ink-800 text-white' : 'text-muted hover:bg-stone-100 hover:text-ink-900'
                  }`}
                >
                  {p} g
                </button>
              ))}
            </div>
          )}
          </>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={TAB_LABELS} />
      {tab === 'accessi'   && <AccessiTab days={days} escludi={escludi} />}
      {tab === 'moduli'    && <ModuliTab days={days} escludi={escludi} />}
      {tab === 'online'    && <OnlineTab escludi={escludi} />}
      {tab === 'sicurezza' && <SicurezzaTab days={days} escludi={escludi} />}
    </div>
  );
}
