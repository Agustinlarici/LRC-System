'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const SHAPES = [
  { tag: 'F171VS' }, { tag: 'F173M' }, { tag: 'F171' },
  { tag: 'F175' },   { tag: 'F169' },  { tag: 'F167' },
  { tag: 'DELIBERA' }, { tag: 'ATC3' }, { tag: '8CIL' },
];

interface ShapeMonitor { shape_tag: string; monitor_id: number; monitor_nome: string; }
interface ShapeBuffer  { shape_tag: string; buffer_id:  number; buffer_nome:  string; }
interface Linea        { id: number; nome: string; }

export default function MappaImpostazioniPage() {
  const [monitorMappings, setMonitorMappings] = useState<ShapeMonitor[]>([]);
  const [bufferMappings,  setBufferMappings]  = useState<ShapeBuffer[]>([]);
  const [monitorLinee,    setMonitorLinee]    = useState<Linea[]>([]);
  const [bufferLinee,     setBufferLinee]     = useState<Linea[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState<string | null>(null);
  const [error,           setError]           = useState('');

  useEffect(() => { document.title = 'Impostazioni Mappa — STR'; }, []);

  useEffect(() => {
    async function load() {
      const [mMappings, bMappings, mLinee, bLinee] = await Promise.allSettled([
        api.get<ShapeMonitor[]>('/api/mappa/shape-monitors'),
        api.get<ShapeBuffer[]>('/api/mappa/shape-buffers'),
        api.get<Linea[]>('/api/monitor/linee'),
        api.get<Linea[]>('/api/buffer'),
      ]);
      if (mMappings.status === 'fulfilled') setMonitorMappings(mMappings.value);
      if (bMappings.status === 'fulfilled') setBufferMappings(bMappings.value);
      if (mLinee.status    === 'fulfilled') setMonitorLinee(mLinee.value);
      if (bLinee.status    === 'fulfilled') setBufferLinee(bLinee.value);
      setLoading(false);
    }
    load();
  }, []);

  function getCurrentValue(tag: string): string {
    const m = monitorMappings.find(x => x.shape_tag === tag);
    if (m) return `m:${m.monitor_id}`;
    const b = bufferMappings.find(x => x.shape_tag === tag);
    if (b) return `b:${b.buffer_id}`;
    return '';
  }

  async function handleChange(tag: string, value: string) {
    setSaving(tag);
    setError('');
    try {
      if (value === '') {
        await Promise.allSettled([
          api.delete(`/api/mappa/shape-monitor/${encodeURIComponent(tag)}`),
          api.delete(`/api/mappa/shape-buffer/${encodeURIComponent(tag)}`),
        ]);
        setMonitorMappings(prev => prev.filter(m => m.shape_tag !== tag));
        setBufferMappings(prev  => prev.filter(b => b.shape_tag !== tag));
      } else if (value.startsWith('m:')) {
        const monitorId = parseInt(value.slice(2), 10);
        await api.post('/api/mappa/shape-monitor', { shape_tag: tag, monitor_id: monitorId });
        const linea = monitorLinee.find(l => l.id === monitorId);
        setMonitorMappings(prev => [...prev.filter(m => m.shape_tag !== tag), { shape_tag: tag, monitor_id: monitorId, monitor_nome: linea?.nome ?? '' }]);
        setBufferMappings(prev => prev.filter(b => b.shape_tag !== tag));
      } else if (value.startsWith('b:')) {
        const bufferId = parseInt(value.slice(2), 10);
        await api.post('/api/mappa/shape-buffer', { shape_tag: tag, buffer_id: bufferId });
        const linea = bufferLinee.find(l => l.id === bufferId);
        setBufferMappings(prev => [...prev.filter(b => b.shape_tag !== tag), { shape_tag: tag, buffer_id: bufferId, buffer_nome: linea?.nome ?? '' }]);
        setMonitorMappings(prev => prev.filter(m => m.shape_tag !== tag));
      }
    } catch {
      setError('Errore durante il salvataggio.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mappa — Impostazioni</h1>
          <p className="text-sm text-gray-500 mt-1">Associa ogni area della mappa a un monitor (Andon) o a un buffer</p>
        </div>
        <Link href="/mappa" className="btn-secondary text-sm">← Torna alla mappa</Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="py-3 px-4 text-left font-medium text-gray-600">Area mappa</th>
              <th className="py-3 px-4 text-left font-medium text-gray-600">Assegnazione</th>
              <th className="py-3 px-4 w-20 text-center font-medium text-gray-600">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {SHAPES.map((shape, i) => {
              const currentVal = getCurrentValue(shape.tag);
              const isSaving   = saving === shape.tag;
              const isMonitor  = currentVal.startsWith('m:');
              const isBuffer   = currentVal.startsWith('b:');
              return (
                <tr key={shape.tag} className={`border-b border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50'}`}>
                  <td className="py-3 px-4">
                    <span className="font-mono font-semibold text-gray-800">{shape.tag}</span>
                  </td>
                  <td className="py-3 px-4">
                    {loading ? (
                      <span className="text-gray-400 text-xs">Caricamento...</span>
                    ) : (
                      <select
                        value={currentVal}
                        onChange={e => handleChange(shape.tag, e.target.value)}
                        disabled={isSaving}
                        className="input w-full max-w-xs text-sm disabled:opacity-50"
                      >
                        <option value="">— Non configurato —</option>
                        {monitorLinee.length > 0 && (
                          <optgroup label="Andon">
                            {monitorLinee.map(l => (
                              <option key={`m:${l.id}`} value={`m:${l.id}`}>{l.nome}</option>
                            ))}
                          </optgroup>
                        )}
                        {bufferLinee.length > 0 && (
                          <optgroup label="Buffer">
                            {bufferLinee.map(l => (
                              <option key={`b:${l.id}`} value={`b:${l.id}`}>{l.nome}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {isSaving ? (
                      <span className="text-blue-500 text-xs">...</span>
                    ) : isMonitor ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold" title="Andon">A</span>
                    ) : isBuffer ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold" title="Buffer">B</span>
                    ) : (
                      <span className="inline-block w-3 h-3 rounded-full bg-gray-300" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
        <span className="font-semibold">A</span> = Andon (colore basato sul ritmo di produzione) ·
        <span className="font-semibold ml-2">B</span> = Buffer (colore basato sulle soglie, mostra il conteggio seriali)
      </div>
    </div>
  );
}
