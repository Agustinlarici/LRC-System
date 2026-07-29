'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NuovaSegnalazioneFlow } from './NuovaSegnalazioneFlow';

export default function NuovaSegnalazionePage() {
  const router = useRouter();
  useEffect(() => { document.title = 'Nuova segnalazione — Qualità'; }, []);

  // Fullscreen richiesto in modo sincrono nello stesso click, altrimenti il browser
  // lo rifiuta (serve l'attivazione utente diretta).
  function enterTabletMode(e: React.MouseEvent) {
    e.preventDefault();
    document.documentElement.requestFullscreen().catch(() => {});
    router.push('/qualita/tablet/nuova');
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nuova segnalazione</h1>
          <p className="text-sm text-gray-500 mt-1">Segnala un difetto disegnando direttamente sull'immagine del componente</p>
        </div>
        <a
          href="/qualita/tablet/nuova"
          onClick={enterTabletMode}
          className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
            <rect x="5" y="2" width="14" height="20" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="18" r="0.5" fill="currentColor" />
          </svg>
          Modalità Tablet
        </a>
      </div>

      <NuovaSegnalazioneFlow tablet />
    </div>
  );
}
