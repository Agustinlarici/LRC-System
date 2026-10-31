// Schermate "kiosk": andon a schermo intero, mappa fullscreen, modalità tablet (Qualità, Packing,
// Ingresso merci) e pairing dei dispositivi. Devono restare con l'aspetto ORIGINALE: non ereditano
// il nuovo design (font, bottoni, campi), perché sono pensate per schermi in fabbrica.
export const KIOSK_PATTERN =
  '^/(monitor/(resumen/|parate/)?\\d+|mappa/(fullscreen|maranello)|qualita/tablet|packing/(spedizione|operatore|scan|tablet)|device-pair)(/|$)|/tablet/?$';

const KIOSK_RE = new RegExp(KIOSK_PATTERN);

export const isKioskPath = (pathname: string) => KIOSK_RE.test(pathname);
