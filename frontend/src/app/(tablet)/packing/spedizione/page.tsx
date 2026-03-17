'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Destination { id: number; name: string; }

export default function SpedizionePage() {
  const router = useRouter();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Destination[]>('/api/pack/dispatch-destinations')
      .then(setDestinations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(dest: Destination) {
    const operatorId = localStorage.getItem('pack_operator_id');

    // Clear previous session data for this operator
    localStorage.removeItem(`pack_dispatch_id_${operatorId}`);
    localStorage.removeItem(`pack_session_id_${operatorId}`);
    localStorage.removeItem(`pack_data_${operatorId}`);

    localStorage.setItem('pack_destination_id', String(dest.id));
    localStorage.setItem('pack_destination_name', dest.name);

    router.push('/packing/scan');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Seleziona spedizione</h1>

      {loading ? (
        <p className="text-gray-400">Caricamento...</p>
      ) : destinations.length === 0 ? (
        <p className="text-gray-400">Nessuna destinazione configurata.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-xl">
          {destinations.map(dest => (
            <button
              key={dest.id}
              onClick={() => handleSelect(dest)}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center font-semibold text-gray-800 text-lg hover:bg-gray-50 hover:shadow-md transition-all active:scale-95"
            >
              {dest.name}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => router.push('/packing/operatore')}
        className="mt-8 text-sm text-gray-400 hover:text-gray-600"
      >
        ← Cambia operatore
      </button>
    </div>
  );
}
