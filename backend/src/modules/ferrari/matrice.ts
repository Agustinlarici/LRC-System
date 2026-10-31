// Matrice commesse × caratteristiche: una colonna per opzione trovata, in cella «Sì» oppure il dettaglio (colore, filo…).
// Stessa regola di STR-LocalAI/web/ferrari/matrice.py (la PC IA ne mostra una uguale, con il riassunto della IA nel dettaglio).

import { createHash } from 'node:crypto';
import { collapse, escapeRegExp, norm, phraseRegex } from './text.js';
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

/** `liberoForzato`: se dato (anche vuoto) sostituisce il testo libero mostrato (parti passate a una sotto-sigla). */
export function cellaOpzione(o: Opzione, dettaglio?: string | null, liberoForzato?: string): string {
  const classe = classeValore(o.valore);
  const libero = (liberoForzato ?? (dettaglio || testoLibero(o))).trim();
  const parti: string[] = [];
  if (classe === 'TESTO' || classe === 'NUMERO') parti.push(o.valore.trim());
  if (libero) parti.push(libero);
  const nota = o.nota.trim();
  if (nota && parti.length === 0 && classe !== 'SI') parti.push(nota);
  if (parti.length === 0) return classe === 'EXTRA' ? 'Extra campionario' : SI;
  const testo = parti.join(' · ');
  if (classe === 'EXTRA') return `Extra campionario — ${testo}`;
  return classe === 'SI' ? `${SI} — ${testo}` : testo;
}

/** Chiave di un testo lungo: stessa regola della PC IA (sha1 del testo normalizzato, spazi compressi). */
export function chiaveTesto(testo: string): string {
  // solo lettere e cifre: indipendente da spazi strani e punteggiatura
  return createHash('sha1').update(norm(testo).replace(/[^A-Z0-9]+/g, ' ').trim(), 'utf8').digest('hex');
}

/** Dettagli arrivati dalla PC IA: commessa → chiave del testo → dettaglio e stato. */
export type DettagliPerCommessa = Map<string, Map<string, { dettaglio: string; stato: string }>>;

export function dettagliValidi(commessa: string, opzioni: Opzione[], tutti?: DettagliPerCommessa): { testi: Record<string, string>; rivedere: Record<string, boolean> } {
  const out: Record<string, string> = {};
  const rivedere: Record<string, boolean> = {};
  const della = tutti?.get(commessa);
  if (!della) return { testi: out, rivedere };
  const visti = new Set<string>();
  for (const o of opzioni) {
    if (visti.has(o.codice)) continue;          // la cella usa la prima voce con quel codice
    visti.add(o.codice);
    // vale solo se il testo della scheda e' ancora quello da cui e' nato il riassunto
    const d = della.get(chiaveTesto(testoLibero(o)));
    if (!d) continue;
    if (d.dettaglio) out[o.codice] = d.dettaglio;
    if (d.stato === 'rivedere') rivedere[o.codice] = true;      // la IA non era sicura: serve una persona
  }
  return { testi: out, rivedere };
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
export interface CtxSigle {
  /** codice scritto → codice giusto, deciso da una persona */
  alias: ReadonlyMap<string, string>;
  /** codici gia' decisi (anche «no»): non si considerano errori di scrittura */
  decisi: ReadonlySet<string>;
}

/** True se i due codici differiscono per un solo carattere (sbagliato, in piu', in meno o due scambiati). */
export function entroUno(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0]! + 1 && a[diff[0]!] === b[diff[1]!] && a[diff[1]!] === b[diff[0]!];
  }
  const [corta, lunga] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < lunga.length; i++) if (lunga.slice(0, i) + lunga.slice(i + 1) === corta) return true;
  return false;
}

/** Il codice noto a un solo carattere di distanza (solo codici di almeno 4 caratteri); prima quelli della stessa lunghezza. */
export function simileA(codice: string, noti: Iterable<string>): string | null {
  if (codice.length < 4) return null;
  const vicini = [...noti].filter(s => s.length >= 4 && entroUno(codice, s));
  vicini.sort((x, y) => Number(x.length !== codice.length) - Number(y.length !== codice.length) || (x < y ? -1 : x > y ? 1 : 0));
  return vicini[0] ?? null;
}

