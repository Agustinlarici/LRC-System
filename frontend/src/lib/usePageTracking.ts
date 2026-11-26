'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

const HEARTBEAT_MS = 2 * 60_000;

// Statistiche di utilizzo (pannello /admin/attivita): registra la pagina aperta e,
// finché la scheda è visibile, un segnale di presenza ogni 2 minuti.
// Gli errori sono ignorati di proposito: il tracking non deve mai disturbare l'utente.
// `skip` = login, accoppiamento dispositivo e cambio password (nessuna visita registrata).
export function usePageTracking(userId: number | null, pathname: string, skip: boolean) {
  useEffect(() => {
    if (!userId || skip) return;
    api.post('/api/activity/track', { path: pathname }).catch(() => {});
  }, [userId, pathname, skip]);

  useEffect(() => {
    if (!userId || skip) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        api.post('/api/activity/track', { path: pathname, heartbeat: true }).catch(() => {});
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [userId, pathname, skip]);
}
