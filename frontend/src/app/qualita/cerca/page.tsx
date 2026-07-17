'use client';

import { useEffect } from 'react';
import { CercaFlow } from './CercaFlow';

export default function CercaQualitaPage() {
  useEffect(() => { document.title = 'Cerca — Qualità'; }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cerca segnalazioni</h1>
        <p className="text-sm text-gray-500 mt-1">Cerca per commessa e componente, confronta le segnalazioni nel tempo</p>
      </div>
      <CercaFlow />
    </div>
  );
}
