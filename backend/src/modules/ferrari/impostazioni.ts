// Pagina «Impostazioni»: le sigle viste per tutti i modelli insieme (stato per modello) e le modifiche in blocco.
// Stesse regole di STR-LocalAI/web/ferrari/impostazioni.py.
// Stati di una sigla per un modello: colonna (va in tabella), sub (sotto-sigla), no (non interessa), alias (errore di scrittura
// di un'altra sigla), nonsigla (non e' una sigla: un colore, un codice di materiale...), da_decidere (trovata nelle schede e mai decisa).

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { audit, decidiSigla, matrice, normalizzaSigla, TUTTI, togliDecisione, type Utente } from './service.js';
import { listaComponenti, normModello, scriviComponente, stessoNome } from './componenti-base.js';
import { elencoModelli } from './modelli.js';

type Tx = typeof db;
export type StatoSigla = 'colonna' | 'sub' | 'no' | 'alias' | 'nonsigla' | 'da_decidere';
export const STATI_IMPOSTABILI = ['colonna', 'sub', 'no', 'alias', 'nonsigla', 'reset'] as const;
export type StatoImpostabile = typeof STATI_IMPOSTABILI[number];

const statoDi = (va: boolean, sub: boolean, alias: string | null, nosigla = false): StatoSigla => nosigla ? 'nonsigla' : alias ? 'alias' : !va ? 'no' : sub ? 'sub' : 'colonna';

export interface VoceSigla {
  codice: string; nome: string; esempio: string; tutti: StatoSigla | null; alias: string | null;
  stati: Record<string, { stato: StatoSigla; ambito: 'modello' | 'tutti' | null; alias: string | null; sub?: boolean; simile_a?: string | null; padre?: string | null; auto?: boolean; suggerimento?: string }>;
}

export async function configurazioneSigle() {
  const modelli = await db<{ modello: string; schede: number }[]>`
    SELECT modello, count(*)::int AS schede FROM ferrari_file
    WHERE stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND modello IS NOT NULL
    GROUP BY modello ORDER BY max(caricato_at) DESC`;
  const globali = await db<{ codice: string; va: boolean; sub: boolean; alias: string | null; nosigla: boolean }[]>`
    SELECT codice, va, sub, alias, nosigla FROM ferrari_sigla WHERE modello = ${TUTTI}`;
  const storia = await storiaSigle();
  const ordine = new Map((await db<{ codice: string; o: string }[]>`SELECT codice, min(ordine)::text AS o FROM ferrari_sigla GROUP BY codice`)
    .map(r => [r.codice, Number(r.o)] as const));

  const sigle = new Map<string, VoceSigla>();
  const voce = (codice: string): VoceSigla => {
    let v = sigle.get(codice);
    if (!v) { v = { codice, nome: '', esempio: '', tutti: null, alias: null, stati: {} }; sigle.set(codice, v); }
    return v;
  };
  const daDecidere: Record<string, number> = {};
  let proposte: unknown[] = [];
  for (const m of modelli) {
    const mx = await matrice(m.modello, undefined, false);
    proposte = mx.proposte;
    daDecidere[m.modello] = mx.nuove.length;
    for (const s of mx.sigle) {
      const v = voce(s.codice);
      v.nome ||= s.nome;
      v.stati[m.modello] = { stato: statoDi(s.va, s.sub, s.alias, s.nosigla), ambito: s.ambito, alias: s.alias, padre: s.padre, auto: s.auto };
      v.alias ||= s.alias;
    }
    for (const n of mx.nuove) {
      const v = voce(n.codice);
      v.nome ||= n.nome;
      v.esempio ||= n.esempio;
      v.stati[m.modello] = { stato: 'da_decidere', ambito: null, alias: null, sub: n.sub === true, simile_a: n.simile_a ?? null, padre: n.padre ?? null };
      // cosa hanno deciso gli altri modelli: un suggerimento (non basta per decidere da solo)
      const pareri = [...(storia.get(n.codice) ?? [])].filter(([mm]) => mm !== m.modello).sort(([a], [b]) => a.localeCompare(b));
      if (pareri.length) v.stati[m.modello]!.suggerimento = pareri.map(([mm, p]) => `${statoDi(p.va, p.sub, p.alias, p.nosigla)} in ${mm}`).join('; ');
    }
  }
  for (const g of globali) {
    const v = voce(g.codice);
    v.tutti = statoDi(g.va, g.sub, g.alias, g.nosigla);
    v.alias ||= g.alias;
  }
  const lista = [...sigle.values()].sort((a, b) =>
    (ordine.has(a.codice) ? 0 : 1) - (ordine.has(b.codice) ? 0 : 1) || (ordine.get(a.codice) ?? 0) - (ordine.get(b.codice) ?? 0) || a.codice.localeCompare(b.codice));
  return { modelli, sigle: lista, da_decidere: daDecidere, gestione_modelli: await elencoModelli(), proposte_sigle: proposte };
}

interface Parere { va: boolean; sub: boolean; alias: string | null; nosigla: boolean; padre: string | null }

/** {codice: {modello: parere}}: cosa e' stato deciso per ogni sigla negli altri modelli (non «tutti»). */
export async function storiaSigle(): Promise<Map<string, Map<string, Parere>>> {
  const out = new Map<string, Map<string, Parere>>();
  for (const r of await db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null; nosigla: boolean; padre: string | null }[]>`
    SELECT modello, codice, va, sub, alias, nosigla, padre FROM ferrari_sigla WHERE modello <> ${TUTTI}`) {
    if (!out.has(r.codice)) out.set(r.codice, new Map());
    out.get(r.codice)!.set(r.modello, { va: r.va && !r.nosigla, sub: r.sub, alias: r.alias, nosigla: r.nosigla, padre: r.padre });
  }
  return out;
}

