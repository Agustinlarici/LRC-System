'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { NuovaSegnalazioneFlow } from './NuovaSegnalazioneFlow';

export default function NuovaSegnalazionePage() {
  useEffect(() => { document.title = 'Nuova segnalazione — Qualità'; }, []);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nuova segnalazione</h1>
          <p className="text-sm text-gray-500 mt-1">Segnala un difetto disegnando direttamente sull'immagine del componente</p>
        </div>
        <Link
          href="/qualita/tablet/nuova"
          className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
            <rect x="5" y="2" width="14" height="20" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="18" r="0.5" fill="currentColor" />
          </svg>
          Modalità Tablet
        </Link>
      </div>

      <NuovaSegnalazioneFlow tablet />
    </div>
  );
}
