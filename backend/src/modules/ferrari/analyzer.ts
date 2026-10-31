// Analisi deterministica (senza IA) di una scheda canonica: codici noti, classificazione dei valori,
// componenti del testo libero (regole fisse + dizionario approvato) e parole non riconosciute.
// Nessuna rete, nessun modello: stesso input + stessa conoscenza = stesso risultato.

import { collapse, norm, phraseRegex } from './text.js';
import type {
  AnalisiVm, Canonico, ClasseValore, Componente, Conoscenza, ControlloMercato, Opzione, OpzioneVm,
  Residuo, UnitaTesto,
} from './types.js';

export const MOTORE_VM = 'ferrari-det-1';

/** Tipo speciale del dizionario: parole senza significato per la produzione (non si riportano ne' si confrontano). */
export const TIPO_NEUTRO = 'NEUTRO';

// Articoli e preposizioni: mai segnalati come sconosciuti.
const STOPWORDS = new Set([
  'A', 'AD', 'AL', 'ALLA', 'ALLE', 'AI', 'DA', 'DAL', 'DALLA', 'DI', 'DEL', 'DELLA', 'DELLE', 'DEI', 'DEGLI',
  'E', 'ED', 'IL', 'LO', 'LA', 'I', 'GLI', 'LE', 'UN', 'UNA', 'UNO', 'IN', 'NEL', 'NELLA', 'NELLE', 'CON', 'SU',
  'SUL', 'SULLA', 'PER', 'TRA', 'FRA', 'O',
]);

interface Regola { tipo: string; re: RegExp; valore: (m: RegExpExecArray) => string }

// Regole fisse (strutturali): non si imparano, fanno parte del motore.
const REGOLE: Regola[] = [
  {
    tipo: 'RIFERIMENTO_IMMAGINI',
    re: /(?<![A-Z0-9])(?:VEDERE\s+(?:IMMAGINI|IMMAGINE|VETTORIALI|FIGURINO|FOTO)|COME\s+DA\s+(?:IMMAGINE|IMMAGINI|FIGURINO))(?![A-Z0-9])/g,
    valore: () => 'VEDERE IMMAGINI',
  },
  { tipo: 'PLACEHOLDER', re: /(?<![A-Z0-9])(?:Z{3,}|X{4,})(?![A-Z0-9])/g, valore: m => m[0] },
  { tipo: 'CODICE_VERNICE', re: /COD\.?\s*VERN\.?\s*([A-Z0-9][A-Z0-9.*/-]*[A-Z0-9*])/g, valore: m => m[1]! },
  { tipo: 'LATO', re: /(?<![A-Z0-9])LATO\s+(GUIDATORE|PASSEGGERO)(?![A-Z0-9])/g, valore: m => m[1]! },
  { tipo: 'FILO', re: /(?<![A-Z0-9])FILO(?:\s+[A-Z]+){0,2}?\s+(\d{3,4})(?![A-Z0-9])/g, valore: m => m[1]! },
];

export function classificaValore(valore: string): ClasseValore {
  const v = collapse(valore);
  if (v === '') return 'VUOTO';
  if (v === 'SI') return 'SI';
  if (/^EXTRA\w*\s*-?\s*NOT\s*STAND\w*$/.test(v)) return 'EXTRACAMPIONARIO';
  if (/^\d+([.,]\d+)?$/.test(v)) return 'NUMERO';
  return 'TESTO';
}

interface Candidato {
  start: number; end: number; tipo: string; valore: string; origine: 'dizionario' | 'regola';
  priorita: number;                 // 0 = regola fissa, 1 = dizionario del modello, 2 = dizionario generale
}

