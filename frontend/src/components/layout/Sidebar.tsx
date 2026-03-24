'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { visibleModules } from '@/lib/modules';

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}
function IconTruck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l1 1h1m8-1h2l4-4v-4h-6v8z" />
    </svg>
  );
}
function IconMonitor() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}
function IconFactory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}
function IconSparkles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l1.5 4.5L11 9l-4.5 1.5L5 15l-1.5-4.5L-1 9l4.5-1.5L5 3zM19 11l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM12 2l.75 2.25L15 5l-2.25.75L12 8l-.75-2.25L9 5l2.25-.75L12 2z" />
    </svg>
  );
}
function IconArchive() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, () => JSX.Element> = {
  IconBox:       IconBox,
  IconTruck:     IconTruck,
  IconMonitor:   IconMonitor,
  IconArchive:   IconArchive,
  IconMap:       IconMap,
  IconClipboard: IconClipboard,
  IconFactory:   IconFactory,
  IconSparkles:  IconSparkles,
};

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/', label: 'Home', Icon: IconHome },
  ...visibleModules.map(m => ({ href: m.href, label: m.label, Icon: ICON_MAP[m.sidebar] ?? IconHome })),
];

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

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
      className={`relative min-h-full bg-zinc-900 text-white flex flex-col shrink-0 transition-all duration-300 ${
        expanded ? 'w-56' : 'w-[68px]'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-center border-b border-zinc-800 h-14 px-4">
        <img
          src="/logo.png"
          alt="STR"
          className={`select-none object-contain transition-all duration-300 ${expanded ? 'h-9' : 'h-9'}`}
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">

        {/* Toggle: hamburger quando compresso, freccia a destra quando espanso */}
        <button
          onClick={toggle}
          aria-label={expanded ? 'Comprimi menu' : 'Espandi menu'}
          title={expanded ? 'Comprimi' : 'Espandi'}
          className={`w-full flex items-center px-2.5 py-2.5 rounded-lg text-sm transition-all duration-150 text-zinc-500 hover:bg-zinc-800 hover:text-white mb-1 ${
            expanded ? 'justify-end' : 'justify-center'
          }`}
        >
          {expanded ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          ) : (
            <IconMenu />
          )}
        </button>

        {/* Nav items */}
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`
                flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm transition-all duration-150
                ${expanded ? '' : 'justify-center'}
                ${active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}
              `}
            >
              <item.Icon />
              {expanded && (
                <span className="truncate font-medium">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-zinc-800 py-3 px-4 text-xs text-zinc-500 ${expanded ? '' : 'text-center px-0'}`}>
        {expanded ? 'STR System v1.0' : '1.0'}
      </div>
    </aside>
  );
}
