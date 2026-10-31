'use client';

import React from 'react';

interface Props<T extends string> {
  tabs:     readonly T[];
  value:    T;
  onChange: (tab: T) => void;
}

// Solapas estándar (impostazioni di ogni modulo): stessa forma, stesso posto,
// sotto l'intestazione della pagina.
export function Tabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <div role="tablist" className="d-print-none mb-6 max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 rounded-full bg-white p-1 shadow-card">
        {tabs.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={t === value}
            onClick={() => onChange(t)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              t === value ? 'bg-ink-800 text-white' : 'text-muted hover:bg-stone-100 hover:text-ink-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
