'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MultiSelectOption { value: string; label: string; }

// Menu a tendina con checkbox multiple + opzione "tutto" in cima — selezione vuota
// equivale a "tutto" (nessun filtro), coerente con le regole di scadenza che
// trattano una lista vuota come "qualsiasi".
//
// Il menu è renderizzato in un portal su document.body con position:fixed invece
// che assoluto dentro il bottone: molti punti d'uso stanno dentro contenitori con
// overflow-y-auto (es. modali) e un figlio absolute verrebbe ritagliato invece di
// galleggiare sopra il contenuto.
export function MultiSelectDropdown({ options, selected, onChange, allLabel = 'Tutte', className = '' }: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isAll = selected.length === 0;
  const summary = isAll
    ? allLabel
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selezionate`;

  // Selezione vuota = "tutte": i checkbox dei singoli elementi appaiono comunque
  // spuntati, così toccare una voce la toglie lasciando "tutte tranne quella" invece
  // di restringere la selezione alla sola voce toccata.
  function toggle(v: string) {
    const base = isAll ? options.map(o => o.value) : selected;
    const next = base.includes(v) ? base.filter(x => x !== v) : [...base, v];
    // Se il risultato copre di nuovo tutte le opzioni, torna a [] per restare
    // "qualsiasi" (coerente con le regole che trattano la lista vuota come tale).
    onChange(next.length === options.length ? [] : next);
  }

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function reposition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button" onClick={() => (open ? setOpen(false) : openMenu())}
        className={`input text-sm text-left flex items-center justify-between gap-2 w-full ${isAll ? 'text-gray-400' : ''}`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-gray-400 text-xs shrink-0">▾</span>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-56 max-h-64 overflow-y-auto text-sm"
          >
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer font-medium border-b border-gray-100 mb-1">
              <input type="checkbox" checked={isAll} onChange={() => onChange([])} />
              {allLabel}
            </label>
            {options.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={isAll || selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
