'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Types ────────────────────────────────────────────────────────────────────

type ITUser = { id: number; username: string; display_name: string; role: string };
type CategoryRow = { category: string; subcategory: string | null };

type Ticket = {
  id: number;
  ticket_number: string;
  title: string;
  caller_name: string;
  department_name: string | null;
  category: string | null;
  blocca_lavoro: boolean;
  status: string;
  priority: string;
  requires_approval: boolean;
  assigned_to: number | null;
  assigned_to_name: string | null;
  sla_resolution_due: string | null;
  sla_resolution_status: 'ok' | 'warning' | 'breached';
  sla_response_status: 'ok' | 'warning' | 'breached';
  created_at: string;
  reopen_count: number;
};

type HistoryEntry = {
  action: string;
  changed_by_name: string | null;
  user_display_name: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  created_at: string;
};

type TicketDetail = Ticket & {
  description: string;
  caller_email: string | null;
  caller_phone: string | null;
  subcategory: string | null;
  resolution_note: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  history: HistoryEntry[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['aperto','in_lavorazione','in_attesa','in_attesa_approvazione','risolto','chiuso','riaperto'];
const STATUS_LABELS: Record<string, string> = {
  aperto: 'Aperto', in_lavorazione: 'In lavorazione', in_attesa: 'In attesa',
  in_attesa_approvazione: 'In attesa di approvazione',
  risolto: 'Risolto', chiuso: 'Chiuso', riaperto: 'Riaperto',
};
const STATUS_COLORS: Record<string, string> = {
  aperto: 'bg-blue-100 text-blue-800', in_lavorazione: 'bg-yellow-100 text-yellow-800',
  in_attesa: 'bg-gray-100 text-gray-700', in_attesa_approvazione: 'bg-purple-100 text-purple-700',
  risolto: 'bg-green-100 text-green-800',
  chiuso: 'bg-gray-200 text-gray-600', riaperto: 'bg-orange-100 text-orange-800',
};
const PRIORITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta', critica: 'Critica' };
const PRIORITY_COLORS: Record<string, string> = {
  bassa: 'bg-green-100 text-green-700', media: 'bg-yellow-100 text-yellow-700',
  alta: 'bg-orange-100 text-orange-700', critica: 'bg-red-100 text-red-700',
};
const ACTION_LABELS: Record<string, string> = {
  creato: 'Creato', assegnato: 'Assegnato', stato_cambiato: 'Stato',
  priorita_cambiata: 'Priorità', commentato: 'Commento', risolto: 'Risolto',
  chiuso: 'Chiuso', riaperto: 'Riaperto', allegato_aggiunto: 'Allegato',
  approvato: 'Approvato', categoria_cambiata: 'Categoria',
};
const SLA_DOT: Record<string, string> = { ok: 'bg-green-500', warning: 'bg-yellow-400', breached: 'bg-red-500' };

function fmt(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('401'); }
  return res;
}

// ─── Trend chart (creati vs risolti, ultimi N giorni) ──────────────────────────

type TrendPoint = { date: string; created: number; resolved: number };

const TREND_COLORS = { created: '#2a78d6', resolved: '#1baf7a' };

function fmtDayShort(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-sm">
      <p className="text-gray-500 mb-1">{fmtDayShort(label)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-gray-700">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function TrendChart({ refreshKey }: { refreshKey: number }) {
  const [data,    setData]    = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiFetch('/api/tickets/stats/trend?days=14')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Refetch whenever a ticket is created/updated elsewhere on the page, plus a
  // periodic fallback so the chart doesn't go stale on a long-open tab.
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const totalCreated  = data.reduce((s, d) => s + d.created, 0);
  const totalResolved = data.reduce((s, d) => s + d.resolved, 0);

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-gray-700">Andamento ticket</h2>
        <p className="text-sm text-gray-400">Ultimi 14 giorni</p>
      </div>
      {loading ? (
        <p className="text-base text-gray-400 py-8 text-center">Caricamento…</p>
      ) : (
        <>
          {totalCreated === 0 && totalResolved === 0 && (
            <p className="text-sm text-gray-400 mb-1">Nessuna attività negli ultimi 14 giorni</p>
          )}
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e1e0d9" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDayShort}
                tick={{ fontSize: 13, fill: '#52514e' }}
                axisLine={{ stroke: '#c3c2b7' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(max, 3)]}
                tick={{ fontSize: 13, fill: '#52514e' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="line"
                wrapperStyle={{ fontSize: 14, fontWeight: 600, color: '#0b0b0b' }}
              />
              <Line
                type="monotone" dataKey="created" name="Creati"
                stroke={TREND_COLORS.created} strokeWidth={2.5}
                dot={{ r: 4, fill: TREND_COLORS.created, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone" dataKey="resolved" name="Risolti"
                stroke={TREND_COLORS.resolved} strokeWidth={2.5}
                dot={{ r: 4, fill: TREND_COLORS.resolved, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TicketDashboard() {
  const { user } = useAuth();

  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<TicketDetail | null>(null);
  const [itUsers,    setITUsers]    = useState<ITUser[]>([]);
  const [unassigned, setUnassigned] = useState<Ticket[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [trendRefreshKey, setTrendRefreshKey] = useState(0);

  // Filters
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterQ,        setFilterQ]        = useState('');

  // Update form
  const [updStatus,       setUpdStatus]       = useState('');
  const [updPriority,     setUpdPriority]     = useState('');
  const [updAssigned,     setUpdAssigned]     = useState('');
  const [updCategory,     setUpdCategory]     = useState('');
  const [updSubcategory,  setUpdSubcategory]  = useState('');
  const [updNote,         setUpdNote]         = useState('');
  const [updResolution,   setUpdResolution]   = useState('');
  const [updSaving,       setUpdSaving]       = useState(false);
  const [updError,        setUpdError]        = useState('');

  const PER_PAGE = 25;

  // ─── Load IT users list ────────────────────────────────────────────────────

  useEffect(() => {
    apiFetch('/api/auth/users')
      .then(r => r.json())
      .then(setITUsers)
      .catch(() => {});
  }, []);

  // ─── Load categories list ──────────────────────────────────────────────────

  useEffect(() => {
    apiFetch('/api/tickets/categories')
      .then(r => r.json())
      .then(data => setCategories(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // ─── Load unassigned tickets ───────────────────────────────────────────────

  const loadUnassigned = useCallback(async () => {
    const params = new URLSearchParams({ assigned_to: 'null', status: 'aperto,riaperto', per_page: '50' });
    const r = await apiFetch(`/api/tickets?${params}`);
    const d = await r.json();
    setUnassigned(d.tickets ?? []);
  }, []);

  useEffect(() => { loadUnassigned(); }, [loadUnassigned]);

  // ─── Load tickets pending approval ─────────────────────────────────────────

  const [pendingApproval, setPendingApproval] = useState<Ticket[]>([]);

  const loadPendingApproval = useCallback(async () => {
    const params = new URLSearchParams({ status: 'in_attesa_approvazione', per_page: '50' });
    const r = await apiFetch(`/api/tickets?${params}`);
    const d = await r.json();
    setPendingApproval(d.tickets ?? []);
  }, []);

  useEffect(() => { loadPendingApproval(); }, [loadPendingApproval]);

  // ─── Load tickets ──────────────────────────────────────────────────────────

  const loadTickets = useCallback(async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) });
    if (filterStatus)   params.set('status',      filterStatus);
    if (filterPriority) params.set('priority',    filterPriority);
    if (filterAssigned) params.set('assigned_to', filterAssigned);
    if (filterQ)        params.set('q',           filterQ);

    const r = await apiFetch(`/api/tickets?${params}`);
    const d = await r.json();
    setTickets(d.tickets);
    setTotal(d.total);
    setLoading(false);
  }, [filterStatus, filterPriority, filterAssigned, filterQ]);

  useEffect(() => { loadTickets(1); setPage(1); }, [filterStatus, filterPriority, filterAssigned]);

  useEffect(() => {
    const t = setTimeout(() => { loadTickets(1); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [filterQ]);

  // ─── Open ticket detail ────────────────────────────────────────────────────

  async function openTicket(id: number) {
    const r = await apiFetch(`/api/tickets/${id}`);
    const d = await r.json();
    setSelected(d);
    setUpdStatus(d.status);
    setUpdPriority(d.priority);
    setUpdAssigned(d.assigned_to?.toString() ?? '');
    setUpdCategory(d.category ?? '');
    setUpdSubcategory(d.subcategory ?? '');
    setUpdNote('');
    setUpdResolution(d.resolution_note ?? '');
    setUpdError('');
  }

  // ─── Save update ──────────────────────────────────────────────────────────

  async function saveUpdate() {
    if (!selected) return;
    setUpdSaving(true);
    setUpdError('');
    const body: Record<string, any> = {};
    if (updStatus   !== selected.status)              body.status      = updStatus;
    if (updPriority !== selected.priority)            body.priority    = updPriority;
    if (updAssigned !== (selected.assigned_to?.toString() ?? ''))
      body.assigned_to = updAssigned ? parseInt(updAssigned, 10) : null;
    if (updCategory !== (selected.category ?? ''))       body.category    = updCategory || null;
    if (updSubcategory !== (selected.subcategory ?? '')) body.subcategory = updSubcategory || null;
    if (updResolution !== (selected.resolution_note ?? '')) body.resolution_note = updResolution;
    if (updNote)     body.note = updNote;

    if (Object.keys(body).length === 0) { setUpdSaving(false); return; }

    const r = await apiFetch(`/api/tickets/${selected.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setUpdError(d.message ?? 'Errore');
      setUpdSaving(false);
      return;
    }

    await openTicket(selected.id);
    await loadTickets(page);
    await loadUnassigned();
    await loadPendingApproval();
    setTrendRefreshKey(k => k + 1);
    setUpdSaving(false);
    setUpdNote('');
  }

  // ─── Approve ticket ─────────────────────────────────────────────────────────

  const [approving, setApproving] = useState(false);

  async function approveTicket() {
    if (!selected) return;
    setApproving(true);
    setUpdError('');
    const r = await apiFetch(`/api/tickets/${selected.id}/approve`, { method: 'PATCH' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setUpdError(d.message ?? 'Errore');
      setApproving(false);
      return;
    }
    await openTicket(selected.id);
    await loadTickets(page);
    await loadUnassigned();
    await loadPendingApproval();
    setTrendRefreshKey(k => k + 1);
    setApproving(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Top bar */}
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Ticket IT</h1>
        {user && <p className="text-base text-gray-500">Benvenuto, {user.display_name}</p>}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {['aperto','in_lavorazione','in_attesa','in_attesa_approvazione','risolto'].map(s => {
          const count = tickets.filter(t => t.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`card text-left cursor-pointer hover:shadow-md transition-shadow ${filterStatus === s ? 'ring-2 ring-blue-500' : ''}`}
            >
              <p className="text-3xl font-bold text-gray-900">{count}</p>
              <p className="text-sm text-gray-500 mt-0.5">{STATUS_LABELS[s]}</p>
            </button>
          );
        })}
      </div>

      {/* Trend chart */}
      <TrendChart refreshKey={trendRefreshKey} />

      {/* Da prendere in carico */}
      {unassigned.length > 0 && (
        <div className="mb-5">
          <h2 className="text-base font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" />
            Da prendere in carico
            <span className="text-sm font-normal text-gray-400 ml-1">({unassigned.length})</span>
          </h2>
          <div className="border border-orange-200 rounded-xl overflow-hidden">
            <table className="w-full text-base border-collapse">
              <thead>
                <tr className="bg-orange-50 text-left text-base text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Numero</th>
                  <th className="px-4 py-2.5 font-medium">Titolo</th>
                  <th className="px-4 py-2.5 font-medium">Richiedente</th>
                  <th className="px-4 py-2.5 font-medium">Priorità</th>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => openTicket(t.id)}
                    className="border-t border-orange-100 hover:bg-orange-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-lg font-semibold text-gray-800">{t.ticket_number}</td>
                    <td className="px-4 py-2.5 max-w-64">
                      <span className="block truncate text-gray-800">{t.title}</span>
                      {t.blocca_lavoro && <span className="text-base text-red-600 font-medium">⚠ Blocca lavoro</span>}
                    </td>
                    <td className="px-4 py-2.5 text-base text-gray-500">{t.caller_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-base font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[t.priority] ?? ''}`}>{PRIORITY_LABELS[t.priority]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-base text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* In attesa di approvazione */}
      {pendingApproval.length > 0 && (
        <div className="mb-5">
          <h2 className="text-base font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-400" />
            In attesa di approvazione
            <span className="text-sm font-normal text-gray-400 ml-1">({pendingApproval.length})</span>
          </h2>
          <div className="border border-purple-200 rounded-xl overflow-hidden">
            <table className="w-full text-base border-collapse">
              <thead>
                <tr className="bg-purple-50 text-left text-base text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Numero</th>
                  <th className="px-4 py-2.5 font-medium">Titolo</th>
                  <th className="px-4 py-2.5 font-medium">Richiedente</th>
                  <th className="px-4 py-2.5 font-medium">Categoria</th>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {pendingApproval.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => openTicket(t.id)}
                    className="border-t border-purple-100 hover:bg-purple-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-lg font-semibold text-gray-800">{t.ticket_number}</td>
                    <td className="px-4 py-2.5 max-w-64">
                      <span className="block truncate text-gray-800">{t.title}</span>
                      {t.blocca_lavoro && <span className="text-base text-red-600 font-medium">⚠ Blocca lavoro</span>}
                    </td>
                    <td className="px-4 py-2.5 text-base text-gray-500">{t.caller_name}</td>
                    <td className="px-4 py-2.5 text-base text-gray-500">{t.category ?? '—'}</td>
                    <td className="px-4 py-2.5 text-base text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        {user && (
          <button
            type="button"
            onClick={() => setFilterAssigned(prev => prev === user.id.toString() ? '' : user.id.toString())}
            className={`flex items-center gap-2 text-base font-semibold rounded-lg px-4 py-2.5 border-2 transition-colors ${
              filterAssigned === user.id.toString()
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="text-lg leading-none">👤</span>
            I miei ticket
          </button>
        )}
        <input
          type="text"
          value={filterQ}
          onChange={e => setFilterQ(e.target.value)}
          placeholder="Cerca per numero, titolo, richiedente…"
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutti gli stati</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutte le priorità</option>
          {['bassa','media','alta','critica'].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
        <select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutti gli operatori</option>
          {itUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-base text-gray-400 py-8 text-center">Caricamento…</p>
        ) : tickets.length === 0 ? (
          <p className="text-base text-gray-400 py-8 text-center">Nessun ticket trovato</p>
        ) : (
          <table className="w-full text-base border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-base text-gray-500 uppercase tracking-wide">
                <th className="pb-3 pr-4 font-medium">Numero</th>
                <th className="pb-3 pr-4 font-medium">Titolo</th>
                <th className="pb-3 pr-4 font-medium">Richiedente</th>
                <th className="pb-3 pr-4 font-medium">Categoria</th>
                <th className="pb-3 pr-4 font-medium">Stato</th>
                <th className="pb-3 pr-4 font-medium">Priorità</th>
                <th className="pb-3 pr-4 font-medium">Assegnato</th>
                <th className="pb-3 pr-4 font-medium">SLA</th>
                <th className="pb-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr
                  key={t.id}
                  onClick={() => openTicket(t.id)}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="py-3.5 pr-4 font-mono text-lg font-semibold text-gray-800">{t.ticket_number}</td>
                  <td className="py-3.5 pr-4 max-w-64">
                    <span className="block truncate text-gray-800 text-base">{t.title}</span>
                    {t.blocca_lavoro && <span className="text-base text-red-600 font-medium">⚠ Blocca lavoro</span>}
                  </td>
                  <td className="py-3.5 pr-4 text-gray-600 text-base">{t.caller_name}{t.department_name ? <><br /><span className="text-gray-400 text-sm">{t.department_name}</span></> : null}</td>
                  <td className="py-3.5 pr-4 text-gray-500 text-base">{t.category ?? '—'}</td>
                  <td className="py-3.5 pr-4">
                    <span className={`text-base font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[t.status] ?? ''}`}>{STATUS_LABELS[t.status]}</span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className={`text-base font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[t.priority] ?? ''}`}>{PRIORITY_LABELS[t.priority]}</span>
                  </td>
                  <td className="py-3.5 pr-4 text-base text-gray-500">{t.assigned_to_name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="py-3.5 pr-4">
                    <span className={`inline-block w-4 h-4 rounded-full ${SLA_DOT[t.sla_resolution_status]}`} title={`SLA risoluzione: ${t.sla_resolution_status}`} />
                  </td>
                  <td className="py-3.5 text-base text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PER_PAGE && (
        <div className="flex items-center justify-between mt-3 text-base text-gray-500">
          <span>{total} ticket totali</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); loadTickets(page - 1); }}
              className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">‹ Prec</button>
            <span className="px-3 py-1.5">Pag. {page} / {Math.ceil(total / PER_PAGE)}</span>
            <button disabled={page >= Math.ceil(total / PER_PAGE)} onClick={() => { setPage(p => p + 1); loadTickets(page + 1); }}
              className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Succ ›</button>
          </div>
        </div>
      )}

      {/* Detail panel (slide-over) */}
      {selected && (
        <div className="fixed inset-0 z-50 flex" onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div className="relative ml-auto w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col">

            {/* Panel header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-200">
              <div>
                <p className="font-mono text-base text-gray-500">{selected.ticket_number}</p>
                <h2 className="text-lg font-semibold text-gray-900 mt-0.5">{selected.title}</h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                  <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[selected.priority]}`}>{PRIORITY_LABELS[selected.priority]}</span>
                  {selected.blocca_lavoro && <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">Blocca lavoro</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 ml-4 mt-1 text-2xl leading-none">×</button>
            </div>

            {/* Approval banner */}
            {selected.requires_approval && selected.status === 'in_attesa_approvazione' && (
              <div className="mx-5 mt-4 p-3 rounded-lg border border-purple-200 bg-purple-50 flex items-center justify-between gap-3">
                <p className="text-base text-purple-800">
                  Questo ticket richiede approvazione prima di poter essere lavorato.
                </p>
                <button
                  onClick={approveTicket}
                  disabled={approving}
                  className="shrink-0 bg-purple-600 text-white rounded-lg px-3 py-1.5 text-base font-semibold hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {approving ? 'Approvazione…' : 'Approva'}
                </button>
              </div>
            )}
            {selected.approved_by_name && (
              <p className="mx-5 mt-3 text-sm text-gray-400">
                Approvato da {selected.approved_by_name}{selected.approved_at ? ` il ${fmt(selected.approved_at)}` : ''}
              </p>
            )}

            {/* Caller info */}
            <div className="p-5 border-b border-gray-100 space-y-1.5 text-base">
              <p><span className="text-gray-500">Richiedente:</span> <span className="text-gray-800 font-medium">{selected.caller_name}</span></p>
              {selected.department_name && <p><span className="text-gray-500">Reparto:</span> <span className="text-gray-700">{selected.department_name}</span></p>}
              {selected.caller_email   && <p><span className="text-gray-500">Email:</span> <a href={`mailto:${selected.caller_email}`} className="text-blue-600 hover:underline">{selected.caller_email}</a></p>}
              {selected.caller_phone   && <p><span className="text-gray-500">Tel:</span> <span className="text-gray-700">{selected.caller_phone}</span></p>}
              {selected.category       && <p><span className="text-gray-500">Categoria:</span> <span className="text-gray-700">{selected.category}{selected.subcategory ? ` / ${selected.subcategory}` : ''}</span></p>}
            </div>

            {/* Description */}
            <div className="p-5 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Descrizione</p>
              <p className="text-base text-gray-800 whitespace-pre-wrap">{selected.description}</p>
              {selected.attachment_name && (
                <a
                  href={`${BACKEND}/api/tickets/${selected.id}/attachment`}
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex items-center gap-1.5 text-base text-blue-600 hover:underline"
                >
                  📎 {selected.attachment_name}
                </a>
              )}
            </div>

            {/* Update form */}
            <div className="p-5 border-b border-gray-100 space-y-3">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Aggiorna ticket</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Stato</label>
                  <select value={updStatus} onChange={e => setUpdStatus(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Priorità</label>
                  <select value={updPriority} onChange={e => setUpdPriority(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {['bassa','media','alta','critica'].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Assegna a</label>
                <select value={updAssigned} onChange={e => setUpdAssigned(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Non assegnato —</option>
                  {itUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Categoria</label>
                  <select
                    value={updCategory}
                    onChange={e => { setUpdCategory(e.target.value); setUpdSubcategory(''); }}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Nessuna —</option>
                    {[...new Set(categories.map(c => c.category))].map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Sottocategoria</label>
                  <select
                    value={updSubcategory}
                    onChange={e => setUpdSubcategory(e.target.value)}
                    disabled={!updCategory}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">— Nessuna —</option>
                    {categories.filter(c => c.category === updCategory && c.subcategory !== null).map(c => (
                      <option key={c.subcategory} value={c.subcategory as string}>{c.subcategory}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nota interna</label>
                <textarea value={updNote} onChange={e => setUpdNote(e.target.value)} rows={2} placeholder="Aggiungi un commento…" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {(updStatus === 'risolto' || selected.resolution_note) && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Nota di risoluzione</label>
                  <textarea value={updResolution} onChange={e => setUpdResolution(e.target.value)} rows={3} placeholder="Descrivi la soluzione adottata…" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {updError && <p className="text-base text-red-600">{updError}</p>}
              <button onClick={saveUpdate} disabled={updSaving} className="bg-blue-600 text-white rounded-lg px-4 py-2.5 text-base font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {updSaving ? 'Salvataggio…' : 'Salva modifiche'}
              </button>
            </div>

            {/* History */}
            {selected.history.length > 0 && (
              <div className="p-5 flex-1">
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Storico</p>
                <ol className="relative border-l border-gray-200 space-y-3 ml-2">
                  {selected.history.map((h, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute w-2.5 h-2.5 bg-gray-300 rounded-full -left-1.5 border-2 border-white" />
                      <p className="text-sm text-gray-400">{fmt(h.created_at)}</p>
                      <p className="text-base font-medium text-gray-700">{ACTION_LABELS[h.action] ?? h.action}</p>
                      {h.note && <p className="text-base text-gray-600 mt-0.5 whitespace-pre-wrap">{h.note}</p>}
                      {h.old_value && h.new_value && (
                        <p className="text-sm text-gray-500 mt-0.5">
                          <span className="line-through">{h.old_value}</span> → {h.new_value}
                        </p>
                      )}
                      {(h.user_display_name || h.changed_by_name) && (
                        <p className="text-sm text-gray-400 mt-0.5">— {h.user_display_name ?? h.changed_by_name}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
