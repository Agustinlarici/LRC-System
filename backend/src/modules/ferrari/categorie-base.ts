// Categorie per raggruppare le colonne della tabella schede (es. LIVREA, DREAMLINE, CARB.): lettura e raggruppamento.
// Nessuna dipendenza da service.ts (lo importa service.ts); la scrittura con lo storico e' in categorie.ts.

import type { db } from '../../db/client.js';
import { collapse, escapeRegExp } from './text.js';

type Tx = typeof db;

export interface Categoria { id: number; nome: string; ordine: number; termini: string[] }
export interface Gruppo { categoria: string | null; termini: string[] }

export async function leggiCategorie(tx: Tx): Promise<Categoria[]> {
  const cat = await tx<{ id: string; nome: string; ordine: number }[]>`SELECT id::text AS id, nome, ordine FROM ferrari_categoria ORDER BY ordine, id`;
  if (cat.length === 0) return [];
  const voci = await tx<{ categoria_id: string; termine: string }[]>`
    SELECT categoria_id::text AS categoria_id, termine FROM ferrari_categoria_termine ORDER BY categoria_id, ordine`;
  return cat.map(c => ({ id: Number(c.id), nome: c.nome, ordine: c.ordine, termini: voci.filter(v => v.categoria_id === c.id).map(v => v.termine) }));
}

/**
 * Mette ogni colonna nella sua categoria. Una colonna entra in una categoria se:
 *  1. il suo codice e' uno dei termini (esatto): questo vince sempre;
 *  2. altrimenti, un termine di almeno 3 caratteri e' l'inizio del codice (es. «TLM» per TLM13);
 *  3. oppure un termine di almeno 3 caratteri e' l'inizio di una parola della descrizione (es. «CAVALL» per «CAVALLINO»).
 * A parita' vince la prima categoria dell'elenco. Le colonne senza categoria vanno in un gruppo finale con `categoria: null`.
 * Senza nessuna categoria definita ritorna [] (la tabella resta com'e').
 */
export function raggruppa(colonne: readonly string[], descrizioni: ReadonlyMap<string, string>, categorie: readonly Categoria[]): Gruppo[] {
  if (categorie.length === 0) return [];
  const termini = categorie.map(c => c.termini.map(t => collapse(t)).filter(Boolean));
  const assegnata = new Map<string, number>();

  for (const codice of colonne) {                                  // 1. codice esatto
    const c = collapse(codice);
    const i = termini.findIndex(ts => ts.includes(c));
    if (i >= 0) assegnata.set(codice, i);
  }
  for (const codice of colonne) {                                  // 2 e 3. inizio del codice o parola nella descrizione
    if (assegnata.has(codice)) continue;
    const c = collapse(codice);
    const descr = collapse(descrizioni.get(codice) ?? '');
    const i = termini.findIndex(ts => ts.some(t => t.length >= 3
      && (c.startsWith(t) || (descr !== '' && new RegExp(`(^|[^A-Z0-9])${escapeRegExp(t)}`).test(descr)))));
    if (i >= 0) assegnata.set(codice, i);
  }

  const gruppi: Gruppo[] = categorie
    .map((cat, i) => ({ categoria: cat.nome as string | null, termini: colonne.filter(c => assegnata.get(c) === i) }))
    .filter(g => g.termini.length > 0);
  const resto = colonne.filter(c => !assegnata.has(c));
  if (resto.length > 0) gruppi.push({ categoria: null, termini: resto });
  return gruppi;
}
