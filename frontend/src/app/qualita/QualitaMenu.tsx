'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const options = [
  {
    href:        '/qualita/nuova',
    title:       'Nuova segnalazione',
    icon:        '✏️',
    needsManage: false,
  },
  {
    href:        '/qualita/cerca',
    title:       'Cerca',
    icon:        '🔍',
    needsManage: false,
  },
  {
    href:        '/qualita/impostazioni',
    title:       'Impostazioni',
    icon:        '⚙️',
    needsManage: true,
  },
];

export function QualitaMenu() {
  const { canManage } = useAuth();

  const visible = options.filter(o => !o.needsManage || canManage('qualita'));

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
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
