'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Operator { id: number; name: string; }

export default function OperatoreSelectionPage() {
  const router = useRouter();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Operator[]>('/api/pack/operators')
      .then(setOperators)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(op: Operator) {
    localStorage.setItem('pack_operator_id', String(op.id));
    localStorage.setItem('pack_operator_name', op.name);
    router.push('/packing/spedizione');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Seleziona magazziniere</h1>

      {loading ? (
        <p className="text-gray-400">Caricamento...</p>
      ) : operators.length === 0 ? (
        <p className="text-gray-400">Nessun operatore trovato.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-xl">
          {operators.map(op => (
            <button
              key={op.id}
              onClick={() => handleSelect(op)}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center font-semibold text-gray-800 text-lg hover:bg-gray-50 hover:shadow-md transition-all active:scale-95"
            >
              {op.name}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => router.push('/packing')}
        className="mt-8 text-sm text-gray-400 hover:text-gray-600"
      >
        ← Torna al menu
      </button>
    </div>
  );
}
