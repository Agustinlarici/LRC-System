// Matrice commesse × caratteristiche: una colonna per opzione trovata, in cella «Sì» oppure il dettaglio (colore, filo…).
// Stessa regola di STR-LocalAI/web/ferrari/matrice.py (la PC IA ne mostra una uguale, con il riassunto della IA nel dettaglio).

import { collapse } from './text.js';
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

export interface Colonna { codice: string; nome: string }
export interface RigaMatrice {
  id: number; commessa: string; modello: string | null; paese: string | null; stato: string;
  celle: Record<string, string>; testi: Record<string, string>;
}

export function costruisciMatrice(schede: { id: number; stato: string; canonico: Canonico }[]): { colonne: Colonna[]; righe: RigaMatrice[] } {
  const colonne: Colonna[] = [];
  const visti = new Set<string>();
  const righe: RigaMatrice[] = [];
  for (const s of schede) {
    const celle: Record<string, string> = {};
    const testi: Record<string, string> = {};
    for (const o of s.canonico.opzioni) {
      if (!visti.has(o.codice)) { visti.add(o.codice); colonne.push({ codice: o.codice, nome: o.descrizione }); }
      celle[o.codice] = cellaOpzione(o);
      const libero = testoLibero(o);
      if (libero) testi[o.codice] = libero;
    }
    righe.push({
      id: s.id, commessa: s.canonico.header.commessa ?? '', modello: s.canonico.header.tipo_matricola.modello,
      paese: s.canonico.header.destinazione.paese, stato: s.stato, celle, testi,
    });
  }
  return { colonne, righe };
}
