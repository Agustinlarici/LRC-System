// Componenti per modello e ricerca «commessa + componente» (stesse regole di STR-LocalAI/web/ferrari/componenti.py).

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { audit, caricaDettagli, type Utente } from './service.js';
import { cellaTermine, dettagliValidi, sottosigleAccettate, type CtxSigle, type SottoSiglaTrovata } from './matrice.js';
import { collapse, norm } from './text.js';
import type { Canonico } from './types.js';
import {
  listaComponenti, normModello, normNome, normTermini, proposteComponenti, scriviComponente, stessoNome, type Componente,
} from './componenti-base.js';

type Tx = typeof db;
const MAX_RISULTATI = 200;

export async function elencoComponenti(modello?: string) {
  const modelli = await db<{ modello: string; schede: number }[]>`
    SELECT modello, count(*)::int AS schede FROM ferrari_file
    WHERE stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND modello IS NOT NULL
    GROUP BY modello ORDER BY max(caricato_at) DESC`;
  const scelto = modello?.trim().toUpperCase() || modelli[0]?.modello || '';
  return {
    modello: scelto, modelli,
    componenti: scelto ? await listaComponenti(db, scelto) : [],
    proposte: await proposteComponenti(db),
  };
}

export async function salvaComponente(user: Utente, modello: string, nome: string, termini: string[], vecchio?: string) {
  const m = normModello(modello), n = normNome(nome), t = normTermini(termini);
  const salvato = await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const nomeFinale = await scriviComponente(tx, m, n, t, vecchio ?? null, user.username);
    await tx`DELETE FROM ferrari_comp_proposta WHERE modello = ${m} AND nome = ${nomeFinale}`;   // decisa a mano: superata
    await audit(tx, user, 'componente.salvato', 'componente', `${m}/${nomeFinale}`, { termini: t, vecchio: vecchio ?? null });
    return nomeFinale;
  });
  return { nome: salvato, termini: t };
}

export async function eliminaComponente(user: Utente, modello: string, nome: string): Promise<number> {
  const m = normModello(modello);
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const vec = (await listaComponenti(tx, m)).find(c => stessoNome(c.nome, nome));
    if (!vec) return 0;
    await tx`DELETE FROM ferrari_comp WHERE modello = ${m} AND nome = ${vec.nome}`;
    await audit(tx, user, 'componente.eliminato', 'componente', `${m}/${vec.nome}`, null);
    return 1;
  });
}

/** Copia i componenti di un modello in un altro (quelli con lo stesso nome non si toccano). */
export async function copiaComponenti(user: Utente, da: string, a: string): Promise<number> {
  const d = normModello(da), m = normModello(a);
  if (d === m) throw new HTTPException(400, { message: 'Scegli un altro modello' });
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const qui = await listaComponenti(tx, m);
    let n = 0;
    for (const c of await listaComponenti(tx, d)) {
      if (qui.some(x => stessoNome(x.nome, c.nome))) continue;
      await scriviComponente(tx, m, c.nome, c.termini, null, user.username);
      n++;
    }
    await audit(tx, user, 'componenti.copiati', 'componente', `${d}->${m}`, { aggiunti: n });
    return n;
  });
}

/** Sigle del modello il cui codice o la cui descrizione contengono q; piu' la parola stessa come termine libero. */
export async function suggerisciTermini(modello: string, q: string) {
  const m = normModello(modello);
  const cerca = collapse(q);
  if (cerca.length < 2) return [];
  const schede = await db<{ canonico: Canonico }[]>`
    SELECT canonico FROM ferrari_file
    WHERE modello = ${m} AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND canonico IS NOT NULL
    ORDER BY caricato_at DESC LIMIT 300`;
  const viste = new Set<string>();
  const out: { termine: string; nome: string; tipo: 'sigla' | 'parola' }[] = [];
  for (const s of schede) {
    for (const o of s.canonico.opzioni) {
      if (viste.has(o.codice)) continue;
      viste.add(o.codice);
      if (norm(o.codice).includes(cerca) || norm(o.descrizione).includes(cerca)) out.push({ termine: o.codice, nome: o.descrizione, tipo: 'sigla' });
    }
  }
  const lista = out.slice(0, 15);
  if (cerca.length >= 3) lista.push({ termine: cerca, nome: 'cerca questa parola nel testo', tipo: 'parola' });
  return lista;
}

