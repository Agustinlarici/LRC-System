'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const STATUS_LABELS: Record<string, string> = {
  aperto:                  'Aperto',
  in_lavorazione:          'In lavorazione',
  in_attesa:               'In attesa',
  in_attesa_approvazione:  'In attesa di approvazione',
  risolto:                 'Risolto',
  chiuso:                  'Chiuso',
  riaperto:                'Riaperto',
};
const STATUS_COLORS: Record<string, string> = {
  aperto:                  'bg-blue-100 text-blue-800',
  in_lavorazione:          'bg-yellow-100 text-yellow-800',
  in_attesa:               'bg-gray-100 text-gray-700',
  in_attesa_approvazione:  'bg-purple-100 text-purple-700',
  risolto:                 'bg-green-100 text-green-800',
  chiuso:                  'bg-gray-200 text-gray-600',
  riaperto:                'bg-orange-100 text-orange-800',
};
const PRIORITY_LABELS: Record<string, string> = {
  bassa: 'Bassa', media: 'Media', alta: 'Alta', critica: 'Critica',
};
const PRIORITY_COLORS: Record<string, string> = {
  bassa:   'bg-green-100 text-green-700',
  media:   'bg-yellow-100 text-yellow-700',
  alta:    'bg-orange-100 text-orange-700',
  critica: 'bg-red-100 text-red-700',
};
const ACTION_LABELS: Record<string, string> = {
  creato:            'Ticket creato',
  assegnato:         'Assegnato',
  stato_cambiato:    'Stato aggiornato',
  priorita_cambiata: 'Priorità aggiornata',
  commentato:        'Commento',
  risolto:           'Risolto',
  chiuso:            'Chiuso',
  riaperto:          'Riaperto',
  allegato_aggiunto: 'Allegato aggiunto',
  approvato:         'Approvato',
};

type Ticket = {
  id: number;
  ticket_number: string;
  title: string;
  description: string;
  caller_name: string;
  caller_email: string | null;
  department_name: string | null;
  category: string | null;
  subcategory: string | null;
  blocca_lavoro: boolean;
  status: string;
  priority: string;
  assigned_to_name: string | null;
  resolution_note: string | null;
  reopen_count: number;
  created_at: string;
  sla_response_due: string | null;
  sla_resolution_due: string | null;
};
type HistoryEntry = {
  action: string;
  changed_by_name: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  created_at: string;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TicketStatoPage() {
  const { number } = useParams<{ number: string }>();
  const [ticket,  setTicket]  = useState<Ticket | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!number) return;
    // Pass number without # — backend accepts both forms
    const ticketNum = number.replace(/^#/, '');
    fetch(`${BACKEND}/api/tickets/numero/${ticketNum}`)
      .then(async r => {
        if (!r.ok) { setError('Ticket non trovato'); return; }
        const data = await r.json();
        setTicket(data);
        setHistory(data.history ?? []);
      })
      .catch(() => setError('Errore di connessione'))
      .finally(() => setLoading(false));
  }, [number]);

  if (loading) return <div className="text-sm text-gray-500 p-6">Caricamento…</div>;
  if (error)   return (
    <div className="max-w-lg mx-auto">
      <div className="card text-center py-10">
        <p className="text-lg font-semibold text-gray-700">Ticket non trovato</p>
        <p className="text-sm text-gray-500 mt-2">{error}</p>
        <a href="/tickets/stato" className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Cerca un altro ticket</a>
      </div>
    </div>
  );
  if (!ticket) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{ticket.ticket_number}</h1>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[ticket.status] ?? 'bg-gray-100 text-gray-700'}`}>
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[ticket.priority] ?? 'bg-gray-100'}`}>
            {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
          </span>
          {ticket.blocca_lavoro && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">Blocca lavoro</span>
          )}
        </div>
        <p className="text-lg text-gray-800 mt-2">{ticket.title}</p>
        <p className="text-xs text-gray-400 mt-1">Aperto il {fmt(ticket.created_at)} da {ticket.caller_name}</p>
      </div>

      {/* Details */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Dettagli</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {ticket.department_name && (
            <><dt className="text-gray-500">Reparto</dt><dd className="text-gray-800">{ticket.department_name}</dd></>
          )}
          {ticket.category && (
            <><dt className="text-gray-500">Categoria</dt><dd className="text-gray-800">{ticket.category}{ticket.subcategory ? ` / ${ticket.subcategory}` : ''}</dd></>
          )}
          {ticket.assigned_to_name && (
            <><dt className="text-gray-500">Assegnato a</dt><dd className="text-gray-800">{ticket.assigned_to_name}</dd></>
          )}
          {ticket.sla_resolution_due && (
            <><dt className="text-gray-500">Scadenza SLA</dt><dd className="text-gray-800">{fmt(ticket.sla_resolution_due)}</dd></>
          )}
        </dl>
        <div className="pt-2 border-t border-gray-100">
          <p className="text-sm text-gray-500 font-medium mb-1">Descrizione</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.description}</p>
        </div>
        {ticket.resolution_note && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm text-green-700 font-medium mb-1">Nota di risoluzione</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.resolution_note}</p>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide mb-4">Storico</h2>
          <ol className="relative border-l border-gray-200 space-y-4 ml-2">
            {history.map((h, i) => (
              <li key={i} className="ml-4">
                <div className="absolute w-2.5 h-2.5 bg-gray-300 rounded-full -left-1.5 border-2 border-white" />
                <p className="text-xs text-gray-400">{fmt(h.created_at)}</p>
                <p className="text-sm font-medium text-gray-700">{ACTION_LABELS[h.action] ?? h.action}</p>
                {h.note && <p className="text-sm text-gray-600 mt-0.5">{h.note}</p>}
                {h.old_value && h.new_value && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="line-through">{h.old_value}</span> → <span>{h.new_value}</span>
                  </p>
                )}
                {h.changed_by_name && <p className="text-xs text-gray-400 mt-0.5">— {h.changed_by_name}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-center text-sm">
        <a href="/tickets/stato" className="text-blue-600 hover:underline">← Cerca un altro ticket</a>
      </p>
    </div>
  );
}
