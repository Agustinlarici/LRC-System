// Righe «strane» di una scheda: una persona ha toccato l'Excel (codice scritto male, colonna spostata, valore cancellato...).
// Il programma non deve ne' scartarle in silenzio ne' fidarsi: le tiene, le segna e, quando puo', propone la correzione.
// Stesse regole di STR-LocalAI/web/ferrari/anomalie.py (misurate su schede vere: nessuna le attiva per errore).
//  - descrizione vuota ma valore pieno            -> colonna spostata
//  - valore, nota e testi tutti vuoti             -> valore mancante
//  - valore quasi «SI» ma non «SI» (SII, S1...)   -> valore sospetto
//  - descrizione «SI» e valore lungo              -> colonne scambiate
//  - stesso codice due volte nella scheda         -> codice ripetuto
//  - riga che sembra un'opzione con codice non noto ma a 1-2 caratteri (o con spazi) da uno noto -> codice scritto male
//  - contenuto che parte da una colonna diversa dalla A e riga NON letta -> riga spostata
//  - codice presente in TUTTE le altre schede del modello e assente qui -> possibile riga mancante
//  - descrizione diversa da quella che quel codice ha sempre nelle altre schede -> descrizione diversa / non corrisponde
//  - codice che nelle altre schede vale sempre «SI» e qui ha un altro valore    -> valore diverso dal solito

import { norm } from './text.js';
import type { Opzione } from './types.js';

const TOKEN = /^[A-Z0-9]{3,8}$/;
const STD = /^[A-Z0-9]{4}$/;                 // il codice di un'opzione: 4 caratteri
export const MIN_SCHEDE_RIFERIMENTO = 4;     // per dire «manca» servono almeno 4 altre schede dello stesso modello
export const MIN_RIF_CODICE = 3;             // per confrontare descrizione e valore di un codice servono almeno 3 altre schede che lo hanno

export interface RigaFoglio { riga: number; celle: string[] }
export interface Riferimento { descrizioni: Map<string, Set<string>>; si: Set<string> }

/** Distanza di Levenshtein (si ferma appena supera «massimo»). */
export function distanza(a: string, b: string, massimo = 2): number {
  if (Math.abs(a.length - b.length) > massimo) return massimo + 1;
  let prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prec[j]! + 1, cur[j - 1]! + 1, prec[j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    if (Math.min(...cur) > massimo) return massimo + 1;
    prec = cur;
  }
  return prec[b.length]!;
}

/** Il codice noto piu' vicino (distanza <= massimo, almeno 3 caratteri), o null. Con parita' vince il piu' corto. */
export function vicino(codice: string, noti: Iterable<string>, massimo = 2): string | null {
  let migliore: [number, number, string] | null = null;
  for (const n of noti) {
    if (n === codice || n.length < 3) continue;
    const d = distanza(codice, n, massimo);
    if (d > massimo) continue;
    const k: [number, number, string] = [d, Math.abs(n.length - codice.length), n];
    if (!migliore || k[0] < migliore[0] || (k[0] === migliore[0] && (k[1] < migliore[1] || (k[1] === migliore[1] && k[2] < migliore[2])))) migliore = k;
  }
  return migliore ? migliore[2] : null;
}

/** Il codice senza spazi, trattini o punti (CEX S -> CEXS). */
const compatto = (testo: string) => (testo ?? '').toUpperCase().replace(/[\s.\-_/]+/g, '');

/**
 * Dalle opzioni delle altre schede dello stesso modello: descrizioni per codice (solo se visto in almeno 3 schede)
 * e l'insieme dei codici che valgono sempre «SI».
 */
export function riferimento(altre: Opzione[][]): Riferimento {
  const descr = new Map<string, Set<string>>();
  const conta = new Map<string, number>();
  const tuttiSi = new Map<string, boolean>();
  for (const lista of altre) {
    for (const o of lista) {
      const c = (o.codice ?? '').toUpperCase();
      conta.set(c, (conta.get(c) ?? 0) + 1);
      if (!descr.has(c)) descr.set(c, new Set());
      descr.get(c)!.add(norm(o.descrizione ?? ''));
      tuttiSi.set(c, (tuttiSi.get(c) ?? true) && (o.valore ?? '').trim().toUpperCase() === 'SI');
    }
  }
  const descrizioni = new Map([...descr].filter(([c]) => (conta.get(c) ?? 0) >= MIN_RIF_CODICE));
  const si = new Set([...tuttiSi].filter(([c, v]) => v && (conta.get(c) ?? 0) >= MIN_RIF_CODICE).map(([c]) => c));
  return { descrizioni, si };
}

/**
 * Aggiunge a ogni opzione «anomalie» (frasi), aggiunge le opzioni delle righe che la lettura ha scartato ma che sembrano
 * opzioni con un problema (cosi' si puo' correggere) e, se manca un codice che hanno tutte le altre schede, lo scrive in
 * «scheda_anomalie» della prima opzione. Ritorna quante anomalie ha trovato.
 * `righe`: le righe non vuote del foglio; `noti`: codici gia' visti per lo stesso modello; `sempre`: codici presenti in tutte le altre schede.
 */
