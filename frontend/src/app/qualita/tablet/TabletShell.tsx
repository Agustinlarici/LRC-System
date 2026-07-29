'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

interface Props {
  title:          string;
  backHref:       string;
  backLabel?:     string;
  requireManage?: boolean;
  children:       React.ReactNode;
}

// Guard di autenticazione + header comune per tutte le schermate della modalità
// tablet di Qualità. La modalità tablet salta il redirect automatico dell'AppShell
// (per restare a schermo intero), quindi va controllato qui — non è un tablet
// condiviso senza login: serve la sessione per registrare chi fa la segnalazione.
export function TabletShell({ title, backHref, backLabel = 'Indietro', requireManage = false, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, canView, canManage } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      sessionStorage.setItem('redirect_after_login', pathname);
      router.replace('/login');
    }
  }, [loading, user, router, pathname]);

  // Il fullscreen si può richiedere solo dentro un gesto utente genuino — un timer non
  // basta, il browser lo rifiuta comunque. Aggancia quindi la richiesta al primo tocco
  // sullo schermo (qualsiasi punto, non un bottone specifico): copre l'apertura diretta
  // da un'icona/collegamento in home, senza bisogno che l'utente cerchi un bottone.
  useEffect(() => {
    function onFirstTouch() {
      document.removeEventListener('pointerdown', onFirstTouch, true);
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
    document.addEventListener('pointerdown', onFirstTouch, true);
    return () => document.removeEventListener('pointerdown', onFirstTouch, true);
  }, []);

  if (loading || !user) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  const allowed = requireManage ? canManage('qualita') : canView('qualita');
  if (!allowed) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Accesso negato</h1>
          <p className="text-sm text-gray-500">Non hai i permessi per accedere a questo modulo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      <div className="mb-4 flex items-center justify-end max-w-6xl mx-auto">
        {title && <h1 className="text-xl font-bold text-gray-900 mr-auto">{title}</h1>}
        <Link
          href={backHref}
          className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors bg-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel}
        </Link>
      </div>
      <div className="max-w-6xl mx-auto">{children}</div>
    </div>
  );
}
