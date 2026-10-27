// Matrice commesse × caratteristiche: una colonna per opzione trovata, in cella «Sì» oppure il dettaglio (colore, filo…).
// Stessa regola di STR-LocalAI/web/ferrari/matrice.py (la PC IA ne mostra una uguale, con il riassunto della IA nel dettaglio).

import { createHash } from 'node:crypto';
import { collapse, norm, phraseRegex } from './text.js';
import type { Canonico, Opzione } from './types.js';

export const SI = 'Sì';

export type ClasseCella = 'SI' | 'EXTRA' | 'NUMERO' | 'TESTO' | 'VUOTO';

export function classeValore(valore: string): ClasseCella {
  const v = collapse(valore);
  if (!v) return 'VUOTO';
  if (v === 'SI') return 'SI';
  if (/^EXTRA\w*\s*-?\s*NOT\s*STAND\w*$/.test(v)) return 'EXTRA';
  if (/^\d+([.,]\d+)?$/.test(v)) return 'NUMERO';
  return 'TESTO';
}

export function testoLibero(o: Opzione): string {
  return o.blocchi_testo.map(b => b.testo).join(' ');
}

export function cellaOpzione(o: Opzione, dettaglio?: string | null): string {
  const classe = classeValore(o.valore);
  const libero = (dettaglio || testoLibero(o)).trim();
  const parti: string[] = [];
  if (classe === 'TESTO' || classe === 'NUMERO') parti.push(o.valore.trim());
  if (libero) parti.push(libero);
  const nota = o.nota.trim();
  if (nota && parti.length === 0 && classe !== 'SI') parti.push(nota);
  if (parti.length === 0) return classe === 'EXTRA' ? 'Extra campionario' : SI;
  const testo = parti.join(' · ');
  return classe === 'SI' || classe === 'EXTRA' ? `${SI} — ${testo}` : testo;
}

/** Chiave di un testo lungo: stessa regola della PC IA (sha1 del testo normalizzato, spazi compressi). */
export function chiaveTesto(testo: string): string {
  return createHash('sha1').update(collapse(testo), 'utf8').digest('hex');
}

/** Dettagli arrivati dalla PC IA: commessa → codice → {chiave, dettaglio}. */
export type DettagliPerCommessa = Map<string, Map<string, { chiave: string; dettaglio: string }>>;

function dettagliValidi(commessa: string, opzioni: Opzione[], tutti?: DettagliPerCommessa): Record<string, string> {
  const out: Record<string, string> = {};
  const della = tutti?.get(commessa);
  if (!della) return out;
  for (const o of opzioni) {
    const d = della.get(o.codice);
    // vale solo se il testo della scheda e' ancora quello da cui e' nato il riassunto
    if (d && d.chiave === chiaveTesto(testoLibero(o))) out[o.codice] = d.dettaglio;
  }
  return out;
}

function estratto(testo: string, inizio: number, fine: number, margine = 40): string {
  const a = Math.max(0, inizio - margine);
  const b = Math.min(testo.length, fine + margine);
  return (a > 0 ? '…' : '') + testo.slice(a, b).trim() + (b < testo.length ? '…' : '');
}

/**
 * Cosa mostrare in cella per una sigla (es. BIC2) o una parola (es. CAVALLINO) cercata in una scheda.
 * Priorità: sigla uguale al codice → regola normale; parola nel valore → il valore; parola nel testo libero →
 * l'estratto del testo; parola nella descrizione o nella nota → «Sì». Altrimenti vuota.
 * `dettagli`: riassunti della IA per codice (facoltativi).
 */
export function cellaTermine(termine: string, opzioni: Opzione[], dettagli: Record<string, string> = {}): { testo: string; completo: string | null } {
  const t = collapse(termine);
  if (!t) return { testo: '', completo: null };
  const perCodice = opzioni.find(o => o.codice.toUpperCase() === t);
  if (perCodice) return { testo: cellaOpzione(perCodice, dettagli[perCodice.codice]), completo: testoLibero(perCodice) || null };

  const rx = phraseRegex(termine);
  for (const o of opzioni) if (rx.test(norm(o.valore))) return { testo: o.valore.trim(), completo: null };
  for (const o of opzioni) {
    for (const b of o.blocchi_testo) {
      const m = rx.exec(norm(b.testo));
      if (m) return { testo: dettagli[o.codice] || estratto(b.testo, m.index, m.index + m[0].length), completo: testoLibero(o) };
    }
  }
  for (const o of opzioni) if (rx.test(norm(o.descrizione)) || rx.test(norm(o.nota))) return { testo: SI, completo: null };
  return { testo: '', completo: null };
}

export interface RigaMatrice {
  id: number; commessa: string; modello: string | null; paese: string | null; stato: string;
  celle: Record<string, string>; testi: Record<string, string>;
}

/** Per un modello: una riga per commessa, una colonna per ogni sigla/parola scelta. */
export function costruisciMatrice(schede: { id: number; stato: string; canonico: Canonico }[], termini: string[], dettagli?: DettagliPerCommessa): RigaMatrice[] {
  return schede.map(s => {
    const det = dettagliValidi(s.canonico.header.commessa ?? '', s.canonico.opzioni, dettagli);
    const celle: Record<string, string> = {};
    const testi: Record<string, string> = {};
    for (const t of termini) {
      const c = cellaTermine(t, s.canonico.opzioni, det);
      celle[t] = c.testo;
      if (c.completo) testi[t] = c.completo;
    }
    return {
      id: s.id, commessa: s.canonico.header.commessa ?? '', modello: s.canonico.header.tipo_matricola.modello,
      paese: s.canonico.header.destinazione.paese, stato: s.stato, celle, testi,
    };
  });
}

export interface SiglaNuova { codice: string; nome: string; esempio: string }

/** Sigle presenti nelle schede e non ancora decise (nell'ordine dell'Excel), con un esempio di cosa contengono. */
export function nuoveSigle(schede: { canonico: Canonico }[], decise: Set<string>): SiglaNuova[] {
  const ordine: string[] = [];
  const nomi = new Map<string, string>();
  const esempi = new Map<string, string>();
  const banale = (e: string) => e === SI || e === 'Extra campionario';
  for (const s of schede) {
    for (const o of s.canonico.opzioni) {
      if (!nomi.has(o.codice)) { ordine.push(o.codice); nomi.set(o.codice, o.descrizione); }
      const e = cellaOpzione(o);
      const prima = esempi.get(o.codice);
      if (prima === undefined || (banale(prima) && !banale(e))) esempi.set(o.codice, e);
    }
  }
  return ordine.filter(c => !decise.has(c)).map(codice => ({ codice, nome: nomi.get(codice) ?? '', esempio: esempi.get(codice) ?? SI }));
}
