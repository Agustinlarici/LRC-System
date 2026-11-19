// Fatturazione: motore delle regole di prezzo. Puro (senza DB), così si prova senza BC.
// Regola = gruppo di articoli (o tutti) + catena di passi + prezzo. Si cerca una parola; se la trova si passa al passo successivo,
// se no la regola non fa nulla. Se tutti i passi trovano la loro parola, il prezzo si somma.
// Passo: 1° passo: ovunque o entro i primi N caratteri; passi successivi: dopo la fine del precedente, ovunque o entro N caratteri.
// Nessun passo = vale sempre (prezzo base).
import { z } from 'zod';

export const MAX_REGOLE = 500;
export const MAX_PASSI = 8;

export const PassoSchema = z.object({
  cerca:    z.array(z.string().trim().min(1).max(60)).min(1).max(40),   // alternative; «@NOME» = gruppo di parole
  finestra: z.number().int().min(1).max(1000).nullable(),               // null = senza limite
});
export type Passo = z.infer<typeof PassoSchema>;

export const RegolaInputSchema = z.object({
  nome:    z.string().trim().min(1).max(120),
  attiva:  z.boolean(),
  gruppo:  z.string().trim().min(1).max(60).nullable(),                 // gruppo di articoli; null = tutti gli articoli
  prezzo:  z.number().min(-1_000_000).max(1_000_000),
  passi:   z.array(PassoSchema).max(MAX_PASSI),                         // catena: ogni passo deve trovare la sua parola
});
export type RegolaInput = z.infer<typeof RegolaInputSchema>;
export type Regola = RegolaInput & { id: number };

export type Gruppi = Map<string, string[]>;
/** Gruppi di articoli: nome (normalizzato) -> codici (maiuscoli). */
export type GruppiArticoli = Map<string, Set<string>>;
export const codice = (c: string): string => c.trim().toUpperCase();

export const normalizza = (t: string): string => t.toUpperCase().replace(/\s+/g, ' ').trim();

function parole(passo: Passo, gruppi: Gruppi): string[] {
  const out = new Set<string>();
  for (const c of passo.cerca) {
    if (c.startsWith('@')) for (const p of gruppi.get(normalizza(c.slice(1))) ?? []) { const n = normalizza(p); if (n) out.add(n); }
    else { const n = normalizza(c); if (n) out.add(n); }
  }
  return [...out];
}

function cerca(testo: string, passi: Passo[], i: number, da: number, gruppi: Gruppi): boolean {
  if (i === passi.length) return true;
  const passo = passi[i]!;
  const limite = passo.finestra == null ? testo.length : Math.min(testo.length, da + passo.finestra);
  for (const parola of parole(passo, gruppi)) {
    for (let pos = testo.indexOf(parola, da); pos >= 0 && pos + parola.length <= limite; pos = testo.indexOf(parola, pos + 1)) {
      if (cerca(testo, passi, i + 1, pos + parola.length, gruppi)) return true;   // prova tutte le occorrenze (backtracking)
    }
  }
  return false;
}

export interface RegolaApplicata { id: number; nome: string; prezzo: number }
export interface Calcolo { totale: number; applicate: RegolaApplicata[] }

export function calcola(descrizione: string, articolo: string, regole: Regola[], gruppi: Gruppi, articoli: GruppiArticoli): Calcolo {
  const testo = normalizza(descrizione);
  const art = codice(articolo);
  const applicate: RegolaApplicata[] = [];
  for (const r of regole) {
    if (!r.attiva) continue;
    if (r.gruppo !== null && !articoli.get(normalizza(r.gruppo))?.has(art)) continue;   // gruppo inesistente = non si applica
    if (!cerca(testo, r.passi, 0, 0, gruppi)) continue;                                  // nessun passo = prezzo base
    applicate.push({ id: r.id, nome: r.nome, prezzo: r.prezzo });
  }
  const totale = Math.round(applicate.reduce((s, a) => s + a.prezzo, 0) * 100) / 100;
  return { totale, applicate };
}
