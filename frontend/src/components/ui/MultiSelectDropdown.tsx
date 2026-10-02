'use client';

import { useState } from 'react';

export interface MultiSelectOption { value: string; label: string; }

// Menu a tendina con checkbox multiple + opzione "tutto" in cima — selezione vuota
// equivale a "tutto" (nessun filtro), coerente con le regole di scadenza che
// trattano una lista vuota come "qualsiasi".
export function MultiSelectDropdown({ options, selected, onChange, allLabel = 'Tutte', className = '' }: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const isAll = selected.length === 0;
  const summary = isAll
    ? allLabel
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selezionate`;

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className={`input text-sm text-left flex items-center justify-between gap-2 ${isAll ? 'text-gray-400' : ''}`}
      >
        <span className="truncate">{summary}</span>
        <span className="text-gray-400 text-xs shrink-0">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-56 max-h-64 overflow-y-auto text-sm">
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer font-medium border-b border-gray-100 mb-1">
              <input type="checkbox" checked={isAll} onChange={() => onChange([])} />
              {allLabel}
            </label>
            {options.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
