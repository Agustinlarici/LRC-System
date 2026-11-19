// Fatturazione: motore delle regole di prezzo. Puro (senza DB), così si prova senza BC.
// Regola = un articolo (o '*' = tutti) + catena di passi + prezzo. Si cerca una parola; se la trova si passa al passo successivo,
// se no la regola non fa nulla. Se tutti i passi trovano la loro parola, il prezzo si somma.
// Passo: 1° passo: ovunque o entro i primi N caratteri; passi successivi: dopo la fine del precedente, ovunque o entro N caratteri.
// Nessun passo = vale sempre (prezzo base).
import { z } from 'zod';

export const MAX_REGOLE = 500;
export const MAX_PASSI = 3;   // la tabella ha 3 colonne di ricerca

export const PassoSchema = z.object({
  cerca:    z.array(z.string().trim().min(1).max(60)).min(1).max(40),   // alternative; «@NOME» = gruppo di parole
  finestra: z.number().int().min(1).max(1000).nullable(),               // null = senza limite
});
export type Passo = z.infer<typeof PassoSchema>;

export const RegolaInputSchema = z.object({
  nome:    z.string().trim().max(120),                                  // nota libera
  attiva:  z.boolean(),
  article_code: z.string().trim().min(1).max(60),                       // codice di vendita; '*' = tutti gli articoli
  prezzo:  z.number().min(-1_000_000).max(1_000_000),
  passi:   z.array(PassoSchema).max(MAX_PASSI),                         // catena: ogni passo deve trovare la sua parola
});
export type RegolaInput = z.infer<typeof RegolaInputSchema>;
export type Regola = RegolaInput & { id: number };

export type Gruppi = Map<string, string[]>;
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

export function calcola(descrizione: string, articolo: string, regole: Regola[], gruppi: Gruppi): Calcolo {
  const testo = normalizza(descrizione);
  const art = codice(articolo);
  const applicate: RegolaApplicata[] = [];
  for (const r of regole) {
    if (!r.attiva) continue;
    if (r.article_code !== '*' && codice(r.article_code) !== art) continue;
    if (!cerca(testo, r.passi, 0, 0, gruppi)) continue;                                  // nessun passo = prezzo base
    applicate.push({ id: r.id, nome: r.nome, prezzo: r.prezzo });
  }
  const totale = Math.round(applicate.reduce((s, a) => s + a.prezzo, 0) * 100) / 100;
  return { totale, applicate };
}

/** Chiave di una regola (articolo + catena): due regole uguali si sommerebbero per errore, quindi non possono coesistere. */
export function chiaveRegola(r: Pick<RegolaInput, 'article_code' | 'passi'>): string {
  const passi = r.passi.map(p => `${[...new Set(p.cerca.map(normalizza))].sort().join(',')}@${p.finestra ?? ''}`);
  return `${codice(r.article_code)}|${passi.join('>')}`;
}
