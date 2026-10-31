// Normalizzazione del testo per il confronto: maiuscolo, senza accenti, SENZA cambiare la
// lunghezza (cosi' gli offset trovati sul testo normalizzato valgono anche sull'originale).

function normChar(ch: string): string {
  if (/\s/.test(ch)) return ' ';
  const up = ch.toUpperCase();
  if (up.length !== 1) return ch;
  const base = up.normalize('NFD')[0];
  return base ?? up;
}

export function norm(text: string): string {
  let out = '';
  for (const ch of text) out += normChar(ch);
  return out;
}

/** Normalizza e comprime gli spazi: serve per confronti di uguaglianza, non per gli offset. */
export function collapse(text: string): string {
  return norm(text).replace(/\s+/g, ' ').trim();
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex (sul testo normalizzato) che trova `pattern` come parola intera, tollerando spazi multipli. */
export function phraseRegex(pattern: string, flags = 'g'): RegExp {
  const words = collapse(pattern).split(' ').filter(Boolean).map(escapeRegExp);
  if (words.length === 0) throw new Error('pattern vuoto');
  return new RegExp(`(?<![A-Z0-9])${words.join('\\s+')}(?![A-Z0-9])`, flags);
}

/** Posizione [start, end) della prima occorrenza di `fragment` in `text` (entrambi normalizzati al volo). */
export function findFragment(text: string, fragment: string, from = 0): { start: number; end: number } | null {
  const frag = collapse(fragment);
  if (!frag) return null;
  const re = phraseRegex(frag);
  re.lastIndex = from;
  const m = re.exec(norm(text));
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return collapse(a ?? '') === collapse(b ?? '');
}

/** Come phraseRegex ma senza il vincolo di parola intera ai bordi se il frammento inizia/finisce con simboli. */
export function containsFragment(text: string, fragment: string): boolean {
  const frag = collapse(fragment);
  if (!frag) return false;
  return collapse(text).includes(frag);
}
