'use client';

import { usePathname } from 'next/navigation';
import { isKioskPath } from '@/lib/kiosk';

// Il template si rimonta a ogni cambio di pagina: la nuova pagina entra con una breve
// dissolvenza. Login, tablet e monitor andon restano senza wrapper né animazioni
// (le loro pagine dipendono dall'altezza dello schermo).
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const plain = pathname === '/login' || pathname === '/cambio-password' || isKioskPath(pathname);
  if (plain) return <>{children}</>;
  return <div className="animate-pageIn">{children}</div>;
}
