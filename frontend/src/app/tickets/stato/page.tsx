'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Ticket = {
  id: number;
  ticket_number: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  status: string;
  priority: string;
  assigned_to_name: string | null;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  aperto: 'Aperto', in_lavorazione: 'In lavorazione', in_attesa: 'In attesa',
  in_attesa_approvazione: 'In attesa di approvazione',
  risolto: 'Risolto', chiuso: 'Chiuso', riaperto: 'Riaperto',
};
const STATUS_COLORS: Record<string, string> = {
  aperto: 'bg-blue-100 text-blue-800', in_lavorazione: 'bg-yellow-100 text-yellow-800',
  in_attesa: 'bg-gray-100 text-gray-700', in_attesa_approvazione: 'bg-purple-100 text-purple-700',
  risolto: 'bg-green-100 text-green-800',
  chiuso: 'bg-gray-200 text-gray-600', riaperto: 'bg-orange-100 text-orange-800',
};
const PRIORITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta', critica: 'Critica' };
const PRIORITY_COLORS: Record<string, string> = {
  bassa: 'bg-green-100 text-green-700', media: 'bg-yellow-100 text-yellow-700',
  alta: 'bg-orange-100 text-orange-700', critica: 'bg-red-100 text-red-700',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

async function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
}

export default function StatoTicketSearchPage() {
  const router  = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [number, setNumber] = useState('');

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError,   setTicketsError]   = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role === 'guest') { setTicketsLoading(false); return; }
    apiFetch('/api/tickets/mine')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(data => setTickets(Array.isArray(data) ? data : []))
      .catch(() => setTicketsError('Errore nel caricamento dei tuoi ticket'))
      .finally(() => setTicketsLoading(false));
  }, [authLoading, user]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Strip leading # so URL is clean: /tickets/stato/TK-2026-0001
    const clean = number.trim().toUpperCase().replace(/^#/, '');
    router.push(`/tickets/stato/${clean}`);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Controlla stato ticket</h1>
          <p className="text-sm text-gray-500 mt-1">Inserisci il numero del ticket ricevuto al momento della segnalazione</p>
        </div>
        <form onSubmit={handleSubmit} className="card flex items-end gap-3">
          <div className="flex-1">
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
            className="bg-blue-600 text-white rounded-lg px-6 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Cerca
          </button>
        </form>
      </div>

      {!authLoading && user && user.role !== 'guest' && (
        <div>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">I miei ticket</h2>
            <p className="text-sm text-gray-500 mt-0.5">Tutte le segnalazioni di {user.display_name}, con quelle aperte in cima</p>
          </div>

          <div className="card">
            {ticketsLoading ? (
              <p className="text-sm text-gray-400 py-8 text-center">Caricamento…</p>
            ) : ticketsError ? (
              <p className="text-sm text-red-600 py-8 text-center">{ticketsError}</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Non hai ancora aperto nessun ticket</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-base border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-sm text-gray-500 uppercase tracking-wide">
                      <th className="pb-3 pr-4 font-medium">Numero</th>
                      <th className="pb-3 pr-4 font-medium">Titolo</th>
                      <th className="pb-3 pr-4 font-medium">Categoria</th>
                      <th className="pb-3 pr-4 font-medium">Stato</th>
                      <th className="pb-3 pr-4 font-medium">Priorità</th>
                      <th className="pb-3 pr-4 font-medium">Assegnato</th>
                      <th className="pb-3 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => router.push(`/tickets/stato/${t.ticket_number.replace(/^#/, '')}`)}
                        className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 pr-4 font-mono text-sm text-gray-600">{t.ticket_number}</td>
                        <td className="py-3.5 pr-4 max-w-64">
                          <span className="block truncate text-gray-800">{t.title}</span>
                        </td>
                        <td className="py-3.5 pr-4 text-gray-500 text-sm">
                          {t.category ? `${t.category}${t.subcategory ? ` / ${t.subcategory}` : ''}` : '—'}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[t.status] ?? ''}`}>{STATUS_LABELS[t.status] ?? t.status}</span>
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[t.priority] ?? ''}`}>{PRIORITY_LABELS[t.priority] ?? t.priority}</span>
                        </td>
                        <td className="py-3.5 pr-4 text-sm text-gray-500">{t.assigned_to_name ?? <span className="text-gray-300">—</span>}</td>
                        <td className="py-3.5 text-sm text-gray-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