function sceltaNonSovrapposta(cands: Candidato[]): Candidato[] {
  const ordinati = [...cands].sort((a, b) =>
    a.priorita - b.priorita || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const scelti: Candidato[] = [];
  for (const c of ordinati) {
    if (scelti.every(s => c.end <= s.start || c.start >= s.end)) scelti.push(c);
  }
  return scelti.sort((a, b) => a.start - b.start);
}

export function analizzaTesto(
  testo: string, modello: string | null, k: Conoscenza,
): { componenti: Componente[]; residuo: Residuo[]; flags: string[] } {
  const n = norm(testo);
  const cands: Candidato[] = [];

  for (const r of REGOLE) {
    const re = new RegExp(r.re.source, r.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(n)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      cands.push({ start: m.index, end: m.index + m[0].length, tipo: r.tipo, valore: r.valore(m), origine: 'regola', priorita: 0 });
    }
  }

  const modelloN = modello ? collapse(modello) : null;
  for (const e of k.componenti) {
    if (e.modello && collapse(e.modello) !== modelloN) continue;
    const re = phraseRegex(e.pattern);
    let m: RegExpExecArray | null;
    while ((m = re.exec(n)) !== null) {
      cands.push({
        start: m.index, end: m.index + m[0].length, tipo: e.tipo, valore: e.valore,
        origine: 'dizionario', priorita: e.modello ? 1 : 2,
      });
    }
  }

  const scelti = sceltaNonSovrapposta(cands);

  const componenti: Componente[] = scelti
    .filter(c => c.tipo !== TIPO_NEUTRO)
    .map(c => ({
      tipo: c.tipo, valore: c.valore, frammento: testo.slice(c.start, c.end),
      start: c.start, end: c.end, origine: c.origine,
    }));

  // Residuo: token non coperti da nessun riconoscimento e non stopword, uniti se separati da soli spazi.
  const coperto = new Array<boolean>(n.length).fill(false);
  for (const c of scelti) for (let i = c.start; i < c.end; i++) coperto[i] = true;

  const token: Residuo[] = [];
  const reTok = /[A-Z0-9][A-Z0-9.*/'"-]*/g;
  let t: RegExpExecArray | null;
  while ((t = reTok.exec(n)) !== null) {
    const start = t.index;
    let end = t.index + t[0].length;
    while (end > start && /[.,;:'"-]/.test(n[end - 1]!)) end--;
    if (end <= start) continue;
    let sovrapposto = false;
    for (let i = start; i < end; i++) if (coperto[i]) { sovrapposto = true; break; }
    if (sovrapposto) continue;
    if (STOPWORDS.has(n.slice(start, end))) continue;
    token.push({ testo: testo.slice(start, end), start, end });
  }
  const residuo: Residuo[] = [];
  for (const tk of token) {
    const prev = residuo[residuo.length - 1];
    if (prev && /^\s*$/.test(n.slice(prev.end, tk.start)) && !coperto.slice(prev.end, tk.start).some(Boolean)) {
      prev.end = tk.end;
      prev.testo = testo.slice(prev.start, prev.end);
    } else {
      residuo.push({ ...tk });
    }
  }

  const flags: string[] = [];
  if (componenti.some(c => c.tipo === 'RIFERIMENTO_IMMAGINI')) flags.push('immagini');
  if (componenti.some(c => c.tipo === 'PLACEHOLDER')) flags.push('placeholder');
  if (/ATTENZIONE/.test(n)) flags.push('attenzione');

  return { componenti, residuo, flags };
}

function chiaveCodice(codice: string, modello: string | null): string {
  return `${codice}|${modello ? collapse(modello) : ''}`;
}

function controlloMercato(c: Canonico): ControlloMercato {
  const tm = c.header.tipo_matricola;
  const dest = c.header.destinazione;
  const mrkt = c.opzioni.find(o => o.codice === 'MRKT');
  const valori: Record<string, string | null> = {
    codice_in_versione: tm.mercato_codice,
    codice_in_destinazione: dest.codice_mercato,
    matricola: tm.matricola,
    paese: dest.paese,
    opzione_mrkt: mrkt ? mrkt.valore : null,
  };
  if (!tm.mercato_codice) {
    return { coerente: true, dettaglio: 'non verificabile: codice mercato assente in TIPO E MATRICOLA', valori };
  }
  const problemi: string[] = [];
  if (dest.codice_mercato && dest.codice_mercato !== tm.mercato_codice) {
    problemi.push(`codice mercato in TIPO E MATRICOLA (${tm.mercato_codice}) ≠ DESTINAZIONE (${dest.codice_mercato})`);
  }
  if (tm.matricola && !tm.matricola.endsWith(tm.mercato_codice)) {
    problemi.push(`matricola ${tm.matricola} non termina con il codice mercato ${tm.mercato_codice}`);
  }
  if (mrkt && dest.paese && collapse(mrkt.valore) !== collapse(dest.paese)) {
    problemi.push(`opzione MRKT (${mrkt.valore}) ≠ DESTINAZIONE (${dest.paese})`);
  }
  return problemi.length
    ? { coerente: false, dettaglio: problemi.join('; '), valori }
    : { coerente: true, dettaglio: 'ok', valori };
}

function unita(o: Opzione, classe: ClasseValore, modello: string | null, k: Conoscenza): UnitaTesto[] {
  const out: UnitaTesto[] = [];
  const aggiungi = (origine: UnitaTesto['origine'], nIdx: number, righe: number[], testo: string) => {
    out.push({ origine, n: nIdx, righe, testo, ...analizzaTesto(testo, modello, k) });
  };
  if (classe === 'TESTO') aggiungi('valore', 0, [o.riga], o.valore);
  if (o.nota) aggiungi('nota', 0, [o.riga], o.nota);
  for (const b of o.blocchi_testo) aggiungi('blocco', b.n, b.righe, b.testo);
  return out;
}

export function analizzaVm(c: Canonico, k: Conoscenza): AnalisiVm {
  const modello = c.header.tipo_matricola.modello;
  const codici = new Map<string, { significato: string }>();
  for (const e of k.codici) codici.set(chiaveCodice(e.codice, e.modello), { significato: e.significato });

  const opzioni: OpzioneVm[] = c.opzioni.map(o => {
    const classe = classificaValore(o.valore);
    const noto = codici.get(chiaveCodice(o.codice, modello)) ?? codici.get(chiaveCodice(o.codice, null));
    return {
      riga: o.riga, sezione: o.sezione, codice: o.codice, descrizione: o.descrizione,
      valore: o.valore, classe_valore: classe, nota: o.nota,
      codice_noto: !!noto, significato: noto?.significato ?? null,
      unita: unita(o, classe, modello, k),
    };
  });

  return {
    motore: MOTORE_VM,
    versione_conoscenza: k.versione,
    header: c.header,
    mercato: controlloMercato(c),
    opzioni,
    anomalie: c.anomalie,
  };
}
