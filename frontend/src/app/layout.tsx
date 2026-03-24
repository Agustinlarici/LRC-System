import type { Metadata } from 'next';
import '@/app/globals.css';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: {
    default:  'STR',
    template: '%s — STR',
  },
  description: 'Sistema di gestione produzione STR',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="h-full">
      <body className="h-full flex">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
