'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
    ...opts,
  });
  if (res.status === 401 || res.status === 403) { window.location.href = '/login'; throw new Error('auth'); }
  return res;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type HealthStatus = { status: 'ok' | 'degraded' | 'error'; ts: string; deps: { postgres: string; webthron: string } };

type RunStats = {
  lastStartedAt:    string | null;
  lastFinishedAt:   string | null;
  lastDurationSec:  number | null;
  lastRowCount:     number | null;
  lastError:        string | null;
  runCount:         number;
  consecutiveErrors: number;
  nextScheduledAt:  string | null;
  status:           'idle' | 'running' | 'ok' | 'error';
};

type Alert = {
  id:               number;
  alert_key:        string;
  severity:         'critical' | 'warning' | 'info';
  title:            string;
  message:          string | null;
  resolved_at:      string | null;
  resolved_message: string | null;
  created_at:       string;
  is_active:        boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false });
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.round(diff / 60_000);
  if (min < 1)  return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  return `${h} h fa`;
}

function statusColor(s: string): string {
  if (s === 'ok')        return 'text-green-600';
  if (s === 'error')     return 'text-red-600';
  if (s === 'running')   return 'text-blue-600';
  if (s === 'degraded')  return 'text-yellow-600';
  return 'text-gray-400';
}

function statusBadge(s: string) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold';
  if (s === 'ok')      return `${base} bg-green-100 text-green-700`;
  if (s === 'error')   return `${base} bg-red-100 text-red-700`;
  if (s === 'running') return `${base} bg-blue-100 text-blue-700`;
  if (s === 'degraded')return `${base} bg-yellow-100 text-yellow-700`;
  return `${base} bg-gray-100 text-gray-500`;
}

function severityBadge(s: string) {
  const base = 'inline-block px-2 py-0.5 rounded text-xs font-semibold';
  if (s === 'critical') return `${base} bg-red-100 text-red-700`;
  if (s === 'warning')  return `${base} bg-yellow-100 text-yellow-700`;
  return `${base} bg-blue-100 text-blue-700`;
}

