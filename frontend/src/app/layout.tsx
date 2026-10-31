import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@/app/globals.css';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { KIOSK_PATTERN } from '@/lib/kiosk';

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
    <html lang="it" className={`h-full ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* Prima del primo disegno: le schermate kiosk (andon, tablet...) restano con lo stile originale */}
        <script dangerouslySetInnerHTML={{ __html: `if(new RegExp(${JSON.stringify(KIOSK_PATTERN)}).test(location.pathname))document.documentElement.classList.add('legacy-ui')` }} />
      </head>
      <body className="h-full flex font-sans">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