export const MIN_ACCORDO = 2;      // quando e' sicuro: almeno 2 altri modelli hanno deciso la sigla, tutti allo stesso modo
const chiave = (p: Parere) => JSON.stringify([p.va, p.sub, p.alias, p.nosigla, p.padre]);

/**
 * Le sigle ancora da decidere che almeno MIN_ACCORDO altri modelli hanno deciso allo stesso modo si decidono da sole
 * (segnate «auto», sempre modificabili). Quelle nuove o con pareri diversi restano da decidere. Ritorna quante ne ha decise.
 */
export async function ereditaPerModello(modello: string | null | undefined): Promise<number> {
  const m = (modello ?? '').trim().toUpperCase();
  if (!m) return 0;
  const { nuove } = await matrice(m, undefined, false);
  if (nuove.length === 0) return 0;
  const storia = await storiaSigle();
  let n = 0;
  for (const x of nuove) {
    const pareri = [...(storia.get(x.codice) ?? new Map<string, Parere>())].filter(([mm]) => mm !== m).map(([, p]) => p);
    if (pareri.length >= MIN_ACCORDO && new Set(pareri.map(chiave)).size === 1) {
      const p = pareri[0]!;
      await decidiSigla(UTENTE_AUTO, m, x.codice, p.va, false, p.sub, p.alias, { nosigla: p.nosigla, padre: p.padre, auto: true });
      n++;
    }
  }
  return n;
}
const UTENTE_AUTO: Utente = { id: 0, username: 'programma' };

/** Dopo una decisione, gli altri modelli possono ereditarla se ora c'e' abbastanza accordo. */
async function propaga(toccati: Set<string>) {
  try {
    for (const { modello } of await db<{ modello: string }[]>`SELECT DISTINCT modello FROM ferrari_file WHERE modello IS NOT NULL`) {
      if (!toccati.has(modello)) await ereditaPerModello(modello);
    }
  } catch { /* e' un di piu': la decisione e' gia' salvata */ }
}

export async function impostaSigla(user: Utente, codice: string, stato: StatoImpostabile, modelli: string[] | '*', alias?: string | null, padre?: string | null): Promise<number> {
  const n = await impostaSiglaBase(user, codice, stato, modelli, alias, padre);
  await propaga(new Set(Array.isArray(modelli) ? modelli.map(x => x.toUpperCase()) : []));
  return n;
}

/**
 * Imposta lo stato di una sigla per uno o piu' modelli, oppure per tutti (modelli = '*': sostituisce anche le scelte per modello).
 * Stato «reset»: la sigla torna da decidere. Ritorna quanti modelli ha toccato.
 */
async function impostaSiglaBase(user: Utente, codice: string, stato: StatoImpostabile, modelli: string[] | '*', alias?: string | null, padre?: string | null): Promise<number> {
  const c = normalizzaSigla(codice);
  if (!c || c.length > 60) throw new HTTPException(400, { message: 'Indicare la sigla o parola (max 60 caratteri)' });
  if (stato === 'alias' && !alias?.trim()) throw new HTTPException(400, { message: 'Indicare di quale sigla e\' un errore di scrittura' });
  const al = stato === 'alias' ? alias!.trim() : null;
  const extra = { nosigla: stato === 'nonsigla', padre: padre ?? null };
  const va = stato !== 'no' && stato !== 'nonsigla';
  if (modelli === '*') {
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      await tx`DELETE FROM ferrari_sigla WHERE codice = ${c} AND modello <> ${TUTTI}`;
      await audit(tx, user, 'sigla.per_tutti', 'sigla', c, { stato });
    });
    if (stato === 'reset') return togliDecisione(user, '', c, true);
    await decidiSigla(user, '', c, va, true, stato === 'sub', al, extra);
    return 1;
  }
  if (modelli.length === 0) throw new HTTPException(400, { message: 'Indicare i modelli' });
  for (const m of modelli) {
    if (stato === 'reset') await togliDecisione(user, m, c, false);
    else await decidiSigla(user, m, c, va, false, stato === 'sub', al, extra);
  }
  return modelli.length;
}

/** Decide in blocco le sigle ancora da decidere di un modello (colonna o no). Ritorna quante. */
export async function decidiTutteDaDecidere(user: Utente, modello: string, stato: 'colonna' | 'no'): Promise<number> {
  const m = await matrice(modello, undefined, false);
  if (!m.modello) return 0;
  for (const n of m.nuove) await decidiSigla(user, m.modello, n.codice, stato === 'colonna', false, stato === 'colonna' && n.sub === true);
  return m.nuove.length;
}

/** Copia UN componente (nome e termini) di un modello in altri modelli; se esiste gia' con quel nome lo sostituisce. */
export async function applicaComponente(user: Utente, da: string, nome: string, a: string[]): Promise<number> {
  const d = normModello(da);
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const sorgente = (await listaComponenti(tx, d)).find(c => stessoNome(c.nome, nome));
    if (!sorgente) throw new HTTPException(404, { message: 'Componente non trovato' });
    let n = 0;
    for (const x of a) {
      const m = normModello(x);
      if (m === d) continue;
      await scriviComponente(tx, m, sorgente.nome, sorgente.termini, null, user.username);
      n++;
    }
    await audit(tx, user, 'componente.applicato', 'componente', `${d}/${sorgente.nome}`, { a });
    return n;
  });
}
