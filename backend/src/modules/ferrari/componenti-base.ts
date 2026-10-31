// Componenti per modello (es. «Paraurti posteriore», «Spoiler»): nomi, termini (sigle o parole) e proposte dalla PC IA.
// Stesse regole di STR-LocalAI/web/ferrari/componenti.py. Nessuna dipendenza da service.ts (lo importa service.ts).

import { HTTPException } from 'hono/http-exception';
import type { db } from '../../db/client.js';
import { collapse } from './text.js';
import type { VoceComponente } from './bundle.js';

type Tx = typeof db;

export const MAX_COMPONENTI = 80;
export const MAX_TERMINI = 40;

export interface Componente { nome: string; termini: string[] }
export interface PropostaComponente { modello: string; nome: string; termini: string[]; conflitto: boolean; da: string | null }

const errore = (messaggio: string) => new HTTPException(400, { message: messaggio });

export function normModello(m: string | undefined | null): string {
  const v = (m ?? '').trim().toUpperCase().slice(0, 30);
  if (!v) throw errore('Indicare il modello');
  return v;
}

export function normNome(n: string | undefined | null): string {
  const v = (n ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!v) throw errore('Indicare il nome del componente');
  return v;
}

export function normTermini(lista: unknown[] | undefined | null): string[] {
  const out: string[] = [];
  for (const t of lista ?? []) {
    const v = collapse(String(t)).slice(0, 60);
    if (v && !out.includes(v)) out.push(v);
  }
  if (out.length > MAX_TERMINI) throw errore(`Massimo ${MAX_TERMINI} termini per componente`);
  return out;
}

export const stessoNome = (a: string, b: string) => collapse(a) === collapse(b);

export async function listaComponenti(tx: Tx, modello: string): Promise<Componente[]> {
  const comp = await tx<{ nome: string }[]>`SELECT nome FROM ferrari_comp WHERE modello = ${modello} ORDER BY ordine, nome`;
  const termini = await tx<{ nome: string; termine: string }[]>`
    SELECT nome, termine FROM ferrari_comp_termine WHERE modello = ${modello} ORDER BY ordine`;
  return comp.map(c => ({ nome: c.nome, termini: termini.filter(t => t.nome === c.nome).map(t => t.termine) }));
}

/** Crea o aggiorna un componente. `vecchio` = nome precedente (rinomina). Ritorna il nome salvato. */
export async function scriviComponente(
  tx: Tx, modello: string, nome: string, termini: string[], vecchio?: string | null, utente?: string | null,
): Promise<string> {
  const esistenti = (await tx<{ nome: string }[]>`SELECT nome FROM ferrari_comp WHERE modello = ${modello}`).map(r => r.nome);
  const altro = esistenti.find(n => stessoNome(n, nome) && !(vecchio && stessoNome(n, vecchio)));
  if (altro !== undefined && vecchio) throw errore('Esiste già un componente con questo nome');
  if (altro !== undefined && altro !== nome) nome = altro;
  if (vecchio && !stessoNome(vecchio, nome)) {
    const vec = esistenti.find(n => stessoNome(n, vecchio));
    if (vec !== undefined) {
      await tx`UPDATE ferrari_comp SET nome = ${nome} WHERE modello = ${modello} AND nome = ${vec}`;
      esistenti[esistenti.indexOf(vec)] = nome;
    }
  }
  if (!esistenti.includes(nome)) {
    if (esistenti.length >= MAX_COMPONENTI) throw errore(`Massimo ${MAX_COMPONENTI} componenti per modello`);
    await tx`INSERT INTO ferrari_comp (modello, nome, creato_da) VALUES (${modello}, ${nome}, ${utente ?? null})`;
  }
  await tx`DELETE FROM ferrari_comp_termine WHERE modello = ${modello} AND nome = ${nome}`;
  for (const [i, t] of termini.entries()) {
    await tx`INSERT INTO ferrari_comp_termine (modello, nome, termine, ordine) VALUES (${modello}, ${nome}, ${t}, ${i})`;
  }
  return nome;
}

export async function esportaComponenti(tx: Tx): Promise<VoceComponente[]> {
  const modelli = await tx<{ modello: string }[]>`SELECT DISTINCT modello FROM ferrari_comp ORDER BY modello`;
  const out: VoceComponente[] = [];
  for (const m of modelli) for (const c of await listaComponenti(tx, m.modello)) out.push({ modello: m.modello, ...c });
  return out;
}

/** Le definizioni dell'altro programma diventano PROPOSTE (nuove o diverse da quelle locali). */
export async function importaComponenti(tx: Tx, voci: VoceComponente[], da: string): Promise<{ nuove: number; conflitti: number }> {
  let nuove = 0, conflitti = 0;
  for (const v of voci) {
    let m: string, n: string, t: string[];
    try {
      m = normModello(v.modello); n = normNome(v.nome); t = normTermini(v.termini);
    } catch {
      continue;
    }
    const locale = (await listaComponenti(tx, m)).find(c => stessoNome(c.nome, n));
    if (locale && JSON.stringify(locale.termini) === JSON.stringify(t)) {
      await tx`DELETE FROM ferrari_comp_proposta WHERE modello = ${m} AND nome = ${locale.nome}`;
      continue;
    }
    const nome = locale?.nome ?? n;
    await tx`
      INSERT INTO ferrari_comp_proposta (modello, nome, termini, conflitto, da)
      VALUES (${m}, ${nome}, ${tx.json(t as never)}, ${!!locale}, ${da})
      ON CONFLICT (modello, nome) DO UPDATE SET termini = EXCLUDED.termini, conflitto = EXCLUDED.conflitto, da = EXCLUDED.da, creata_at = now()`;
    if (locale) conflitti++; else nuove++;
  }
  return { nuove, conflitti };
}

export async function proposteComponenti(tx: Tx): Promise<PropostaComponente[]> {
  const righe = await tx<{ modello: string; nome: string; termini: string[]; conflitto: boolean; da: string | null }[]>`
    SELECT modello, nome, termini, conflitto, da FROM ferrari_comp_proposta ORDER BY creata_at, modello, nome`;
  return righe.map(r => ({ ...r, termini: Array.isArray(r.termini) ? r.termini : [] }));
}
