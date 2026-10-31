import React from 'react';
import Link from 'next/link';

interface Props {
  title:        string;
  description?: React.ReactNode;
  /** Percorso di ritorno mostrato sopra il titolo, es. { label: 'Programma Produzione', href: '/produzione' } */
  back?:        { label: string; href: string };
  /** Badge o altro accanto al titolo */
  badge?:       React.ReactNode;
  /** Azioni, sempre allineate a destra: l'azione principale per ultima */
  actions?:     React.ReactNode;
}

// Intestazione standard di ogni pagina: stesso titolo, stessa posizione delle azioni.
export function PageHeader({ title, description, back, badge, actions }: Props) {
  return (
    <header className="d-print-none mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink-800 transition-colors mb-1">
            <span aria-hidden>←</span> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {badge}
        </div>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
