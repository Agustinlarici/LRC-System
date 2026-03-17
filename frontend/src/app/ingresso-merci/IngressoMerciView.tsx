'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { IngressoMerci, IngressoMerciStorico } from '@/types';

// ─── Add Form ────────────────────────────────────────────────────────────────

const EMPTY_FORM = { materiale: '', mezzo: '', commessa: '', inseritoDa: '', orarioArrivo: '' };

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/ingresso-merci', {
        materiale:    form.materiale,
        mezzo:        form.mezzo,
        commessa:     form.commessa || null,
        inseritoDa:   form.inseritoDa || 'Anonimo',
        orarioArrivo: form.orarioArrivo,
      });
      setForm(EMPTY_FORM);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card mb-6">
      <h2 className="font-semibold text-gray-800 mb-4">Aggiungi Materiale in Arrivo</h2>

      {error && (
        <p className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div><label className="label">Materiale *</label><input className="input" value={form.materiale} onChange={set('materiale')} required /></div>
        <div><label className="label">Mezzo *</label><input className="input" value={form.mezzo} onChange={set('mezzo')} required /></div>
        <div><label className="label">Commessa</label><input className="input" value={form.commessa} onChange={set('commessa')} /></div>
        <div><label className="label">Inserito da</label><input className="input" placeholder="Anonimo" value={form.inseritoDa} onChange={set('inseritoDa')} /></div>
        <div><label className="label">Orario Arrivo *</label><input type="datetime-local" className="input" value={form.orarioArrivo} onChange={set('orarioArrivo')} required /></div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Salvataggio...' : '+ Aggiungi'}
        </button>
      </div>
    </form>
  );
}

// ─── Active List ──────────────────────────────────────────────────────────────

function ActiveList({ items, onReceived }: {
  items: IngressoMerci[];
  onReceived: (id: number, name: string) => void;
}) {
  const [receiving,  setReceiving]  = useState<number | null>(null);
  const [name,       setName]       = useState('');

  function confirm(id: number) {
    if (!name.trim()) return;
    onReceived(id, name.trim());
    setReceiving(null);
    setName('');
  }

  if (!items.length)
    return <p className="text-center py-10 text-gray-400">Nessun materiale in attesa</p>;

  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1">
            <p className="font-medium text-gray-800">{item.materiale}</p>
            <p className="text-sm text-gray-500">
              {item.mezzo}
              {item.commessa && <> · {item.commessa}</>}
              {' · '}{item.inseritoDa}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {item.orarioArrivo} · ins: {item.timestampInserimento}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {receiving === item.id ? (
              <>
                <input
                  className="input w-36"
                  placeholder="Ricevuto da..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirm(item.id)}
                  autoFocus
                />
                <button className="btn-primary text-sm" onClick={() => confirm(item.id)}>Conferma</button>
                <button className="btn-secondary text-sm" onClick={() => { setReceiving(null); setName(''); }}>Annulla</button>
              </>
            ) : (
              <button className="btn-primary text-sm" onClick={() => setReceiving(item.id)}>✓ Arrivato</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Storico Table ────────────────────────────────────────────────────────────

function StoricoTable({ items }: { items: IngressoMerciStorico[] }) {
  if (!items.length)
    return <p className="text-gray-400 text-center py-6">Storico vuoto</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            {['Materiale','Mezzo','Commessa','Arrivo','Ricevuto da','Ricezione'].map(h => (
              <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 pr-4 font-medium">{item.materiale}</td>
              <td className="py-2 pr-4 text-gray-600">{item.mezzo}</td>
              <td className="py-2 pr-4 text-gray-600">{item.commessa ?? '—'}</td>
              <td className="py-2 pr-4 text-gray-600">{item.orarioArrivo}</td>
              <td className="py-2 pr-4 font-medium">{item.ricevutoDa}</td>
              <td className="py-2 text-gray-400 text-xs">{item.timestampRicezione}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function IngressoMerciView() {
  const [items,   setItems]   = useState<IngressoMerci[]>([]);
  const [storico, setStorico] = useState<IngressoMerciStorico[]>([]);
  const [tab,     setTab]     = useState<'active' | 'storico'>('active');
  const [error,   setError]   = useState('');

  async function fetchActive() {
    try { setItems(await api.get<IngressoMerci[]>('/api/ingresso-merci')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Errore'); }
  }

  async function fetchStorico() {
    try { setStorico(await api.get<IngressoMerciStorico[]>('/api/ingresso-merci/storico')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Errore storico'); }
  }

  useEffect(() => { fetchActive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReceived(id: number, ricevutoDa: string) {
    try {
      await api.post(`/api/ingresso-merci/${id}/arrivato`, { ricevutoDa });
      await fetchActive();
      if (tab === 'storico') await fetchStorico();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore conferma');
    }
  }

  async function switchTab(t: 'active' | 'storico') {
    setTab(t);
    if (t === 'storico' && !storico.length) await fetchStorico();
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ingresso Merci</h1>
          <p className="text-gray-500 mt-1">Gestione ricezione materiali</p>
        </div>
        <Link
          href="/ingresso-merci/tablet"
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <circle cx="12" cy="18" r="1" />
          </svg>
          Modalità Tablet
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex justify-between">
          {error}
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}

      <AddForm onAdded={fetchActive} />

      <div className="flex gap-4 mb-4 border-b border-gray-200">
        {(['active', 'storico'] as const).map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-gray-800 text-gray-800' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'active' ? `In attesa (${items.length})` : 'Storico'}
          </button>
        ))}
      </div>

      {tab === 'active'
        ? <ActiveList items={items} onReceived={handleReceived} />
        : <div className="card"><StoricoTable items={storico} /></div>
      }
    </div>
  );
}
