'use client';

import { useEffect } from 'react';
import Link from 'next/link';

const FABBRICHE = [
  {
    href:        '/mappa/maranello',
    nome:        'Maranello',
    descrizione: 'Vista grafica dello stato delle linee sul piano fabbrica',
    attivo:      true,
  },
];

export default function MappaPage() {
  useEffect(() => { document.title = 'Mappa Fabbrica — STR'; }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Mappa Fabbrica</h1>
        <Link href="/mappa/impostazioni" className="btn-primary text-sm">Impostazioni</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FABBRICHE.map(f => (
          <Link
            key={f.href}
            href={f.href}
            target="_blank"
            className="card hover:shadow-md transition-shadow cursor-pointer block"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xl font-bold text-gray-800">{f.nome}</span>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Attivo</span>
            </div>
            <div className="text-sm text-gray-500">{f.descrizione}</div>
            <div className="mt-3 text-xs text-blue-600">Apri mappa →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
