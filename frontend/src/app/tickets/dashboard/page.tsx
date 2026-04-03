'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Types ────────────────────────────────────────────────────────────────────

type ITUser = { id: number; username: string; display_name: string; role: string };

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
  attachment_path: string | null;
  attachment_name: string | null;
  history: HistoryEntry[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['aperto','in_lavorazione','in_attesa','risolto','chiuso','riaperto'];
const STATUS_LABELS: Record<string, string> = {
  aperto: 'Aperto', in_lavorazione: 'In lavorazione', in_attesa: 'In attesa',
  risolto: 'Risolto', chiuso: 'Chiuso', riaperto: 'Riaperto',
};
const STATUS_COLORS: Record<string, string> = {
  aperto: 'bg-blue-100 text-blue-800', in_lavorazione: 'bg-yellow-100 text-yellow-800',
  in_attesa: 'bg-gray-100 text-gray-700', risolto: 'bg-green-100 text-green-800',
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function TicketDashboard() {
  const router = useRouter();
  const { user, logout: authLogout, canManage } = useAuth();

  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<TicketDetail | null>(null);
  const [itUsers,    setITUsers]    = useState<ITUser[]>([]);
  const [unassigned, setUnassigned] = useState<Ticket[]>([]);

  // Filters
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterQ,        setFilterQ]        = useState('');

  // Update form
  const [updStatus,       setUpdStatus]       = useState('');
  const [updPriority,     setUpdPriority]     = useState('');
  const [updAssigned,     setUpdAssigned]     = useState('');
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

  // ─── Load unassigned tickets ───────────────────────────────────────────────

  const loadUnassigned = useCallback(async () => {
    const params = new URLSearchParams({ assigned_to: 'null', status: 'aperto,riaperto', per_page: '50' });
    const r = await apiFetch(`/api/tickets?${params}`);
    const d = await r.json();
    setUnassigned(d.tickets ?? []);
  }, []);

  useEffect(() => { loadUnassigned(); }, [loadUnassigned]);

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
    setUpdSaving(false);
    setUpdNote('');
  }

  async function logout() {
    await authLogout();
    router.push('/login');
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Ticket IT</h1>
          {user && <p className="text-sm text-gray-500">Benvenuto, {user.display_name}</p>}
        </div>
        <div className="flex items-center gap-3">
          {canManage('tickets_admin') && (
            <a href="/tickets/admin" className="text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
              ⚙ Admin
            </a>
          )}
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-800 hover:underline">Esci</button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {['aperto','in_lavorazione','in_attesa','risolto'].map(s => {
          const count = tickets.filter(t => t.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`card text-left cursor-pointer hover:shadow-md transition-shadow ${filterStatus === s ? 'ring-2 ring-blue-500' : ''}`}
            >
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{STATUS_LABELS[s]}</p>
            </button>
          );
        })}
      </div>

      {/* Da prendere in carico */}
      {unassigned.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
            Da prendere in carico
            <span className="text-xs font-normal text-gray-400 ml-1">({unassigned.length})</span>
          </h2>
          <div className="border border-orange-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-orange-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2 font-medium">Numero</th>
                  <th className="px-3 py-2 font-medium">Titolo</th>
                  <th className="px-3 py-2 font-medium">Richiedente</th>
                  <th className="px-3 py-2 font-medium">Priorità</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => openTicket(t.id)}
                    className="border-t border-orange-100 hover:bg-orange-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{t.ticket_number}</td>
                    <td className="px-3 py-2 max-w-48">
                      <span className="block truncate text-gray-800">{t.title}</span>
                      {t.blocca_lavoro && <span className="text-xs text-red-600 font-medium">⚠ Blocca lavoro</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{t.caller_name}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[t.priority] ?? ''}`}>{PRIORITY_LABELS[t.priority]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={filterQ}
          onChange={e => setFilterQ(e.target.value)}
          placeholder="Cerca per numero, titolo, richiedente…"
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutti gli stati</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutte le priorità</option>
          {['bassa','media','alta','critica'].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
        <select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tutti gli operatori</option>
          {itUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Caricamento…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Nessun ticket trovato</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="pb-2 pr-3 font-medium">Numero</th>
                <th className="pb-2 pr-3 font-medium">Titolo</th>
                <th className="pb-2 pr-3 font-medium">Richiedente</th>
                <th className="pb-2 pr-3 font-medium">Categoria</th>
                <th className="pb-2 pr-3 font-medium">Stato</th>
                <th className="pb-2 pr-3 font-medium">Priorità</th>
                <th className="pb-2 pr-3 font-medium">Assegnato</th>
                <th className="pb-2 pr-3 font-medium">SLA</th>
                <th className="pb-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr
                  key={t.id}
                  onClick={() => openTicket(t.id)}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 pr-3 font-mono text-xs text-gray-600">{t.ticket_number}</td>
                  <td className="py-2.5 pr-3 max-w-48">
                    <span className="block truncate text-gray-800">{t.title}</span>
                    {t.blocca_lavoro && <span className="text-xs text-red-600 font-medium">⚠ Blocca lavoro</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-600 text-xs">{t.caller_name}{t.department_name ? <><br /><span className="text-gray-400">{t.department_name}</span></> : null}</td>
                  <td className="py-2.5 pr-3 text-gray-500 text-xs">{t.category ?? '—'}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status] ?? ''}`}>{STATUS_LABELS[t.status]}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[t.priority] ?? ''}`}>{PRIORITY_LABELS[t.priority]}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500">{t.assigned_to_name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${SLA_DOT[t.sla_resolution_status]}`} title={`SLA risoluzione: ${t.sla_resolution_status}`} />
                  </td>
                  <td className="py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PER_PAGE && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>{total} ticket totali</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); loadTickets(page - 1); }}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-gray-50">‹ Prec</button>
            <span className="px-3 py-1">Pag. {page} / {Math.ceil(total / PER_PAGE)}</span>
            <button disabled={page >= Math.ceil(total / PER_PAGE)} onClick={() => { setPage(p => p + 1); loadTickets(page + 1); }}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Succ ›</button>
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
                <p className="font-mono text-sm text-gray-500">{selected.ticket_number}</p>
                <h2 className="text-base font-semibold text-gray-900 mt-0.5">{selected.title}</h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[selected.priority]}`}>{PRIORITY_LABELS[selected.priority]}</span>
                  {selected.blocca_lavoro && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Blocca lavoro</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 ml-4 mt-1 text-xl leading-none">×</button>
            </div>

            {/* Caller info */}
            <div className="p-5 border-b border-gray-100 space-y-1 text-sm">
              <p><span className="text-gray-500">Richiedente:</span> <span className="text-gray-800 font-medium">{selected.caller_name}</span></p>
              {selected.department_name && <p><span className="text-gray-500">Reparto:</span> <span className="text-gray-700">{selected.department_name}</span></p>}
              {selected.caller_email   && <p><span className="text-gray-500">Email:</span> <a href={`mailto:${selected.caller_email}`} className="text-blue-600 hover:underline">{selected.caller_email}</a></p>}
              {selected.caller_phone   && <p><span className="text-gray-500">Tel:</span> <span className="text-gray-700">{selected.caller_phone}</span></p>}
              {selected.category       && <p><span className="text-gray-500">Categoria:</span> <span className="text-gray-700">{selected.category}{selected.subcategory ? ` / ${selected.subcategory}` : ''}</span></p>}
            </div>

            {/* Description */}
            <div className="p-5 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Descrizione</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{selected.description}</p>
              {selected.attachment_name && (
                <a
                  href={`${BACKEND}/api/tickets/${selected.id}/attachment`}
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  📎 {selected.attachment_name}
                </a>
              )}
            </div>

            {/* Update form */}
            <div className="p-5 border-b border-gray-100 space-y-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Aggiorna ticket</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Stato</label>
                  <select value={updStatus} onChange={e => setUpdStatus(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Priorità</label>
                  <select value={updPriority} onChange={e => setUpdPriority(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {['bassa','media','alta','critica'].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Assegna a</label>
                <select value={updAssigned} onChange={e => setUpdAssigned(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Non assegnato —</option>
                  {itUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nota interna</label>
                <textarea value={updNote} onChange={e => setUpdNote(e.target.value)} rows={2} placeholder="Aggiungi un commento…" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {(updStatus === 'risolto' || selected.resolution_note) && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Nota di risoluzione</label>
                  <textarea value={updResolution} onChange={e => setUpdResolution(e.target.value)} rows={3} placeholder="Descrivi la soluzione adottata…" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {updError && <p className="text-sm text-red-600">{updError}</p>}
              <button onClick={saveUpdate} disabled={updSaving} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {updSaving ? 'Salvataggio…' : 'Salva modifiche'}
              </button>
            </div>

            {/* History */}
            {selected.history.length > 0 && (
              <div className="p-5 flex-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Storico</p>
                <ol className="relative border-l border-gray-200 space-y-3 ml-2">
                  {selected.history.map((h, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute w-2 h-2 bg-gray-300 rounded-full -left-1 border-2 border-white" />
                      <p className="text-xs text-gray-400">{fmt(h.created_at)}</p>
                      <p className="text-sm font-medium text-gray-700">{ACTION_LABELS[h.action] ?? h.action}</p>
                      {h.note && <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{h.note}</p>}
                      {h.old_value && h.new_value && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="line-through">{h.old_value}</span> → {h.new_value}
                        </p>
                      )}
                      {(h.user_display_name || h.changed_by_name) && (
                        <p className="text-xs text-gray-400 mt-0.5">— {h.user_display_name ?? h.changed_by_name}</p>
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
