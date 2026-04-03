'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const options = [
  {
    href:        '/packing/operatore',
    title:       'Crea Packing List',
    description: 'Avvia una nuova sessione di scansione',
    icon:        '📦',
    needsManage: false,
  },
  {
    href:        '/packing/liste',
    title:       'Consulta Packing Lists',
    description: 'Visualizza, stampa e modifica le spedizioni',
    icon:        '🔍',
    needsManage: false,
  },
  {
    href:        '/packing/impostazioni',
    title:       'Impostazioni',
    description: 'Gestisci magazzinieri e destinazioni',
    icon:        '⚙️',
    needsManage: true,
  },
];

export function PackingMenu() {
  const { canManage } = useAuth();

  const visible = options.filter(o => !o.needsManage || canManage('packing'));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {visible.map((opt) => (
        <Link
          key={opt.href}
          href={opt.href}
          className="card group hover:shadow-md transition-shadow cursor-pointer"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">{opt.icon}</span>
            <div>
              <h2 className="font-semibold text-gray-800 group-hover:text-blue-600">
                {opt.title}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{opt.description}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
