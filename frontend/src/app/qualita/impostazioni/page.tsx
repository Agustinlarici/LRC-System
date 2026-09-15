'use client';

import { useEffect } from 'react';
import { ImpostazioniFlow } from './ImpostazioniFlow';
import { FullscreenButton } from '../FullscreenButton';

export default function QualitaImpostazioniPage() {
  useEffect(() => { document.title = 'Impostazioni Qualità — STR'; }, []);

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Impostazioni Qualità</h1>
          <p className="mt-1 text-gray-500">Gestisci il catalogo componenti e le immagini di riferimento</p>
        </div>
        <FullscreenButton href="/qualita/tablet/impostazioni" />
      </div>
      <ImpostazioniFlow />
    </div>
  );
}
