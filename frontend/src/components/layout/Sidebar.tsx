'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MODULE_GROUPS, modulesByGroup } from '@/lib/modules';
import { useAuth } from '@/lib/auth';
import type { ModuleKey } from '@/types';
import { ICON_MAP, GROUP_ICON_MAP } from '@/components/icons/ModuleIcons';

// ─── SVG Icons (sidebar chrome only) ───────────────────────────────────────────

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
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ─── Permission key map ───────────────────────────────────────────────────────

const MODULE_KEY_MAP: Record<string, ModuleKey> = {
  '/ingresso-merci':     'ingresso_merci',
  '/packing':            'packing',
  '/monitor':            'monitor',
  '/monitor/resumen':    'monitor_resumen',
  '/buffer':             'buffer',
  '/mappa':              'mappa',
  '/tickets':            'tickets',
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
  '/webddt':                  'webddt',
  '/admin/monitor/parate':    'monitor_parate',
  '/admin/monitor/motivi':    'monitor_motivi',
  '/qualita':                 'qualita',
  '/produzione':              'programma_produzione',
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
