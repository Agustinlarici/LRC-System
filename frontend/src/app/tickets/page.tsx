'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function TicketsPage() {
  const { user, canView, canManage } = useAuth();

  const options = [
    {
      href:        '/tickets/nuovo',
      title:       'Apri un ticket',
      description: 'Segnala un problema informatico o richiedi assistenza',
      icon:        '🎫',
      show:        true,
    },
    {
      href:        '/tickets/stato',
      title:       'Controlla stato ticket',
      description: 'Verifica lo stato di avanzamento di una segnalazione',
      icon:        '🔍',
      show:        true,
    },
    {
      href:        '/tickets/miei',
      title:       'I miei ticket',
      description: 'Le segnalazioni che hai aperto tu',
      icon:        '📋',
      show:        !!user && user.role !== 'guest',
    },
    {
      href:        '/tickets/dashboard',
      title:       'Dashboard IT',
      description: 'Gestisci e prendi in carico le segnalazioni ricevute',
      icon:        '🖥️',
      show:        canView('tickets_it'),
    },
    {
      href:        '/tickets/impostazioni',
      title:       'Impostazioni',
      description: 'Categorie, reparti, SLA e priorità automatiche',
      icon:        '⚙️',
      show:        canManage('tickets_admin'),
    },
  ].filter(o => o.show);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Ticket IT</h1>
        <p className="mt-1 text-gray-500">Supporto informatico e segnalazioni</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className="card group hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{opt.icon}</span>
              <div>
                <h2 className="font-semibold text-gray-800 group-hover:text-blue-600">{opt.title}</h2>
                <p className="text-sm text-gray-500 mt-1">{opt.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
