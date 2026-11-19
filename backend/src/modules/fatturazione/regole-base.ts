// Fatturazione: motore delle regole di prezzo. Puro (senza DB), così si prova senza BC.
// Regola = prezzo + condizioni (catene di passi) combinate con 'tutte'/'qualsiasi' + eccezioni (se una combacia, la regola non si applica).
// Passo: cerca una parola della descrizione — 1° passo: ovunque o entro i primi N caratteri;
// passi successivi: dopo la fine del precedente, ovunque o entro N caratteri. Nessuna condizione = vale sempre (prezzo base).
import { z } from 'zod';

export const MAX_REGOLE = 500;
export const MAX_PASSI = 8;
export const MAX_CONDIZIONI = 10;

export const PassoSchema = z.object({
  cerca:    z.array(z.string().trim().min(1).max(60)).min(1).max(40),   // alternative; «@NOME» = gruppo di parole
  finestra: z.number().int().min(1).max(1000).nullable(),               // null = senza limite
});
export const CondizioneSchema = z.object({ passi: z.array(PassoSchema).min(1).max(MAX_PASSI) });
export type Passo = z.infer<typeof PassoSchema>;
export type Condizione = z.infer<typeof CondizioneSchema>;

export const RegolaInputSchema = z.object({
  nome:         z.string().trim().min(1).max(120),
  attiva:       z.boolean(),
  article_code: z.string().trim().min(1).max(60),
  prezzo:       z.number().min(-1_000_000).max(1_000_000),
  logica:       z.enum(['tutte', 'qualsiasi']),
  condizioni:   z.array(CondizioneSchema).max(MAX_CONDIZIONI),
  eccezioni:    z.array(CondizioneSchema).max(MAX_CONDIZIONI),
});
export type RegolaInput = z.infer<typeof RegolaInputSchema>;
export type Regola = RegolaInput & { id: number };

export type Gruppi = Map<string, string[]>;

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

const combacia = (testo: string, c: Condizione, gruppi: Gruppi) => cerca(testo, c.passi, 0, 0, gruppi);

export interface RegolaApplicata { id: number; nome: string; prezzo: number }
export interface Calcolo { totale: number; applicate: RegolaApplicata[] }

export function calcola(descrizione: string, articolo: string, regole: Regola[], gruppi: Gruppi): Calcolo {
  const testo = normalizza(descrizione);
  const art = articolo.trim();
  const applicate: RegolaApplicata[] = [];
  for (const r of regole) {
    if (!r.attiva || (r.article_code !== '*' && r.article_code !== art)) continue;
    const ok = r.condizioni.length === 0
      || (r.logica === 'tutte' ? r.condizioni.every(c => combacia(testo, c, gruppi)) : r.condizioni.some(c => combacia(testo, c, gruppi)));
    if (!ok || r.eccezioni.some(c => combacia(testo, c, gruppi))) continue;
    applicate.push({ id: r.id, nome: r.nome, prezzo: r.prezzo });
  }
  const totale = Math.round(applicate.reduce((s, a) => s + a.prezzo, 0) * 100) / 100;
  return { totale, applicate };
}
