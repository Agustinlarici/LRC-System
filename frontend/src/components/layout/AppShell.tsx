'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '@/components/ui/Toast';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTablet =
    pathname.endsWith('/tablet') ||
    /^\/packing\/(operatore|spedizione|scan)$/.test(pathname);

  const isMonitor = /^\/monitor\/\d+/.test(pathname);

  if (isTablet) {
    return <ToastProvider><div className="min-h-screen bg-gray-50">{children}</div></ToastProvider>;
  }

  if (isMonitor) {
    return <ToastProvider><div className="flex-1 overflow-hidden">{children}</div></ToastProvider>;
  }

  return (
    <ToastProvider>
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50">
        <div className="p-6">{children}</div>
      </main>
    </ToastProvider>
  );
}
