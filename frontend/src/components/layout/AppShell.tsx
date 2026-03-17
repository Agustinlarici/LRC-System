'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTablet =
    pathname.endsWith('/tablet') ||
    /^\/packing\/(operatore|spedizione|scan)$/.test(pathname);

  if (isTablet) {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
    </>
  );
}
