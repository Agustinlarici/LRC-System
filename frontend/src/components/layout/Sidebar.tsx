'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

const NAV_ITEMS = [
  { href: '/',               label: 'Home',           icon: '🏠' },
  { href: '/ingresso-merci', label: 'Ingresso Merci', icon: '📦' },
  { href: '/packing',        label: 'Packing',        icon: '🚚' },
  { href: '/spma',           label: 'SPMA',           icon: '📋' },
  { href: '/production',     label: 'Produzione',     icon: '🏭' },
  { href: '/assistant',      label: 'Assistente AI',  icon: '🤖' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  // Persist preference
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-expanded');
    if (saved !== null) setExpanded(saved === 'true');
  }, []);

  function toggle() {
    setExpanded(prev => {
      localStorage.setItem('sidebar-expanded', String(!prev));
      return !prev;
    });
  }

  return (
    <aside
      className={`min-h-full bg-zinc-800 text-white flex flex-col shrink-0 transition-all duration-300 ${
        expanded ? 'w-56' : 'w-[72px]'
      }`}
    >
      {/* Logo + toggle */}
      <div className={`flex items-center border-b border-zinc-700 h-14 px-4 ${expanded ? 'justify-between' : 'justify-center'}`}>
        {expanded && (
          <img src="/logo.svg" alt="Logo" className="h-8 select-none" />
        )}
        {!expanded && (
          <img src="/logo.svg" alt="Logo" className="h-6 object-contain select-none" />
        )}

        <button
          onClick={toggle}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-zinc-600 transition-colors shrink-0"
          title={expanded ? 'Comprimi' : 'Espandi'}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-4 h-4 transition-transform duration-300 ${expanded ? '' : 'rotate-180'}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!expanded ? item.label : undefined}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 ${
                expanded ? '' : 'justify-center'
              } ${
                active
                  ? 'bg-gray-600 text-white border-l-2 border-white'
                  : 'text-gray-400 hover:bg-zinc-700 hover:text-white border-l-2 border-transparent'
              }`}
            >
              <span className="text-base shrink-0">{item.icon}</span>
              {expanded && (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-zinc-700 py-3 px-4 text-xs text-gray-500 ${expanded ? '' : 'text-center px-0'}`}>
        {expanded ? 'v1.0.0' : '1.0'}
      </div>
    </aside>
  );
}