export function cellaTermine(
  termine: string, opzioni: Opzione[], dettagli: Record<string, string> = {}, ctx?: CtxSigle,
): { testo: string; completo: string | null; opzione: Opzione | null; avviso: string | null } {
  const t = collapse(termine);
  if (!t) return { testo: '', completo: null, opzione: null, avviso: null };
  for (const o of opzioni) {
    const c = o.codice.toUpperCase();
    if (c === t || ctx?.alias.get(c) === t) {
      return { testo: cellaOpzione(o, dettagli[o.codice]), completo: testoLibero(o) || null, opzione: o, avviso: c === t ? null : `scritta ${c}, corretta in ${t}` };
    }
  }

  const rx = phraseRegex(termine);
  for (const o of opzioni) if (rx.test(norm(o.valore))) return { testo: o.valore.trim(), completo: null, opzione: o, avviso: null };
  for (const o of opzioni) {
    for (const b of o.blocchi_testo) {
      const m = rx.exec(norm(b.testo));
      if (m) return { testo: dettagli[o.codice] || estratto(b.testo, m.index, m.index + m[0].length), completo: testoLibero(o), opzione: o, avviso: null };
    }
  }
  for (const o of opzioni) if (rx.test(norm(o.descrizione)) || rx.test(norm(o.nota))) return { testo: SI, completo: null, opzione: o, avviso: null };
  // una sigla che non c'e': un codice della scheda a un carattere di distanza e MAI deciso e' un probabile errore di scrittura
  if (t.length >= 4 && /^[A-Z0-9]+$/.test(t) && ctx) {
    for (const o of opzioni) {
      const c = o.codice.toUpperCase();
      if (!ctx.decisi.has(c) && !ctx.alias.has(c) && entroUno(c, t)) {
        return { testo: cellaOpzione(o, dettagli[o.codice]), completo: testoLibero(o) || null, opzione: o, avviso: `scritta ${c} (suggerito ${t})` };
      }
    }
  }
  return { testo: '', completo: null, opzione: null, avviso: null };
}

export interface RigaMatrice {
  id: number; commessa: string; modello: string | null; paese: string | null; stato: string;
  celle: Record<string, string>; testi: Record<string, string>; rivedere: Record<string, boolean>;
  sub: Record<string, SottoSiglaTrovata[]>;
  avvisi: Record<string, string>;
  anomalie: { codice: string; riga: number | null; motivo: string; suggerito: string | null }[];
}

export interface SottoSiglaTrovata { codice: string; testo: string; avviso: string | null; scritto: string | null }

/** Per un modello: una riga per commessa, una colonna per ogni sigla/parola scelta. */
export function costruisciMatrice(
  schede: { id: number; stato: string; canonico: Canonico }[], termini: string[], dettagli?: DettagliPerCommessa, subOk: ReadonlySet<string> = new Set(),
  ctx?: CtxSigle, subPadre: ReadonlyMap<string, string> = new Map(),
): RigaMatrice[] {
  return schede.map(s => {
    const det = dettagliValidi(s.canonico.header.commessa ?? '', s.canonico.opzioni, dettagli);
    const celle: Record<string, string> = {};
    const testi: Record<string, string> = {};
    const rivedere: Record<string, boolean> = {};
    const sub: Record<string, SottoSiglaTrovata[]> = {};
    const avvisi: Record<string, string> = {};
    const propri = new Set(s.canonico.opzioni.map(o => o.codice));
    for (const t of termini) {
      const c = cellaTermine(t, s.canonico.opzioni, det.testi, ctx);
      if (det.rivedere[t]) rivedere[t] = true;
      if (c.avviso) avvisi[t] = c.avviso;
      celle[t] = c.testo;
      // solo le sotto-sigle di questa voce (o di nessuna voce in particolare)
      const subQui = new Set([...subOk].filter(x => (subPadre.get(x) ?? t) === t));
      if (c.opzione && subQui.size > 0) {
        const { resto, sub: dentro } = dividiSottoSigle(c.opzione, subQui, ctx, propri, det.testi[c.opzione.codice]);
        if (dentro.length > 0) {
          sub[t] = dentro;
          // cella dell'opzione: le parti passate alle sotto-sigle non si ripetono
          if (c.testo === cellaOpzione(c.opzione, det.testi[c.opzione.codice])) celle[t] = cellaOpzione(c.opzione, undefined, resto);
        }
      }
      if (c.completo) testi[t] = c.completo;
    }
    // righe toccate a mano nell'Excel (vedi anomalie.ts): in tabella con la correzione proposta
    const anomalie: RigaMatrice['anomalie'] = [];
    for (const o of s.canonico.opzioni) {
      for (const motivo of o.anomalie ?? []) {
        const sugg = o.suggerito ?? null;
        if (sugg && ctx && (ctx.alias.has(o.codice) || ctx.decisi.has(o.codice))) continue;   // gia' corretto (alias) o deciso («non e' una sigla»)
        anomalie.push({ codice: o.codice, riga: o.riga ?? null, motivo, suggerito: sugg });
        for (const t of new Set([o.codice, sugg])) if (t && termini.includes(t) && !avvisi[t]) avvisi[t] = `${o.codice}: ${motivo}`;
      }
      for (const a of o.scheda_anomalie ?? []) {
        if (ctx && s.canonico.opzioni.some(x => ctx.alias.get(x.codice) === a.codice)) continue;   // il codice mancante e' stato riconosciuto con un alias
        anomalie.push({ codice: a.codice, riga: a.riga, motivo: a.motivo, suggerito: null });
        if (a.codice && termini.includes(a.codice) && !avvisi[a.codice]) avvisi[a.codice] = a.motivo;
      }
    }
    return {
      id: s.id, commessa: s.canonico.header.commessa ?? '', modello: s.canonico.header.tipo_matricola.modello,
      paese: s.canonico.header.destinazione.paese, stato: s.stato, celle, testi, rivedere, sub, avvisi, anomalie,
    };
  });
}