export function segna(opzioni: Opzione[], righe: RigaFoglio[], noti: ReadonlySet<string>, sempre: ReadonlySet<string> = new Set(), rif?: Riferimento): number {
  let n = 0;
  const viste = new Set(opzioni.map(o => o.riga).filter(Boolean));

  // 1) controlli sulle opzioni lette
  const comparse = new Map<string, number | string>();
  for (const o of opzioni) {
    const an: string[] = [];
    const desc = (o.descrizione ?? '').trim(), val = (o.valore ?? '').trim();
    if (!desc && val) an.push('colonna spostata: manca la descrizione');
    else if (!val && !(o.nota ?? '').trim() && o.blocchi_testo.length === 0) an.push("valore mancante (di solito c'e' «SI» o un dato)");
    if (val.toUpperCase() !== 'SI' && val.length <= 3 && val && distanza(val.toUpperCase(), 'SI', 1) <= 1 && val.toUpperCase() !== 'NO') {
      an.push(`valore sospetto «${val}» (di solito SI)`);
    }
    if (desc.toUpperCase() === 'SI' && val.length > 3) an.push("colonne scambiate: la descrizione e' «SI» e il valore e' un testo");
    const codice = (o.codice ?? '').toUpperCase();
    const attese = rif?.descrizioni.get(codice);
    if (rif && desc && attese && !attese.has(norm(desc))) {
      const solito = [...attese].sort()[0]!;
      const vicina = Math.min(...[...attese].map(d => distanza(norm(desc), d, 4))) <= 3;
      an.push(`${vicina ? 'descrizione diversa dal solito' : 'la descrizione non corrisponde al codice'}: «${desc.slice(0, 40)}» (di solito «${solito.slice(0, 40).toLowerCase()}»)`);
    }
    if (rif && rif.si.has(codice) && val && val.toUpperCase() !== 'SI' && !an.some(x => x.includes('valore sospetto'))) {
      an.push(`valore diverso dal solito: «${val.slice(0, 30)}» (di solito SI)`);
    }
    if (comparse.has(codice)) an.push(`codice ripetuto nella scheda (righe ${comparse.get(codice)} e ${o.riga || '?'})`);
    if (!comparse.has(codice)) comparse.set(codice, o.riga || '?');
    if (an.length) { o.anomalie = [...(o.anomalie ?? []), ...an]; n += an.length; }
  }

  // 2) forma di ogni riga del foglio (le opzioni stanno nelle colonne A, B, C e al massimo D) e righe che la lettura non ha preso
  const generali: { codice: string; riga: number; motivo: string }[] = [];
  const perRiga = new Map(opzioni.filter(o => o.riga).map(o => [o.riga, o] as const));
  for (const { riga, celle } of righe) {
    const pos = celle.map((x, k) => [x, k] as const).filter(([x]) => (x ?? '').trim()).map(([, k]) => k);
    if (pos.length === 0) continue;
    const k0 = pos[0]!;
    const primo = (celle[k0] ?? '').trim();
    const codice = primo.toUpperCase();
    const optLike = STD.test(codice) && pos.length >= 2;
    let forma: string[] = [];
    if (k0) forma.push(`riga spostata: il contenuto parte dalla colonna ${String.fromCharCode(65 + k0)} invece che dalla A`);
    let nuova: Opzione | null = null;
    if (!viste.has(riga) && pos.length >= 2) {                         // riga che sembra un'opzione e la lettura ha scartato
      let v: string | null = null;
      if (k0) {
        if (TOKEN.test(codice) && (noti.has(codice) || vicino(codice, noti))) {
          v = noti.has(codice) ? null : vicino(codice, noti);
          const resto = [...pos.slice(1).map(k => (celle[k] ?? '').trim()), '', '', ''];
          nuova = { riga, sezione: null, codice, descrizione: resto[0]!, valore: resto[1]!, nota: resto[2]!, blocchi_testo: [], anomalie: [...forma] };
        }
      } else if (!noti.has(codice)) {
        const comp = compatto(primo);
        if (comp !== codice && noti.has(comp)) v = comp;                // «CEX S»
        else if (TOKEN.test(codice)) v = vicino(codice, noti);
        if (v) {
          const c = [...celle.map(x => (x ?? '').trim()), '', '', '', ''];
          nuova = { riga, sezione: null, codice, descrizione: c[1]!, valore: c[2]!, nota: c[3]!, blocchi_testo: [], anomalie: [...forma] };
        }
      }
      if (nuova && v) { nuova.anomalie!.push(`codice non valido (suggerito ${v})`); nuova.suggerito = v; }
    }
    if (nuova) {
      opzioni.push(nuova);
      n += nuova.anomalie!.length;
    } else if (forma.length) {
      const letta = perRiga.get(riga);
      if (letta) {                                                      // opzione letta: l'avviso va sulla sua cella
        const gia = letta.anomalie ?? [];
        forma = forma.filter(m => !m.startsWith('riga spostata'));      // la riga e' stata letta bene: non serve dirlo
        letta.anomalie = [...gia, ...forma];
      } else {                                                          // testo o riga non capita: avviso generale con il numero di riga
        for (const m of forma) generali.push({ codice: optLike ? codice : '', riga, motivo: m });
      }
      n += forma.length;
    }
  }

  // 3) un codice che hanno tutte le altre schede e questa no
  let mancano: { codice: string; riga: number | null; motivo: string }[] = [];
  if (opzioni.length && sempre.size) {
    const presenti = new Set([...opzioni.map(o => (o.codice ?? '').toUpperCase()), ...opzioni.map(o => o.suggerito).filter((x): x is string => !!x)]);
    mancano = [...sempre].sort().filter(c => !presenti.has(c)).map(codice => ({ codice, riga: null, motivo: "riga mancante: c'e' in tutte le altre schede del modello" }));
    n += mancano.length;
  }
  if (opzioni.length && (generali.length || mancano.length)) opzioni[0]!.scheda_anomalie = [...generali, ...mancano];
  return n;
}
