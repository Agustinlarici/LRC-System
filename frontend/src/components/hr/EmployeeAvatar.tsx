'use client';

import { useState } from 'react';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  id: number;
  nome: string;
  cognome: string;
  photoVersion: number | null | undefined;
  className: string;   // dimensioni e testo, es. "w-7 h-7 text-[10px]"
  background?: string; // colore di sfondo delle iniziali
  outline?: string;
}

// Foto del dipendente, oppure le iniziali se non ce n'è una (o non si carica).
// photoVersion cambia a ogni nuova foto e fa da cache-buster.
export function EmployeeAvatar({ id, nome, cognome, photoVersion, className, background, outline }: Props) {
  const [failed, setFailed] = useState(false);
  const style = { background, outline };
  if (photoVersion && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${BACKEND}/api/hr/employees/${id}/photo?v=${photoVersion}`}
        alt={`${cognome} ${nome}`}
        onError={() => setFailed(true)}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ outline }}
      />
    );
  }
  return (
    <div className={`rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${className}`} style={style}>
      {`${nome[0] ?? ''}${cognome[0] ?? ''}`.toUpperCase()}
    </div>
  );
}
