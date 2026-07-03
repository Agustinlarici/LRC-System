'use client';

import { useEffect, useState, useRef } from 'react';

export function MultiSelectFilter<T extends string | number>({
  label, options, selected, onChange, optionLabel,
}: {
  label: string;
  options: T[];
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  optionLabel?: (opt: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const toggle = (opt: T) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1 text-xs rounded-lg font-medium border transition-colors ${
          selected.size > 0 ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {label}{selected.size > 0 ? ` (${selected.size})` : ''}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-64 overflow-auto min-w-[200px]">
          {selected.size > 0 && (
            <button onClick={() => onChange(new Set())} className="text-xs text-blue-600 hover:text-blue-800 mb-1 px-2">
              Cancella filtro
            </button>
          )}
          {options.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">Nessuna opzione</p>}
          {options.map(opt => (
            <label key={String(opt)} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} className="accent-blue-600" />
              {optionLabel ? optionLabel(opt) : String(opt)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function SingleSelectFilter<T extends string>({
  label, options, selected, onChange, optionLabel,
}: {
  label: string;
  options: T[];
  selected: T | null;
  onChange: (next: T) => void;
  optionLabel?: (opt: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2.5 py-1 text-xs rounded-lg font-medium border bg-white border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {label}: <span className="text-blue-700">{selected ? (optionLabel ? optionLabel(selected) : selected) : '—'}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-64 overflow-auto min-w-[200px]">
          {options.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">Nessuna opzione</p>}
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`flex items-center w-full text-left gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer text-sm ${
                selected === opt ? 'text-blue-700 font-medium' : 'text-gray-700'
              }`}
            >
              {optionLabel ? optionLabel(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