const JOB_LABELS: Record<string, string> = {
  sync_incremental: 'Sync WebThron (10 min)',
  sync_full_day:    'Sync Full Day (01:00)',
  heatmap_snapshot: 'Snapshot OEE (01:00)',
  lookup_refresh:   'Lookup Tables (02:00)',
  bc_sync:          'Sync Business Central (03:00)',
  buffer_refresh:   'Buffer Refresh (30 min)',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

function HealthDep({ label, status }: { label: string; status: string }) {
  const dot = status === 'ok' ? 'bg-green-500' : status === 'unavailable' ? 'bg-yellow-400' : 'bg-red-500';
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={statusBadge(status === 'unavailable' ? 'degraded' : status)}>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {status}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SystemPage() {
  const [health,    setHealth]    = useState<HealthStatus | null>(null);
  const [syncStats, setSyncStats] = useState<Record<string, RunStats>>({});
  const [alerts,    setAlerts]    = useState<Alert[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState('');
  const [acting,    setActing]    = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { document.title = 'Sistema — STR'; }, []);

  const load = useCallback(async () => {
    try {
      const [hRes, sRes, aRes] = await Promise.all([
        apiFetch('/health'),
        apiFetch('/api/system/sync-status'),
        apiFetch('/api/system/alerts'),
      ]);
      setHealth(await hRes.json());
      setSyncStats(await sRes.json());
      setAlerts(await aRes.json());
    } catch { /* ignore on auto-refresh */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) intervalRef.current = setInterval(load, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4_000);
  }

  async function forceAction(endpoint: string, label: string) {
    if (acting) return;
    setActing(endpoint);
    try {
      const res = await apiFetch(`/api/system/${endpoint}`, { method: 'POST' });
      const data = await res.json() as { message?: string };
      showToast(data.message ?? `${label} avviato`);
      setTimeout(load, 3_000); // refresh after 3s
    } catch (e) {
      showToast(`Errore: ${e}`);
    } finally {
      setActing(null);
    }
  }

  async function sendTestAlert() {
    await forceAction('test-alert', 'Alert di test');
  }

  const activeAlerts = alerts.filter(a => a.is_active);
  const historyAlerts = alerts.filter(a => !a.is_active);

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Sistema</h1>
          <p className="text-sm text-gray-500 mt-0.5">Stato servizi, sync jobs, alert e diagnostica</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <span
              onClick={() => setAutoRefresh(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${autoRefresh ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-4' : ''}`} />
            </span>
            Auto-refresh 30s
          </label>
          <button onClick={load} className="btn-secondary text-sm">Aggiorna ora</button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Caricamento...</div>
      ) : (
        <>
          {/* Active alerts banner */}
          {activeAlerts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-600 font-semibold text-sm">{activeAlerts.length} alert attivi</span>
              </div>
              <div className="space-y-1">
                {activeAlerts.map(a => (
                  <div key={a.id} className="flex items-start gap-2 text-sm">
                    <span className={severityBadge(a.severity)}>{a.severity}</span>
                    <span className="font-medium text-red-700">{a.title}</span>
                    {a.message && <span className="text-red-600">— {a.message}</span>}
                    <span className="ml-auto text-red-400 text-xs shrink-0">{ago(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Health */}
            <Card title="Servizi">
              {health ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Stato globale</span>
                    <span className={statusBadge(health.status)}>{health.status.toUpperCase()}</span>
                  </div>
                  <HealthDep label="PostgreSQL"   status={health.deps.postgres} />
                  <HealthDep label="WebThron"     status={health.deps.webthron} />
                  <p className="text-xs text-gray-400 mt-3">Verificato: {fmt(health.ts)}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">Non disponibile</p>
              )}
            </Card>

            {/* Quick actions */}
            <Card title="Azioni manuali">
              <div className="space-y-2">
                {([
                  ['force-sync',     'Sync WebThron ora'],
                  ['force-bc-sync',  'Sync Business Central ora'],
                  ['force-lookup',   'Refresh lookup tables'],
                  ['force-snapshot', 'Snapshot OEE ieri'],
                ] as [string, string][]).map(([ep, label]) => (
                  <button
                    key={ep}
                    onClick={() => forceAction(ep, label)}
                    disabled={!!acting}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors
                      ${acting === ep
                        ? 'bg-blue-50 border-blue-200 text-blue-600'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                  >
                    {acting === ep ? '⟳ In corso...' : label}
                  </button>
                ))}
                <button
                  onClick={sendTestAlert}
                  disabled={!!acting}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-500 transition-colors"
                >
                  Invia alert di test
                </button>
              </div>
            </Card>

            {/* Alert history summary */}
            <Card title="Ultimi alert risolti">
              {historyAlerts.length === 0 ? (
                <p className="text-sm text-gray-400">Nessun alert in storico</p>
              ) : (
                <div className="space-y-2">
                  {historyAlerts.slice(0, 5).map(a => (
                    <div key={a.id} className="text-sm">
                      <div className="flex items-center gap-1">
                        <span className={severityBadge(a.severity)}>{a.severity}</span>
                        <span className="text-gray-700 font-medium truncate">{a.title}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {fmt(a.created_at)} → {a.resolved_at ? ago(a.resolved_at) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Sync jobs table */}
          <Card title="Sync Jobs">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="pb-2 pr-4 font-medium">Job</th>
                    <th className="pb-2 pr-4 font-medium">Stato</th>
                    <th className="pb-2 pr-4 font-medium">Ultimo run</th>
                    <th className="pb-2 pr-4 font-medium">Durata</th>
                    <th className="pb-2 pr-4 font-medium">Righe</th>
                    <th className="pb-2 pr-4 font-medium">Prossimo</th>
                    <th className="pb-2 font-medium">Errore</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Object.entries(syncStats).map(([job, s]) => (
                    <tr key={job} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-4 font-medium text-gray-700">
                        {JOB_LABELS[job] ?? job}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={statusBadge(s.status)}>{s.status}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500">{ago(s.lastFinishedAt)}</td>
                      <td className="py-2.5 pr-4 text-gray-500">
                        {s.lastDurationSec != null ? `${s.lastDurationSec}s` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500">{s.lastRowCount ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-gray-500">{ago(s.nextScheduledAt)}</td>
                      <td className="py-2.5 max-w-xs">
                        {s.lastError ? (
                          <span className="text-red-500 text-xs truncate block" title={s.lastError}>
                            {s.lastError.length > 60 ? s.lastError.slice(0, 60) + '…' : s.lastError}
                            {s.consecutiveErrors > 1 && (
                              <span className="ml-1 text-red-400 font-semibold">×{s.consecutiveErrors}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(syncStats).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-400">
                        Nessun dato disponibile — il server sta caricando
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Full alert history */}
          {alerts.length > 0 && (
            <Card title="Storico alert (ultimi 100)">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="pb-2 pr-4 font-medium">Tipo</th>
                      <th className="pb-2 pr-4 font-medium">Titolo</th>
                      <th className="pb-2 pr-4 font-medium">Messaggio</th>
                      <th className="pb-2 pr-4 font-medium">Aperto</th>
                      <th className="pb-2 font-medium">Risolto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {alerts.map(a => (
                      <tr key={a.id} className={a.is_active ? 'bg-red-50' : ''}>
                        <td className="py-2 pr-4">
                          <span className={severityBadge(a.severity)}>{a.severity}</span>
                        </td>
                        <td className="py-2 pr-4 font-medium text-gray-700">{a.title}</td>
                        <td className="py-2 pr-4 text-gray-500 text-xs max-w-xs truncate">{a.message ?? '—'}</td>
                        <td className="py-2 pr-4 text-gray-500 text-xs whitespace-nowrap">{fmt(a.created_at)}</td>
                        <td className="py-2 text-gray-500 text-xs whitespace-nowrap">
                          {a.resolved_at ? fmt(a.resolved_at) : <span className="text-red-500 font-medium">Aperto</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
