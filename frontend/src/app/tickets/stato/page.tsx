'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StatoTicketSearchPage() {
  const router  = useRouter();
  const [number, setNumber] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Strip leading # so URL is clean: /tickets/stato/TK-2026-0001
    const clean = number.trim().toUpperCase().replace(/^#/, '');
    router.push(`/tickets/stato/${clean}`);
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Controlla stato ticket</h1>
        <p className="text-sm text-gray-500 mt-1">Inserisci il numero del ticket ricevuto al momento della segnalazione</p>
      </div>
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Numero ticket</label>
          <input
            type="text"
            value={number}
            onChange={e => setNumber(e.target.value)}
            required
            placeholder="#TK-2025-0001"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          Cerca
        </button>
      </form>
    </div>
  );
}
