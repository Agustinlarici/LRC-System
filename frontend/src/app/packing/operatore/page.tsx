'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Operatore { id: number; name: string; }
interface Destinazione { id: number; name: string; }

export default function OperatorePage() {
  const router = useRouter();

  const [operatori,    setOperatori]    = useState<Operatore[]>([]);
  const [destinazioni, setDestinazioni] = useState<Destinazione[]>([]);
  const [selOp,        setSelOp]        = useState<Operatore | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [avvio,        setAvvio]        = useState(false);
  const [errore,       setErrore]       = useState('');

  useEffect(() => { document.title = 'Packing — STR'; }, []);

  useEffect(() => {
    Promise.allSettled([
      api.get<Operatore[]>('/api/pack/operators'),
      api.get<Destinazione[]>('/api/pack/dispatch-destinations'),
    ]).then(([opsResult, destsResult]) => {
      if (opsResult.status   === 'fulfilled') setOperatori(opsResult.value);
      if (destsResult.status === 'fulfilled') setDestinazioni(destsResult.value);
      if (opsResult.status === 'rejected' || destsResult.status === 'rejected') {
        setErrore('Alcuni dati non sono stati caricati. Riprova.');
      }
    }).finally(() => setLoading(false));
  }, []);

  async function selezionaDestinazione(dest: Destinazione) {
    if (!selOp || avvio) return;
    setAvvio(true);
    setErrore('');
    try {
      const { sessionId } = await api.post<{ sessionId: number }>('/api/pack/sessions', { operatorId: selOp.id });
      const { dispatchId } = await api.post<{ dispatchId: number }>('/api/pack/dispatches', {
        type: dest.name,
        destinationId: dest.id,
      });
      const { palletId } = await api.post<{ palletId: number; number: number }>('/api/pack/pallets', {
        dispatchId,
        sessionId,
      });
      router.push(`/packing/scan?dispatch=${dispatchId}&session=${sessionId}&pallet=${palletId}&operator=${encodeURIComponent(selOp.name)}&destination=${encodeURIComponent(dest.name)}`);
    } catch {
      setErrore('Errore durante l\'avvio della sessione');
      setAvvio(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 animate-spin text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
      </div>
    );
  }

  // ── STEP 1: Seleziona magazziniere ───────────────────────────────────────────

  if (!selOp) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-8">
          Seleziona magazziniere
        </h2>

        {errore && (
          <p className="mb-6 text-red-600 text-center">{errore}</p>
        )}

        <div className="w-full max-w-2xl grid grid-cols-2 sm:grid-cols-3 gap-4">
          {operatori.map(op => (
            <button
              key={op.id}
              onClick={() => setSelOp(op)}
              className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center font-semibold text-gray-800 text-lg hover:bg-gray-50 hover:shadow-md transition-all active:scale-95 cursor-pointer"
            >
              {op.name}
            </button>
          ))}
        </div>

        {operatori.length === 0 && (
          <p className="text-gray-400 mt-6">Nessun operatore configurato</p>
        )}
      </div>
    );
  }

  // ── STEP 2: Seleziona spedizione ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <h2 className="text-3xl font-bold text-gray-900 text-center mb-2">
        Seleziona spedizione
      </h2>
      <p className="text-gray-500 text-sm mb-8">Magazziniere: <span className="font-medium text-gray-700">{selOp.name}</span></p>

      {errore && (
        <p className="mb-6 text-red-600 text-center">{errore}</p>
      )}

      <div className="w-full max-w-2xl grid grid-cols-2 sm:grid-cols-3 gap-4">
        {destinazioni.map(dest => (
          <button
            key={dest.id}
            onClick={() => selezionaDestinazione(dest)}
            disabled={avvio}
            className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center font-semibold text-gray-800 text-lg hover:bg-gray-50 hover:shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {dest.name}
          </button>
        ))}
      </div>

      {destinazioni.length === 0 && (
        <p className="text-gray-400 mt-6">Nessuna destinazione configurata</p>
      )}

      <button
        onClick={() => { setSelOp(null); setErrore(''); }}
        className="mt-8 text-gray-400 hover:text-gray-600 text-sm transition-colors"
      >
        ← Cambia operatore
      </button>
    </div>
  );
}
