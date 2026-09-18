'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { IconTicket, IconSearch, IconList, IconSettings } from '@/components/icons/ModuleIcons';

export default function TicketsPage() {
  const { canView, canManage } = useAuth();

  const options = [
    {
      href:        '/tickets/nuovo',
      title:       'Apri un ticket',
      description: 'Segnala un problema informatico o richiedi assistenza',
      Icon:        IconTicket,
      show:        true,
    },
    {
      href:        '/tickets/stato',
      title:       'Controlla stato ticket',
      description: 'Verifica lo stato di avanzamento di una segnalazione e i tuoi ticket',
      Icon:        IconSearch,
      show:        true,
    },
    {
      href:        '/tickets/dashboard',
      title:       'Gestione ticket',
      description: 'Gestisci e prendi in carico le segnalazioni ricevute',
      Icon:        IconList,
      show:        canView('tickets_it'),
    },
    {
      href:        '/tickets/impostazioni',
      title:       'Impostazioni',
      description: 'Categorie, reparti, SLA e priorità automatiche',
      Icon:        IconSettings,
      show:        canManage('tickets_admin'),
    },
  ].filter(o => o.show);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Ticket IT</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className="card group hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-blue-50 text-blue-600 shrink-0 group-hover:bg-blue-100 transition-colors">
                <opt.Icon className="w-6 h-6" />
              </span>
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
