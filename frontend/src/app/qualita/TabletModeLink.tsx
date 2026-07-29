'use client';

import { useRouter } from 'next/navigation';

// La richiesta di fullscreen deve avvenire in modo sincrono nello stesso gesto di
// click dell'utente, altrimenti il browser la rifiuta (serve l'attivazione utente).
// Per questo non si può farla nella pagina /qualita/tablet dopo la navigazione, va
// agganciata qui, al click che avvia la modalità tablet.
export function TabletModeLink() {
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    document.documentElement.requestFullscreen().catch(() => {});
    router.push('/qualita/tablet');
  }

  return (
    <a
      href="/qualita/tablet"
      onClick={handleClick}
      className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <rect x="5" y="2" width="14" height="20" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="18" r="0.5" fill="currentColor" />
      </svg>
      Modalità Tablet
    </a>
  );
}
