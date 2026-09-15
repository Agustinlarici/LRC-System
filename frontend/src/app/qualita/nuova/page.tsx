'use client';

import { useEffect } from 'react';
import { NuovaSegnalazioneFlow } from './NuovaSegnalazioneFlow';
import { FullscreenButton } from '../FullscreenButton';

export default function NuovaSegnalazionePage() {
  useEffect(() => { document.title = 'Nuova segnalazione — Qualità'; }, []);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nuova segnalazione</h1>
          <p className="text-sm text-gray-500 mt-1">Segnala un difetto disegnando direttamente sull'immagine del componente</p>
        </div>
        <FullscreenButton href="/qualita/tablet/nuova" />
      </div>

      <NuovaSegnalazioneFlow tablet />
    </div>
  );
}
