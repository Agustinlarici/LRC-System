import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@/app/globals.css';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';

// Outfit (OFL) incluso nel progetto: nessun download da Google, funziona anche offline.
const sans = localFont({
  src:      './fonts/Outfit-Variable.woff2',
  variable: '--font-sans',
  weight:   '100 900',
  display:  'swap',
});

export const metadata: Metadata = {
  title: {
    default:  'STR',
    template: '%s — STR',
  },
  description: 'Sistema di gestione produzione STR',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`h-full ${sans.variable}`}>
      <body className="h-full flex font-sans">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
