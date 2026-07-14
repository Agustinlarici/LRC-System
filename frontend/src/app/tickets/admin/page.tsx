'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Pagina unificata in /admin/system — questo percorso resta solo per compatibilità
// con link/segnalibri esistenti.
export default function TicketsAdminRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/system'); }, [router]);
  return null;
}