// ─── Sotto-sigle: codici importanti dentro i testi liberi (es. TML5 dentro LIVR) ────────────────

const CANDIDATO = /(?<![A-Z0-9])(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{3,8}(?![A-Z0-9])/g;
const FRASI = /(?<=[.!?])\s+(?=[A-Z0-9])/;

/**
 * Le parole-codice (lettere e cifre, es. TML5, TLM13) del testo libero di un'opzione, con la frase che le contiene.
 * `escludi` = codici che sono gia' opzioni della scheda (quelli sono sigle normali). Stessa regola della PC IA.
 */
export function sottosigle(o: Opzione, escludi: ReadonlySet<string> = new Set()): { codice: string; frase: string }[] {
  const out: { codice: string; frase: string }[] = [];
  const viste = new Set<string>();
  for (const b of o.blocchi_testo) {
    for (const frase of b.testo.split(FRASI)) {
      for (const m of norm(frase).matchAll(CANDIDATO)) {
        const c = m[0];
        if (viste.has(c) || escludi.has(c) || c === o.codice.toUpperCase()) continue;
        viste.add(c);
        out.push({ codice: c, frase: frase.trim() });
      }
    }
  }
  return out;
}

/**
 * Le sotto-sigle accettate che compaiono nel testo libero di un'opzione, anche se scritte male (con avviso): il codice esatto,
 * un alias deciso da una persona, il codice con spazi o trattini (TL M5), un codice a un carattere di distanza (TLM15 per TLM16)
 * purche' mai deciso e non gia' un'opzione della scheda. Un elemento per sotto-sigla, nell'ordine del testo. Stessa regola della PC IA.
 */
export function sottosigleAccettate(
  o: Opzione, accettate: ReadonlySet<string>, ctx?: CtxSigle, propri: ReadonlySet<string> = new Set(),
): SottoSiglaTrovata[] {
  const out: SottoSiglaTrovata[] = [];
  const viste = new Set<string>();
  const ordinate = [...accettate].sort();
  for (const b of o.blocchi_testo) {
    for (const frase of b.testo.split(FRASI)) {
      const nf = norm(frase);
      const trovate: { pos: number; codice: string; scritto: string | null; avviso: string | null }[] = [];
      for (const m of nf.matchAll(/(?<![A-Z0-9])[A-Z0-9]{3,8}(?![A-Z0-9])/g)) {
        const t = m[0];
        const alias = ctx?.alias.get(t);
        if (accettate.has(t)) trovate.push({ pos: m.index!, codice: t, scritto: null, avviso: null });
        else if (alias && accettate.has(alias)) trovate.push({ pos: m.index!, codice: alias, scritto: t, avviso: `scritta ${t} (corretta in ${alias})` });
        else if (ctx && !ctx.decisi.has(t) && !propri.has(t)) {
          const vicini = ordinate.filter(s => s.length >= 4 && t.length >= 4 && entroUno(t, s))
            .sort((x, y) => Number(x.length !== t.length) - Number(y.length !== t.length) || (x < y ? -1 : 1));
          if (vicini.length === 1) trovate.push({ pos: m.index!, codice: vicini[0]!, scritto: t, avviso: `scritta ${t} (suggerito ${vicini[0]})` });
          else if (vicini.length > 1) trovate.push({ pos: m.index!, codice: t, scritto: t, avviso: `scritta ${t} (suggeriti ${vicini.join(' o ')})` });
        }
      }
      for (const s of ordinate) {                              // scritti con spazi o trattini: «TL M5», «TLM-13»
        if (s.length < 3) continue;
        const rx = new RegExp('(?<![A-Z0-9])' + [...s].map(escapeRegExp).join('[ \\-]?') + '(?![A-Z0-9])', 'g');
        for (const m of nf.matchAll(rx)) {
          if (m[0] !== s) {
            const scritto = frase.slice(m.index!, m.index! + m[0].length);
            trovate.push({ pos: m.index!, codice: s, scritto, avviso: `scritta «${scritto}»` });
          }
        }
      }
      for (const x of trovate.sort((p, q) => p.pos - q.pos)) {
        if (viste.has(x.codice)) continue;
        viste.add(x.codice);
        out.push({ codice: x.codice, testo: frase.trim(), avviso: x.avviso, scritto: x.scritto });
      }
    }
  }
  return out;
}

/**
 * Divide il testo libero di un'opzione tra le sotto-sigle accettate e il resto: ogni parte sta in UN solo posto.
 * Le parti sono i pezzi del riassunto della IA (separati da « | ») se c'e', altrimenti le frasi del testo. Una parte che contiene una
 * sotto-sigla accettata (anche scritta male) va a quella; le altre restano fuori. Stessa regola della PC IA.
 */
export function dividiSottoSigle(
  o: Opzione, accettate: ReadonlySet<string>, ctx?: CtxSigle, propri: ReadonlySet<string> = new Set(), det?: string,
): { resto: string; sub: SottoSiglaTrovata[] } {
  const parti = det?.trim()
    ? det.split(' | ').map(p => p.trim()).filter(Boolean)
    : o.blocchi_testo.flatMap(b => b.testo.split(FRASI)).map(p => p.trim()).filter(Boolean);
  const resto: string[] = [];
  const ordine: string[] = [];
  const per = new Map<string, { testi: string[]; avviso: string | null; scritto: string | null }>();
  for (const parte of parti) {
    const trovate = sottosigleAccettate({ ...o, blocchi_testo: [{ n: 0, righe: [], testo: parte }] }, accettate, ctx, propri);
    if (trovate.length === 0) { resto.push(parte); continue; }
    trovate.forEach((x, i) => {
      if (!per.has(x.codice)) { per.set(x.codice, { testi: [], avviso: x.avviso, scritto: x.scritto }); ordine.push(x.codice); }
      if (i === 0) per.get(x.codice)!.testi.push(parte);       // la parte va alla prima sotto-sigla che contiene; le altre mostrano solo il codice
    });
  }
  return {
    resto: resto.join(' | '),
    sub: ordine.map(c => ({ codice: c, testo: per.get(c)!.testi.join(' | '), avviso: per.get(c)!.avviso, scritto: per.get(c)!.scritto })),
  };
}

export interface SiglaNuova { codice: string; nome: string; esempio: string; sub?: boolean; padre?: string; simile_a?: string }

/** Sigle presenti nelle schede e non ancora decise (nell'ordine dell'Excel), con un esempio di cosa contengono. */
export function nuoveSigle(schede: { canonico: Canonico }[], decise: Set<string>, noti: Iterable<string> = []): SiglaNuova[] {
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
  const normali: SiglaNuova[] = ordine.filter(c => !decise.has(c)).map(codice => ({ codice, nome: nomi.get(codice) ?? '', esempio: esempi.get(codice) ?? SI }));
  // sotto-sigle non ancora decise: si chiede come per le sigle normali
  const sub = new Map<string, SiglaNuova>();
  for (const s of schede) {
    const propri = new Set(s.canonico.opzioni.map(o => o.codice));
    for (const o of s.canonico.opzioni) {
      for (const x of sottosigle(o, propri)) {
        if (!decise.has(x.codice) && !sub.has(x.codice)) {
          sub.set(x.codice, { codice: x.codice, nome: `dentro ${o.codice} — ${o.descrizione}`, esempio: x.frase.slice(0, 160), sub: true, padre: o.codice });
        }
      }
    }
  }
  const tutte = [...normali, ...sub.values()];
  const giusti = [...noti];
  for (const n of tutte) {                                  // avviso: assomiglia a un codice gia' accettato (errore di scrittura?)
    const vicino = simileA(n.codice, giusti);
    if (vicino) n.simile_a = vicino;
  }
  return tutte;
}
