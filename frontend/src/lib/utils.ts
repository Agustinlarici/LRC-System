/** Returns today's date as YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format YYYY-MM-DD → DD/MM/YYYY */
export function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Add/subtract days from a YYYY-MM-DD string */
export function addDays(d: string, n: number): string {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Format ISO timestamp → DD/MM/YYYY HH:MM (Europe/Rome) */
export function fmtDatetime(raw: string): string {
  return new Date(raw).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Ordina le categorie del foglio Programma Produzione secondo l'ordine
 * impostato in Impostazioni → "Ordine Categorie" (vedi backend sheet.ts,
 * stessa logica). Chi non ha un ordine salvato va in fondo, alfabetico —
 * "X.EXTRA" per ultimo salvo che abbia anche lui un ordine esplicito.
 */
export function compareCategorie(a: string, b: string, orderMap: Map<string, number>): number {
  const ao = orderMap.get(a);
  const bo = orderMap.get(b);
  if (ao != null && bo != null) return ao - bo;
  if (ao != null) return -1;
  if (bo != null) return 1;
  if (a === 'X.EXTRA') return 1;
  if (b === 'X.EXTRA') return -1;
  return a.localeCompare(b);
}
