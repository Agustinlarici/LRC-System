'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MODULE_GROUPS, modulesByGroup } from '@/lib/modules';
import { useAuth } from '@/lib/auth';
import type { ModuleKey } from '@/types';

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
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
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
function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
function IconTicket() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
function IconHeatmap() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <rect x="3" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="3" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="3" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
    </svg>
  );
}
function IconScan() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 2H5a2 2 0 00-2 2v2M17 2h2a2 2 0 012 2v2M7 22H5a2 2 0 01-2-2v-2M17 22h2a2 2 0 002-2v-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18" />
    </svg>
  );
}
function IconList() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}
function IconEdi() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h4M7 4H4a1 1 0 00-1 1v14a1 1 0 001 1h16a1 1 0 001-1V9l-5-5H7z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17l2 2 2-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 19v-5" />
    </svg>
  );
}
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, () => React.ReactElement> = {
  IconBox, IconTruck, IconMonitor, IconArchive, IconMap,
  IconClipboard, IconFactory, IconSettings, IconTicket, IconChart, IconHeatmap, IconList, IconScan, IconEdi,
};

// ─── Group representative icons ───────────────────────────────────────────────

const GROUP_ICON_MAP: Record<string, () => React.ReactElement> = {
  Logistica:  IconTruck,
  Produzione: IconMonitor,
  Dashboard:  IconChart,
  IT:         IconSettings,
};

// ─── Permission key map ───────────────────────────────────────────────────────

const MODULE_KEY_MAP: Record<string, ModuleKey> = {
  '/ingresso-merci':     'ingresso_merci',
  '/packing':            'packing',
  '/monitor':            'monitor',
  '/monitor/resumen':    'monitor_resumen',
  '/buffer':             'buffer',
  '/mappa':              'mappa',
  '/tickets':            'tickets',
  '/tickets/admin':      'tickets_admin',
  '/admin/system':       'impostazioni',
  '/dashboards':              'dashboards',
  '/dashboards/heatmap':      'dashboards',
  '/dashboards/lead-time':    'dashboards',
  '/dashboards/trends':       'dashboards',
  '/dashboards/quantita':     'dashboards',
  '/dashboards/qualita':      'dashboards',
  '/spma':                    'spma',
  '/recepciones':             'recepciones',
  '/edi':                     'edi',
  '/admin/monitor/parate':    'monitor_parate',
  '/admin/monitor/motivi':    'monitor_motivi',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname  = usePathname();
  const [expanded,   setExpanded]   = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const { user, canView, canManage, logout } = useAuth();

  // Restore sidebar expanded state + open the group containing the current page
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-expanded');
    if (saved !== null) setExpanded(saved === 'true');
  }, []);

  useEffect(() => {
    // Auto-open the group that contains the active page
    const activeGroup = MODULE_GROUPS.find(g =>
      modulesByGroup(g).some(m => pathname === m.href || pathname.startsWith(m.href + '/'))
    );
    if (activeGroup) setOpenGroups(prev => new Set([...prev, activeGroup]));
  }, [pathname]);

  function toggleSidebar() {
    setExpanded(prev => {
      localStorage.setItem('sidebar-expanded', String(!prev));
      return !prev;
    });
  }

  function expandToGroup(group: string) {
    setExpanded(true);
    localStorage.setItem('sidebar-expanded', 'true');
    setOpenGroups(new Set([group]));
  }

  function toggleGroup(group: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // Check if a module is accessible
  function canAccess(href: string, manageOnly?: boolean): boolean {
    const key = MODULE_KEY_MAP[href];
    if (!key) return true;
    return manageOnly ? canView(key) || canManage(key) : canView(key);
  }

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    if (pathname === href) return true;
    if (pathname.startsWith(href + '/')) {
      // Don't mark parent active if a sibling module more specifically matches
      const allHrefs = Object.keys(MODULE_KEY_MAP);
      const hasSibling = allHrefs.some(h => h !== href && h.startsWith(href + '/') && pathname.startsWith(h));
      return !hasSibling;
    }
    return false;
  }

  return (
    <aside className={`relative min-h-full bg-zinc-900 text-white flex flex-col shrink-0 transition-all duration-300 ${
      expanded ? 'w-56' : 'w-[68px]'
    }`}>

      {/* Logo */}
      <div className="flex items-center justify-center border-b border-zinc-800 h-14 px-4">
        <img src="/logo.png" alt="STR" className="h-9 select-none object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">

        {/* Toggle button */}
        <button onClick={toggleSidebar}
          aria-label={expanded ? 'Comprimi menu' : 'Espandi menu'}
          className={`w-full flex items-center px-2.5 py-2 rounded-lg text-sm text-zinc-500
            hover:bg-zinc-800 hover:text-white transition-colors mb-1
            ${expanded ? 'justify-end' : 'justify-center'}`}
        >
          {expanded
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            : <IconMenu />}
        </button>

        {/* Home */}
        <Link href="/" title="Home"
          className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm transition-colors
            ${expanded ? '' : 'justify-center'}
            ${isActive('/') ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
        >
          <IconHome />
          {expanded && <span className="truncate font-medium">Home</span>}
        </Link>

        {/* Grouped modules */}
        {MODULE_GROUPS.map(group => {
          const items = modulesByGroup(group).filter(m => canAccess(m.href, m.manageOnly));
          if (items.length === 0) return null;

          const groupOpen   = openGroups.has(group);
          const groupActive = items.some(m => isActive(m.href));
          const GroupIcon   = GROUP_ICON_MAP[group] ?? IconHome;

          return (
            <div key={group} className="pt-1">
              {expanded ? (
                // ── Expanded: collapsible group header ──────────────────────
                <>
                  <button onClick={() => toggleGroup(group)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold
                      uppercase tracking-widest transition-colors select-none
                      ${groupActive && !groupOpen
                        ? 'text-blue-400 hover:bg-zinc-800'
                        : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                  >
                    <span>{group}</span>
                    <IconChevron open={groupOpen} />
                  </button>
                  {groupOpen && (
                    <div className="mt-0.5 space-y-0.5">
                      {items.map(m => {
                        const Icon   = ICON_MAP[m.sidebar] ?? IconHome;
                        const active = isActive(m.href);
                        return (
                          <Link key={m.href} href={m.href} title={m.label}
                            className={`flex items-center gap-3 pl-5 pr-2.5 py-2 rounded-lg text-sm transition-colors
                              ${active ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                          >
                            <Icon />
                            <span className="truncate font-medium">{m.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                // ── Collapsed: one icon per group, click expands sidebar ────
                <button onClick={() => expandToGroup(group)} title={group}
                  className={`w-full flex justify-center px-2.5 py-2.5 rounded-lg transition-colors
                    ${groupActive ? 'text-blue-400 bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                >
                  <GroupIcon />
                </button>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — user + logout */}
      <div className={`border-t border-zinc-800 py-3 px-3 text-xs text-zinc-500 ${expanded ? '' : 'flex justify-center'}`}>
        {expanded ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{user?.display_name ?? 'STR System'}</span>
            <button onClick={logout} title="Esci" className="text-zinc-600 hover:text-white transition-colors shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <button onClick={logout} title="Esci" className="text-zinc-600 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}