export interface VoceTrovata {
  termine: string; codice: string; voce: string; testo: string; completo: string | null; rivedere: boolean;
  avviso: string | null;
  sub: SottoSiglaTrovata[];
}

/** Per ogni commessa del modello (che contiene q) e per ogni componente: cosa c'e' nella scheda. */
export async function cercaComponenti(modello?: string, q?: string, componente?: string) {
  const el = await elencoComponenti(modello);
  const m = el.modello;
  let comps: Componente[] = el.componenti;
  if (componente) comps = comps.filter(c => stessoNome(c.nome, componente));
  const cerca = (q ?? '').trim();
  const tutte = m
    ? await db<{ canonico: Canonico }[]>`
        SELECT canonico FROM ferrari_file
        WHERE modello = ${m} AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND canonico IS NOT NULL
        ORDER BY caricato_at DESC, id DESC LIMIT 1000`
    : [];
  const schede = tutte.filter(s => !cerca || (s.canonico.header.commessa ?? '').includes(cerca)).slice(0, MAX_RISULTATI);
  const dettagli = await caricaDettagli(schede.map(s => s.canonico.header.commessa ?? '').filter(Boolean));
  const decisioni = m
    ? await db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null }[]>`SELECT modello, codice, va, sub, alias FROM ferrari_sigla WHERE modello IN ('*', ${m})`
    : [];
  const stato = new Map<string, { va: boolean; sub: boolean; alias: string | null }>();
  for (const mod of ['*', m]) for (const r of decisioni.filter(x => x.modello === mod)) stato.set(r.codice, { va: r.va, sub: r.sub, alias: r.alias });   // il modello prevale
  const subOk = new Set([...stato].filter(([, d]) => d.va && d.sub && !d.alias).map(([c]) => c));
  const ctx: CtxSigle = {
    alias: new Map([...stato].filter(([, d]) => d.alias).map(([c, d]) => [c, d.alias!] as [string, string])),
    decisi: new Set(stato.keys()),
  };
  const risultati = schede.map(s => {
    const commessa = s.canonico.header.commessa ?? '';
    const det = dettagliValidi(commessa, s.canonico.opzioni, dettagli);
    const propri = new Set(s.canonico.opzioni.map(o => o.codice));
    return {
      commessa, versione: s.canonico.header.tipo_matricola.versione,
      componenti: comps.map(c => {
        const voci: VoceTrovata[] = [];
        const viste = new Set<unknown>();
        for (const t of c.termini) {
          const r = cellaTermine(t, s.canonico.opzioni, det.testi, ctx);
          if (!r.testo || !r.opzione || viste.has(r.opzione)) continue;     // la stessa voce trovata da due termini si mostra una volta
          viste.add(r.opzione);
          voci.push({ termine: t, codice: r.opzione.codice, voce: r.opzione.descrizione, testo: r.testo, completo: r.completo,
                      rivedere: det.rivedere[r.opzione.codice] === true,
                      avviso: r.avviso, sub: sottosigleAccettate(r.opzione, subOk, ctx, propri) });
        }
        return { nome: c.nome, vuoto: voci.length === 0, voci };
      }),
    };
  });
  return { modello: m, modelli: el.modelli, componenti: el.componenti.map(c => c.nome), risultati };
}

/** Accetta (diventa un componente locale) o rifiuta una proposta; senza modello/nome tratta tutte. */
export async function risolviProposteComponenti(user: Utente, accetta: boolean, modello?: string, nome?: string): Promise<number> {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    let n = 0;
    for (const p of await proposteComponenti(tx)) {
      if (modello && (p.modello !== modello.trim().toUpperCase() || !stessoNome(p.nome, nome ?? ''))) continue;
      if (accetta) await scriviComponente(tx, p.modello, p.nome, p.termini, null, user.username);
      await tx`DELETE FROM ferrari_comp_proposta WHERE modello = ${p.modello} AND nome = ${p.nome}`;
      await audit(tx, user, accetta ? 'componente.proposta_accettata' : 'componente.proposta_rifiutata', 'componente', `${p.modello}/${p.nome}`, { termini: p.termini });
      n++;
    }
    return n;
  });
}
