'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { TabletShell } from './TabletShell';

const options = [
  {
    href:        '/qualita/tablet/nuova',
    title:       'Nuova segnalazione',
    description: 'Segna un difetto disegnando sull\'immagine del componente',
    icon:        '✏️',
    needsManage: false,
  },
  {
    href:        '/qualita/tablet/cerca',
    title:       'Cerca',
    description: 'Cerca per commessa e componente, confronta le segnalazioni',
    icon:        '🔍',
    needsManage: false,
  },
  {
    href:        '/qualita/tablet/impostazioni',
    title:       'Impostazioni',
    description: 'Gestisci il catalogo componenti e le immagini di riferimento',
    icon:        '⚙️',
    needsManage: true,
  },
];

function TabletMenu() {
  const { canManage } = useAuth();
  const visible = options.filter(o => !o.needsManage || canManage('qualita'));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {visible.map((opt) => (
        <Link
          key={opt.href}
          href={opt.href}
          className="card group hover:shadow-md hover:border-blue-300 transition-shadow text-center py-10"
        >
          <span className="text-5xl block mb-4">{opt.icon}</span>
          <h2 className="font-semibold text-lg text-gray-800 group-hover:text-blue-600">{opt.title}</h2>
          <p className="text-sm text-gray-500 mt-2">{opt.description}</p>
        </Link>
      ))}
    </div>
  );
}

export default function QualitaTabletHubPage() {
  useEffect(() => { document.title = 'Qualità — Tablet'; }, []);

  return (
    <TabletShell title="Qualità" backHref="/qualita" backLabel="Esci dalla modalità tablet">
      <TabletMenu />
    </TabletShell>
  );
}
