'use client';

import { useRouter } from 'next/navigation';

interface Props {
  href: string;
}

// La richiesta di fullscreen deve avvenire in modo sincrono nello stesso gesto di
// click dell'utente, altrimenti il browser la rifiuta (serve l'attivazione utente).
// Per questo non si può farla nella pagina di destinazione dopo la navigazione, va
// agganciata qui, al click che avvia la modalità tablet.
export function FullscreenButton({ href }: Props) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    document.documentElement.requestFullscreen().catch(() => {});
    router.push(href);
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors whitespace-nowrap"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V5a1 1 0 0 1 1-1h4M4 15v4a1 1 0 0 0 1 1h4M20 9V5a1 1 0 0 0-1-1h-4M20 15v4a1 1 0 0 1-1 1h-4" />
      </svg>
      Schermo intero
    </a>
  );
}
