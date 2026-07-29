'use client';

import { useEffect } from 'react';

// Registra il service worker minimo richiesto da Chrome per considerare installabile
// il manifest della modalità tablet (vedi layout.tsx).
export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw-qualita-tablet.js', { scope: '/qualita/tablet/' })
        .catch(() => {});
    }
  }, []);

  return null;
}
