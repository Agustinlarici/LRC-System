// Regole dei componenti (stile Outlook), parte pura: tipi, schemi e valutazione. Nessun database qui, cosi' si prova da sola.
//
// Una regola: SE (tutte / qualsiasi) le condizioni, SALVO le eccezioni, ALLORA aggiungi dei valori ai componenti.
// Le regole si applicano nell'ordine; se una regola scatta e ha «ferma», le seguenti non si applicano (come «Interrompi l'elaborazione
// di altre regole» di Outlook). I valori aggiunti allo stesso componente si sommano senza ripetersi.

import { z } from 'zod';
import { cellaOpzione, sottosigleAccettate, testoLibero, type CtxSigle } from './matrice.js';
import { collapse, norm, phraseRegex } from './text.js';
import type { Canonico, Opzione } from './types.js';

const Sigla = z.string().trim().min(1).max(60);
const Testo = z.string().trim().min(1).max(200);

export const CondizioneSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('presente'), sigla: Sigla }),                          // la scheda ha la sigla (anche dentro un testo)
  z.object({ tipo: z.literal('assente'), sigla: Sigla }),                           // la scheda NON ha la sigla
  z.object({ tipo: z.literal('valore'), sigla: Sigla, testo: Testo }),              // il valore della sigla e' questo (es. MRKT = CINA)
  z.object({ tipo: z.literal('testo'), sigla: z.string().trim().max(60).optional(), testo: Testo }),   // il testo (della sigla, o di tutta la scheda) contiene
]);
export type Condizione = z.infer<typeof CondizioneSchema>;

export const AzioneSchema = z.object({
  componente: z.string().trim().min(1).max(60),
  valore: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('sigla'), sigla: Sigla }),                           // la sigla (con la sua descrizione e il dettaglio della scheda)
    z.object({ tipo: z.literal('fisso'), testo: Testo }),                           // un testo fisso (es. EXAT)
    z.object({ tipo: z.literal('testo'), sigla: Sigla }),                           // il testo scritto nella scheda per quella sigla
  ]),
});
export type Azione = z.infer<typeof AzioneSchema>;

export const RegolaCompSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  attiva: z.boolean(),
  modello: z.string().trim().min(1).max(30).transform(m => m.toUpperCase()),        // '*' = tutti
  logica: z.enum(['tutte', 'qualsiasi']),
  condizioni: z.array(CondizioneSchema).max(20),
  eccezioni: z.array(CondizioneSchema).max(20),
  azioni: z.array(AzioneSchema).min(1).max(20),
  ferma: z.boolean(),
});
export type RegolaCompInput = z.infer<typeof RegolaCompSchema>;
export type RegolaComp = RegolaCompInput & { id: number };

export const MAX_REGOLE = 500;

// ─── Fatti: cosa c'e' nella scheda (quello che ha trovato la VM, con alias e sotto-sigle) ───

export interface Fatti {
  modello: string;
  sigle: ReadonlySet<string>;                    // codici delle voci (alias risolti) + sotto-sigle trovate nei testi
  valori: ReadonlyMap<string, string>;           // codice -> valore (spazi compressi, maiuscolo)
  testi: ReadonlyMap<string, string>;            // codice -> testo (valore, nota, testo libero) normalizzato
  voci: ReadonlyMap<string, Opzione>;            // codice -> voce della scheda (la prima con quel codice)
  dettagli: Readonly<Record<string, string>>;    // riassunti della IA per codice (se ci sono)
}

const sigla = (s: string) => norm(s).trim();

export function fattiDaScheda(c: Canonico, opts: { ctx?: CtxSigle; subOk?: ReadonlySet<string>; dettagli?: Record<string, string> } = {}): Fatti {
  const ctx = opts.ctx;
  const sigle = new Set<string>();
  const valori = new Map<string, string>();
  const testi = new Map<string, string>();
  const voci = new Map<string, Opzione>();
  const propri = new Set(c.opzioni.map(o => o.codice));
  for (const o of c.opzioni) {
    const cod = sigla(ctx?.alias.get(o.codice) ?? o.codice);            // un alias deciso da una persona vale come la sigla giusta
    sigle.add(cod);
    if (!voci.has(cod)) {
      voci.set(cod, o);
      valori.set(cod, collapse(o.valore));
      testi.set(cod, norm([o.valore, o.nota, testoLibero(o)].join(' ')));
    }
    if (opts.subOk && opts.subOk.size > 0) {
      for (const s of sottosigleAccettate(o, opts.subOk, ctx, propri)) if (opts.subOk.has(s.codice)) sigle.add(sigla(s.codice));
    }
  }
  return { modello: (c.header.tipo_matricola.modello ?? '').toUpperCase(), sigle, valori, testi, voci, dettagli: opts.dettagli ?? {} };
}

// ─── Valutazione ───

