'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';
import type { ModuleKey } from '@/types';

// ─── Route → module mapping ───────────────────────────────────────────────────

function getModuleForPath(pathname: string): { key: ModuleKey; needsManage?: boolean } | null {
  if (pathname.startsWith('/tickets/dashboard'))      return { key: 'tickets_it' };
  if (pathname.startsWith('/tickets/admin'))          return { key: 'impostazioni' };
  if (pathname.startsWith('/tickets'))               return { key: 'tickets' };
  if (pathname.startsWith('/ingresso-merci'))        return { key: 'ingresso_merci' };
  if (pathname.startsWith('/packing/impostazioni'))  return { key: 'packing', needsManage: true };
  if (pathname.startsWith('/packing'))               return { key: 'packing' };
  if (pathname.startsWith('/monitor'))               return { key: 'monitor' };
  if (pathname.startsWith('/buffer'))                return { key: 'buffer' };
  if (pathname.startsWith('/mappa'))                 return { key: 'mappa' };
  if (pathname.startsWith('/dashboards'))            return { key: 'dashboards' };
  return null;
}

// ─── 403 block ────────────────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex-1 flex items-center justify-center bg-slate-50">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Accesso negato</h1>
        <p className="text-sm text-gray-500">
          Non hai i permessi per accedere a questo modulo.<br />
          Contatta l'amministratore.
        </p>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingShell() {
  return (
    <>
      <div className="w-[68px] min-h-full bg-zinc-900 shrink-0 animate-pulse" />
      <main className="flex-1 bg-slate-50" />
    </>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname();
  const router    = useRouter();
  const { user, loading, canView, canManage } = useAuth();

  // Fullscreen routes (no sidebar, no auth check)
  const isFullscreen = pathname === '/login';
  const isTablet     = pathname.endsWith('/tablet');
  const isMonitor    = /^\/monitor\/\d+/.test(pathname);

  // Redirect to login if not authenticated (after loading)
  useEffect(() => {
    if (!loading && !user && !isFullscreen && !isTablet && !isMonitor) {
      sessionStorage.setItem('redirect_after_login', pathname);
      router.replace('/login');
    }
  }, [loading, user, isFullscreen, isTablet, isMonitor, router, pathname]);

  // ── Fullscreen layouts (no sidebar) ────────────────────────────────────────

  if (isFullscreen) {
    return <ToastProvider><div className="w-full min-h-screen">{children}</div></ToastProvider>;
  }

  if (isTablet) {
    return <ToastProvider><div className="w-full min-h-screen bg-gray-50">{children}</div></ToastProvider>;
  }

  if (isMonitor) {
    return <ToastProvider><div className="flex-1 overflow-hidden">{children}</div></ToastProvider>;
  }

  // ── Auth loading ───────────────────────────────────────────────────────────

  if (loading) {
    return <ToastProvider><LoadingShell /></ToastProvider>;
  }

  // ── Not authenticated → blank while redirecting ────────────────────────────

  if (!user) {
    return null;
  }

  // ── Permission check for current module ───────────────────────────────────

  const currentModule = getModuleForPath(pathname);
  const hasAccess = !currentModule || (
    currentModule.needsManage
      ? canManage(currentModule.key)
      : canView(currentModule.key)
  );

  return (
    <ToastProvider>
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50">
        {hasAccess
          ? <div className="p-6">{children}</div>
          : <AccessDenied />
        }
      </main>
    </ToastProvider>
  );
}
