'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProdArea, ProdComponentConflict } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';

export default function ProduzionePage() {
  const [aree,        setAree]        = useState<ProdArea[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [hasUrgentDup, setHasUrgentDup] = useState(false);

  useEffect(() => {
    api.get<ProdArea[]>('/api/prod/aree')
      .then(setAree)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));

    // Solo per colorare il bottone "Duplicati" in rosso quando c'è almeno un
    // gruppo con candidati registrati/scansionati lo stesso giorno (il caso
    // più probabile di doppione — vedi /produzione/conflitti). Silenzioso in
    // caso di errore/timeout: non è critico per questa pagina.
    api.get<ProdComponentConflict[]>('/api/prod/component-conflicts', 60_000)
      .then(list => setHasUrgentDup(list.some(c => c.candidates.some(cand => cand.stesso_giorno_altro_codice))))
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title="Programma Produzione"
        description="Fogli di produzione per area di montaggio."
        actions={
          <>
            <Button href="/spma/import">Import Planning</Button>
            <Button
              href="/produzione/conflitti"
              className={hasUrgentDup ? '!bg-danger-soft !text-danger !border-transparent hover:!bg-red-200' : ''}
            >
              Duplicati
            </Button>
            <Button href="/produzione/sync" variant="primary">Sincronizza</Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-danger-soft text-danger rounded-ctl text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-muted">Caricamento aree...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          <Link
            href="/produzione/tutto"
            className="group flex items-center justify-between gap-3 bg-ink-800 rounded-card p-5 text-white shadow-card transition-all hover:bg-ink-950 hover:-translate-y-0.5"
          >
            <span>
              <span className="block font-semibold">Vedi tutto</span>
              <span className="block text-xs text-stone-300 mt-1">Foglio completo, senza filtro per area</span>
            </span>
            <span aria-hidden className="flex items-center justify-center w-9 h-9 rounded-full bg-brand text-white shrink-0">→</span>
          </Link>
          {aree.map(area => (
            <Link
              key={area.id}
              href={`/produzione/${area.id}`}
              className="group flex items-center justify-between gap-3 bg-white rounded-card shadow-card p-5 transition-all hover:shadow-float hover:-translate-y-0.5"
            >
              <span className="font-semibold text-ink-900">{area.description}</span>
              <span aria-hidden className="flex items-center justify-center w-9 h-9 rounded-full bg-stone-100 text-ink-800 shrink-0 transition-colors group-hover:bg-ink-800 group-hover:text-white">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