export function condizioneVera(c: Condizione, f: Fatti): boolean {
  switch (c.tipo) {
    case 'presente': return f.sigle.has(sigla(c.sigla));
    case 'assente': return !f.sigle.has(sigla(c.sigla));
    case 'valore': return f.valori.get(sigla(c.sigla)) === collapse(c.testo);
    case 'testo': {
      const rx = phraseRegex(c.testo, '');                       // parola intera: «AS06» non e' dentro «AS060»
      const dove = c.sigla?.trim() ? [f.testi.get(sigla(c.sigla)) ?? ''] : [...f.testi.values()];
      return dove.some(t => rx.test(t));
    }
  }
}

export function descrivi(c: Condizione): string {
  switch (c.tipo) {
    case 'presente': return `la scheda ha ${c.sigla}`;
    case 'assente': return `la scheda non ha ${c.sigla}`;
    case 'valore': return `${c.sigla} vale «${c.testo}»`;
    case 'testo': return c.sigla?.trim() ? `il testo di ${c.sigla} contiene «${c.testo}»` : `il testo della scheda contiene «${c.testo}»`;
  }
}

export interface VoceComp { testo: string; descrizione?: string; regole: { id: number; nome: string }[] }

export type EsitoRegola = 'scattata' | 'non_scattata' | 'eccezione' | 'fermata' | 'disattivata' | 'altro_modello';
export interface SpiegazioneRegola {
  id: number; nome: string; esito: EsitoRegola;
  condizioni: { testo: string; vera: boolean }[]; eccezioni: { testo: string; vera: boolean }[];
}
export interface RisultatoScheda { celle: Record<string, VoceComp[]>; regole: SpiegazioneRegola[] }

/** Cosa si aggiunge per una azione, dato quello che c'e' nella scheda. null = niente da aggiungere. */
function valoreAzione(a: Azione, f: Fatti): { chiave: string; testo: string; descrizione?: string } | null {
  const s = sigla('sigla' in a.valore ? a.valore.sigla : '');
  const voce = f.voci.get(s);
  switch (a.valore.tipo) {
    case 'fisso': return { chiave: `f:${collapse(a.valore.testo)}`, testo: a.valore.testo.trim() };
    case 'sigla': {
      const dett = voce ? cellaOpzione(voce, f.dettagli[voce.codice]).replace(/^Sì$/, '') : '';
      return { chiave: `s:${s}`, testo: dett ? `${s} — ${dett}` : s, descrizione: voce?.descrizione || undefined };
    }
    case 'testo': {
      if (!voce) return null;
      const t = (f.dettagli[voce.codice] || testoLibero(voce) || '').trim();
      return t ? { chiave: `t:${s}:${collapse(t)}`, testo: t } : null;
    }
  }
}

/** Applica le regole, nell'ordine, a una scheda. `spiega` dice per ogni regola perche' e' scattata o no. */
export function applicaRegole(regole: readonly RegolaComp[], f: Fatti): RisultatoScheda {
  const celle: Record<string, VoceComp[]> = {};
  const chiavi: Record<string, Set<string>> = {};
  const spiegazioni: SpiegazioneRegola[] = [];
  let fermata = false;
  for (const r of regole) {
    const base = { id: r.id, nome: r.nome };
    const cond = r.condizioni.map(c => ({ testo: descrivi(c), vera: condizioneVera(c, f) }));
    const ecc = r.eccezioni.map(c => ({ testo: descrivi(c), vera: condizioneVera(c, f) }));
    const spieg = (esito: EsitoRegola) => spiegazioni.push({ ...base, esito, condizioni: cond, eccezioni: ecc });
    if (!r.attiva) { spieg('disattivata'); continue; }
    if (r.modello !== '*' && r.modello !== f.modello) { spieg('altro_modello'); continue; }
    if (fermata) { spieg('fermata'); continue; }
    const ok = cond.length === 0 || (r.logica === 'tutte' ? cond.every(c => c.vera) : cond.some(c => c.vera));
    if (!ok) { spieg('non_scattata'); continue; }
    if (ecc.some(c => c.vera)) { spieg('eccezione'); continue; }
    for (const a of r.azioni) {
      const v = valoreAzione(a, f);
      if (!v) continue;
      const comp = a.componente.trim();
      const viste = (chiavi[comp] ??= new Set());
      const lista = (celle[comp] ??= []);
      if (viste.has(v.chiave)) {                                  // lo stesso valore da due regole: si ricorda chi lo ha prodotto, non si ripete
        lista.find(x => x.testo === v.testo)?.regole.push(base);
        continue;
      }
      viste.add(v.chiave);
      lista.push({ testo: v.testo, ...(v.descrizione ? { descrizione: v.descrizione } : {}), regole: [base] });
    }
    spieg('scattata');
    if (r.ferma) fermata = true;
  }
  return { celle, regole: spiegazioni };
}

/** Sigle citate da una regola (nelle condizioni, nelle eccezioni e nelle azioni): servono a dire quali sigle nessuna regola considera. */
export function sigleCitate(regole: readonly RegolaComp[]): Set<string> {
  const out = new Set<string>();
  for (const r of regole) {
    if (!r.attiva) continue;
    for (const c of [...r.condizioni, ...r.eccezioni]) if ('sigla' in c && c.sigla) out.add(sigla(c.sigla));
    for (const a of r.azioni) if ('sigla' in a.valore) out.add(sigla(a.valore.sigla));
  }
  return out;
}
