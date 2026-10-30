'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { visibleModules } from '@/lib/modules';
import { ICON_MAP, IconSearch, IconSettings } from '@/components/icons/ModuleIcons';

// Barra superiore uguale in tutte le pagine: ricerca rapida dei moduli a cui
// l'utente ha accesso. Nome utente e Esci stanno in fondo al sidebar.
export function TopBar() {
  const router = useRouter();
  const { canView } = useAuth();
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel]   = useState(0);
  const boxRef          = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return visibleModules
      .filter(m => !m.soon && (!m.moduleKey || canView(m.moduleKey)))
      .filter(m => `${m.label} ${m.group} ${m.description}`.toLowerCase().includes(query))
      .slice(0, 7);
  }, [q, canView]);

  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function go(href: string) {
    setQ(''); setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[sel]) go(results[sel].href);
    else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLElement).blur(); }
  }

  return (
    <div className="d-print-none shrink-0 flex items-center justify-between gap-4 px-6 h-16">
      <div ref={boxRef} className="relative w-full max-w-md">
        <IconSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Cerca un modulo…"
          aria-label="Cerca un modulo"
          className="w-full h-11 rounded-full bg-white shadow-card border border-transparent pl-11 pr-4 text-sm placeholder:text-stone-400
                     focus:outline-none focus:ring-4 focus:ring-ink-800/10"
        />
        {open && q.trim() && (
          <div className="absolute z-30 mt-2 w-full rounded-2xl bg-white shadow-float p-1.5">
            {results.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-muted">Nessun modulo trovato</p>
            ) : results.map((m, i) => {
              const Icon = ICON_MAP[m.sidebar] ?? IconSettings;
              return (
                <button key={m.href} onMouseEnter={() => setSel(i)} onClick={() => go(m.href)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                    i === sel ? 'bg-stone-100' : ''
                  }`}>
                  <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-stone-100 text-ink-800 shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-900 truncate">{m.label}</span>
                    <span className="block text-xs text-muted">{m.group}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
