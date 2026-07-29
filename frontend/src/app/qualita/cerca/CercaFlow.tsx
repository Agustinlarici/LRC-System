'use client';

import { useState, useEffect } from 'react';
import type { QualitaComponent, QualitaReport } from '@/types';
import { OverlayViewer } from './OverlayViewer';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  /** Ingrandisce testi, immagini e campi per l'uso su tablet. */
  tablet?: boolean;
}

export function CercaFlow({ tablet = false }: Props) {
  const [components, setComponents] = useState<QualitaComponent[]>([]);
  const [commessa, setCommessa]     = useState('');
  const [componentId, setComponentId] = useState('');

  const [reports, setReports]   = useState<QualitaReport[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/qualita/components`, { credentials: 'include' })
      .then(r => r.json())
      .then(setComponents)
      .catch(() => {});
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
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

  const groups = reports?.reduce<Record<number, { name: string; reports: QualitaReport[] }>>((acc, r) => {
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

      <div className="space-y-6">
        {Object.entries(groups).map(([id, g]) => (
          <OverlayViewer key={id} componentId={Number(id)} componentName={g.name} reports={g.reports} tablet={tablet} />
        ))}
      </div>
    </div>
  );
}
