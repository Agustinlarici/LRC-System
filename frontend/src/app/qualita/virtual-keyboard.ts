// Forza l'apertura della tastiera virtuale su Android/Chrome. Serve perché il focus
// dato con il pennino (stylus) non fa comparire la tastiera come invece succede con
// il dito — è una scelta del sistema, non controllabile col semplice focus(). La
// VirtualKeyboard API è sperimentale (solo Chromium): se il dispositivo non la
// supporta questa funzione non fa nulla, senza errori.
export function showVirtualKeyboard(): void {
  (navigator as unknown as { virtualKeyboard?: { show(): void } }).virtualKeyboard?.show();
}
