'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

export interface ActionMenuItem {
  label:      string;
  href?:      string;
  onClick?:   () => void;
  disabled?:  boolean;
  title?:     string;
  /** Pallino, contatore o altro a destra della voce */
  adornment?: React.ReactNode;
  /** Linea di separazione sopra la voce (per raggruppare) */
  separatore?: boolean;
}

interface Props {
  label:      string;
  items:      ActionMenuItem[];
  /** Pallino o contatore accanto al nome del pulsante (resta visibile a menu chiuso) */
  adornment?: React.ReactNode;
  title?:     string;
}

// Pulsante con menu a tendina per raggruppare le azioni secondarie di una pagina (es. «Altro»).
// Si chiude con Esc, con un clic fuori o scegliendo una voce.
export function ActionMenu({ label, items, adornment, title }: Props) {
  const [aperto, setAperto] = useState(false);
  const radice = useRef<HTMLDivElement>(null);
  const bottone = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => { if (!radice.current?.contains(e.target as Node)) setAperto(false); };
    const tasto = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAperto(false); bottone.current?.focus(); } };
    document.addEventListener('mousedown', fuori);
    document.addEventListener('keydown', tasto);
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', tasto); };
  }, [aperto]);

  const voce = 'flex w-full items-center justify-between gap-6 px-4 py-2 text-left text-sm text-ink-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent';

  return (
    <div ref={radice} className="relative">
      <button ref={bottone} type="button" className="btn-secondary" aria-haspopup="menu" aria-expanded={aperto} aria-controls={id} title={title}
        onClick={() => setAperto(a => !a)}>
        {label}
        {adornment}
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {aperto && (
        <div id={id} role="menu" className="absolute right-0 z-30 mt-2 min-w-[14rem] overflow-hidden rounded-card border border-line bg-white py-1 shadow-float">
          {items.map(it => (
            <React.Fragment key={it.label}>
              {it.separatore && <div className="my-1 border-t border-line" role="separator" />}
              {it.href && !it.disabled ? (
                <Link href={it.href} role="menuitem" className={voce} title={it.title} onClick={() => setAperto(false)}>
                  <span>{it.label}</span>{it.adornment}
                </Link>
              ) : (
                <button type="button" role="menuitem" className={voce} disabled={it.disabled} title={it.title}
                  onClick={() => { setAperto(false); it.onClick?.(); }}>
                  <span>{it.label}</span>{it.adornment}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
