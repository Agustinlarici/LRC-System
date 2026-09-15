'use client';

import { useState, useEffect, useCallback } from 'react';
import type { QualitaComponent, QualitaReport, QualitaReportGroup } from '@/types';
import { OverlayViewer } from './OverlayViewer';
import { showVirtualKeyboard } from '../virtual-keyboard';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const GROUPS_PAGE_SIZE = 10;

interface Props {
  /** Ingrandisce testi, immagini e campi per l'uso su tablet. */
  tablet?: boolean;
}

function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function groupKey(g: { commessa: string; component_id: number }): string {
  return `${g.commessa}::${g.component_id}`;
}

export function CercaFlow({ tablet = false }: Props) {
  const [components, setComponents] = useState<QualitaComponent[]>([]);
  const [commessa, setCommessa]     = useState('');
  const [componentId, setComponentId] = useState('');

  const [reports, setReports]   = useState<QualitaReport[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [searched, setSearched] = useState(false);

  // Elenco di tutte le segnalazioni, raggruppate per commessa + componente e ordinate
  // dalla più recente, mostrato quando non è attiva una ricerca esplicita.
  const [groups, setGroups]         = useState<QualitaReportGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError]     = useState('');
  const [groupsHasMore, setGroupsHasMore] = useState(false);
  const [expandedKey, setExpandedKey]     = useState<string | null>(null);
  const [expandedReports, setExpandedReports] = useState<Record<string, QualitaReport[]>>({});
  const [expandedLoading, setExpandedLoading]  = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/qualita/components`, { credentials: 'include' })
      .then(r => r.json())
      .then(setComponents)
      .catch(() => {});
  }, []);

  const loadGroups = useCallback(async (offset: number) => {
    setGroupsLoading(true); setGroupsError('');
    try {
      const res = await fetch(`${BACKEND}/api/qualita/reports/groups?limit=${GROUPS_PAGE_SIZE}&offset=${offset}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGroups(prev => offset === 0 ? data.groups : [...prev, ...data.groups]);
      setGroupsHasMore(data.hasMore);
    } catch {
      setGroupsError('Errore nel caricamento dell\'elenco');
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(0); }, [loadGroups]);

  async function toggleGroup(g: QualitaReportGroup) {
    const key = groupKey(g);
    if (expandedKey === key) { setExpandedKey(null); return; }
    setExpandedKey(key);
    if (expandedReports[key]) return;
    setExpandedLoading(true);
    try {
      const params = new URLSearchParams({ commessa: g.commessa, component_id: String(g.component_id), exact: 'true' });
      const res = await fetch(`${BACKEND}/api/qualita/reports?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data: QualitaReport[] = await res.json();
      setExpandedReports(prev => ({ ...prev, [key]: data }));
    } catch {
      setGroupsError('Errore nel caricamento della segnalazione');
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    // Rientra in fullscreen ad ogni ricerca, solo in modalità tablet — su alcuni
    // tablet la tastiera virtuale fa uscire dal fullscreen.
    if (tablet && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    if (!commessa.trim()) return;
    setLoading(true); setError(''); setSearched(true);
    try {
      const params = new URLSearchParams({ commessa: commessa.trim() });
      if (componentId) params.set('component_id', componentId);
      const res = await fetch(`${BACKEND}/api/qualita/reports?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      setReports(await res.json());
    } catch {
      setError('Errore durante la ricerca');
      setReports(null);
    } finally {
      setLoading(false);
    }
  }

  function resetSearch() {
    setSearched(false); setReports(null); setError(''); setCommessa(''); setComponentId('');
  }

  const resultGroups = reports?.reduce<Record<number, { name: string; reports: QualitaReport[] }>>((acc, r) => {
    if (!acc[r.component_id]) acc[r.component_id] = { name: r.component_name ?? '—', reports: [] };
    acc[r.component_id].reports.push(r);
    return acc;
  }, {}) ?? {};

  return (
    <div>
      <form onSubmit={handleSearch} className={`card mb-6 grid grid-cols-1 sm:grid-cols-[1fr_240px_auto] gap-3 ${tablet ? 'py-6' : ''}`}>
        <input
          className={`input ${tablet ? 'text-lg py-3' : ''}`}
          placeholder="Numero commessa"
          value={commessa}
          onChange={e => setCommessa(e.target.value)}
          onFocus={showVirtualKeyboard}
          inputMode="numeric"
          pattern="[0-9]*"
          required
        />
        <select className={`input bg-white ${tablet ? 'text-lg py-3' : ''}`} value={componentId} onChange={e => setComponentId(e.target.value)}>
          <option value="">Tutti i componenti</option>
          {components.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" disabled={loading || !commessa.trim()} className={`btn btn-primary ${tablet ? 'text-lg py-3' : ''}`}>
          {loading ? 'Ricerca...' : 'Cerca'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</p>}

      {searched && !loading && reports && reports.length === 0 && (
        <p className={tablet ? 'text-base text-gray-400' : 'text-sm text-gray-400'}>Nessuna segnalazione trovata per questa ricerca.</p>
      )}

      {searched ? (
        <>
          <button type="button" onClick={resetSearch} className={`text-sm text-gray-500 hover:text-gray-700 mb-4 ${tablet ? 'text-base' : ''}`}>
            ← Torna all&apos;elenco
          </button>
          <div className="space-y-6">
            {Object.entries(resultGroups).map(([id, g]) => (
              <OverlayViewer key={id} componentId={Number(id)} componentName={g.name} reports={g.reports} tablet={tablet} />
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {groupsError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{groupsError}</p>}

          {!groupsLoading && groups.length === 0 && !groupsError && (
            <p className={tablet ? 'text-base text-gray-400' : 'text-sm text-gray-400'}>Nessuna segnalazione registrata.</p>
          )}

          {groups.map(g => {
            const key = groupKey(g);
            const isOpen = expandedKey === key;
            return (
              <div key={key} className="card p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(g)}
                  className={`w-full flex items-center justify-between gap-4 text-left hover:bg-gray-50 ${tablet ? 'p-5' : 'p-4'}`}
                >
                  <div className="min-w-0">
                    <p className={`font-semibold text-gray-800 ${tablet ? 'text-lg' : ''}`}>
                      Commessa {g.commessa} — {g.component_name}
                    </p>
                    <p className={`text-gray-500 mt-0.5 ${tablet ? 'text-sm' : 'text-xs'}`}>
                      {g.count} segnalazion{g.count === 1 ? 'e' : 'i'} · ultima il {fmtDateTime(g.latest_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-gray-400 ${tablet ? 'text-2xl' : 'text-lg'}`}>{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className={`border-t border-gray-100 ${tablet ? 'p-5' : 'p-4'}`}>
                    {expandedLoading && !expandedReports[key] && (
                      <p className={tablet ? 'text-base text-gray-400' : 'text-sm text-gray-400'}>Caricamento...</p>
                    )}
                    {expandedReports[key] && (
                      <OverlayViewer
                        componentId={g.component_id}
                        componentName={g.component_name}
                        reports={expandedReports[key]}
                        tablet={tablet}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {groupsHasMore && (
            <button
              type="button"
              onClick={() => loadGroups(groups.length)}
              disabled={groupsLoading}
              className={`btn btn-secondary w-full ${tablet ? 'text-lg py-3' : ''}`}
            >
              {groupsLoading ? 'Caricamento...' : 'Mostra altro'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
