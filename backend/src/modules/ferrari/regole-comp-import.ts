// Carica molte regole dei componenti da un Excel: una riga = una regola. Solo lettura e validazione: non salva niente
// (la pagina mette le regole nella bozza e le salva la persona).
//
// Colonne (la prima riga e' l'intestazione; l'ordine non conta, i nomi hanno qualche variante):
//   Se ha        sigle separate da + o , (tutte devono esserci). «MRKT=CINA» = il valore di MRKT e' CINA
//   Non ha       sigle separate da + o , (nessuna deve esserci)
//   Aggiungi a   componenti separati da virgola
//   Valore       cosa aggiungere. Vuoto = la sigla di «Se ha» (se ce n'e' una sola). Una sigla di «Se ha» = quella sigla (con la sua descrizione);
//                altro = un testo fisso. Piu' valori separati da virgola.
//   Modello      vuoto o «tutti» = tutti i modelli
//   Ferma        SI = dopo questa regola non si applicano le seguenti
//   Attiva       NO = la regola si carica disattivata (vuoto = attiva)
// L'ordine delle righe e' l'ordine di applicazione.

import * as XLSX from 'xlsx';
import { collapse, norm } from './text.js';
import { RegolaCompSchema, type RegolaCompInput } from './regole-comp-base.js';

export class ImportRegoleError extends Error {}

export interface ErroreRiga { riga: number; motivo: string }
export interface RisultatoImport { regole: RegolaCompInput[]; errori: ErroreRiga[]; righe: number }

const MAX_RIGHE = 2000;
const INTESTAZIONI: Record<'seHa' | 'nonHa' | 'aggiungi' | 'valore' | 'modello' | 'ferma' | 'attiva', string[]> = {
  seHa: ['SE HA', 'HA', 'SIGLA', 'SIGLE', 'CONDIZIONE', 'SE'],
  nonHa: ['NON HA', 'SENZA', 'SE NON HA', 'NON'],
  aggiungi: ['AGGIUNGI A', 'COMPONENTE', 'COMPONENTI', 'ALLORA', 'AGGIUNGI'],
  valore: ['VALORE', 'VALORI', 'COSA'],
  modello: ['MODELLO', 'MODELLI'],
  ferma: ['FERMA', 'STOP', 'ULTIMA'],
  attiva: ['ATTIVA', 'ATTIVO'],
};

const cella = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dividi = (s: string, sep: RegExp) => s.split(sep).map(x => x.trim()).filter(Boolean);
const SI = /^(SI|SÌ|S|X|1|YES|TRUE|VERO)$/i;
const SIGLA = /^[A-Z0-9][A-Z0-9.\-/]{0,59}$/;

export function leggiRegoleExcel(buf: Buffer): RisultatoImport {
  let righe: unknown[][];
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
    if (!ws) throw new ImportRegoleError('Il file non ha nessun foglio');
    righe = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
  } catch (e) {
    if (e instanceof ImportRegoleError) throw e;
    throw new ImportRegoleError('File illeggibile (serve un Excel .xlsx/.xls o un .csv)');
  }
  if (righe.length > MAX_RIGHE + 1) throw new ImportRegoleError(`Troppe righe (massimo ${MAX_RIGHE})`);

  // intestazione: la prima riga (entro le prime 5) che ha la colonna «Aggiungi a»
  let iInt = -1;
  const col: Partial<Record<keyof typeof INTESTAZIONI, number>> = {};
  for (let r = 0; r < Math.min(5, righe.length) && iInt < 0; r++) {
    const h = (righe[r] ?? []).map(x => collapse(cella(x)));
    const trova = (nomi: string[]) => h.findIndex(x => nomi.includes(x));
    if (trova(INTESTAZIONI.aggiungi) < 0) continue;
    iInt = r;
    for (const k of Object.keys(INTESTAZIONI) as (keyof typeof INTESTAZIONI)[]) { const i = trova(INTESTAZIONI[k]); if (i >= 0) col[k] = i; }
  }
  if (iInt < 0 || col.aggiungi === undefined) throw new ImportRegoleError('Non trovo la colonna «Aggiungi a»: scarica il modello e usa le sue intestazioni');
  if (col.seHa === undefined && col.nonHa === undefined) throw new ImportRegoleError('Serve almeno una colonna «Se ha» o «Non ha»');

  const regole: RegolaCompInput[] = [];
  const errori: ErroreRiga[] = [];
  let lette = 0;
  for (let r = iInt + 1; r < righe.length; r++) {
    const riga = righe[r] ?? [];
    const v = (k: keyof typeof INTESTAZIONI) => (col[k] === undefined ? '' : cella(riga[col[k]!]));
    if (![v('seHa'), v('nonHa'), v('aggiungi'), v('valore')].some(Boolean)) continue;            // riga vuota
    lette++;
    const n = r + 1;                                                                              // numero di riga come lo vede la persona in Excel
    const sigleHa = dividi(norm(v('seHa')), /[+,;\n]/);
    const sigleNon = dividi(norm(v('nonHa')), /[+,;\n]/);
    const componenti = dividi(v('aggiungi'), /[,;\n]/);
    const valoriTesto = dividi(v('valore'), /[,;\n]/);

    const condizioni: RegolaCompInput['condizioni'] = [];
    let problema = '';
    for (const t of sigleHa) {
      if (t.includes('=')) {
        const [sig, ...resto] = t.split('=');
        const testo = resto.join('=').trim();
        if (!sig?.trim() || !testo || !SIGLA.test(sig.trim())) { problema = `«${t}» non e' del tipo SIGLA=valore`; break; }
        condizioni.push({ tipo: 'valore', sigla: sig.trim(), testo });
      } else if (SIGLA.test(t)) condizioni.push({ tipo: 'presente', sigla: t });
      else { problema = `«${t}» non sembra una sigla`; break; }
    }
    for (const t of sigleNon) {
      if (problema) break;
      if (SIGLA.test(t)) condizioni.push({ tipo: 'assente', sigla: t }); else problema = `«${t}» non sembra una sigla`;
    }
    if (!problema && condizioni.length === 0) problema = 'manca la condizione (Se ha / Non ha)';
    if (!problema && componenti.length === 0) problema = 'manca il componente (Aggiungi a)';

    // cosa si aggiunge
    const presenti = condizioni.filter(c => c.tipo === 'presente').map(c => ('sigla' in c ? norm(c.sigla ?? '') : ''));
    const lista: ({ tipo: 'sigla'; sigla: string } | { tipo: 'fisso'; testo: string })[] = [];
    if (!problema) {
      if (valoriTesto.length === 0) {
        if (presenti.length === 1) lista.push({ tipo: 'sigla', sigla: presenti[0]! });
        else problema = 'manca il valore (con piu\' sigle in «Se ha» va indicato)';
      } else {
        for (const t of valoriTesto) lista.push(presenti.includes(norm(t).trim()) ? { tipo: 'sigla', sigla: norm(t).trim() } : { tipo: 'fisso', testo: t });
      }
    }
    if (problema) { errori.push({ riga: n, motivo: problema }); continue; }

    const m = collapse(v('modello'));
    const modello = !m || m === 'TUTTI' || m === '*' || m === 'TUTTE' ? '*' : m;
    const nome = `Se ${[...sigleHa, ...sigleNon.map(s => `non ${s}`)].join(' + ')} → ${componenti.join(', ')}`.slice(0, 80);
    const p = RegolaCompSchema.safeParse({
      nome, attiva: !/^(NO|N|0|FALSE|FALSO)$/i.test(v('attiva')), modello, logica: 'tutte', condizioni, eccezioni: [], ferma: SI.test(v('ferma')),
      azioni: componenti.flatMap(componente => lista.map(valore => ({ componente, valore }))),
    });
    if (!p.success) { errori.push({ riga: n, motivo: p.error.issues[0]?.message ?? 'riga non valida' }); continue; }
    regole.push(p.data);
  }
  if (lette === 0) throw new ImportRegoleError('Il file non ha nessuna regola sotto l\'intestazione');
  return { regole, errori, righe: lette };
}


// ─── Esportazione: le regole attuali nello stesso formato, per tenerne una copia o modificarle in massa e reimportarle ───

export interface RisultatoEsportazione { buffer: Buffer; esportate: number; nonEsportate: number }

/** La regola come riga di Excel, oppure il motivo per cui non ci sta (oppure, eccezioni, «testo contiene», testo della sigla…). */
function comeRiga(r: RegolaCompInput): { riga: string[] } | { motivo: string } {
  if (r.eccezioni.length > 0) return { motivo: 'ha eccezioni (salvo se)' };
  if (r.logica === 'qualsiasi' && r.condizioni.length > 1) return { motivo: 'usa «almeno una» condizione (oppure)' };
  if (r.condizioni.length === 0) return { motivo: 'non ha condizioni' };
  const ha: string[] = [];
  const non: string[] = [];
  let presenti = 0;
  for (const c of r.condizioni) {
    if (c.tipo === 'testo') return { motivo: 'usa «il testo contiene»' };
    const sig = norm(c.sigla).trim();
    if (!SIGLA.test(sig)) return { motivo: `la sigla «${c.sigla}» non e' leggibile in Excel` };
    if (c.tipo === 'presente') { ha.push(sig); presenti++; }
    else if (c.tipo === 'assente') non.push(sig);
    else {
      if (/[+,;\n]/.test(c.testo)) return { motivo: 'un valore contiene + , o ;' };
      ha.push(`${sig}=${c.testo}`);
    }
  }
  const sigleHa = new Set(ha.filter(x => !x.includes('=')));
  const perComponente = new Map<string, string[]>();
  for (const a of r.azioni) {
    if (/[,;\n]/.test(a.componente)) return { motivo: `il componente «${a.componente}» contiene una virgola` };
    let valore: string;
    if (a.valore.tipo === 'testo') return { motivo: 'aggiunge «il testo della sigla»' };
    if (a.valore.tipo === 'sigla') {
      valore = norm(a.valore.sigla).trim();
      if (!sigleHa.has(valore)) return { motivo: `aggiunge la sigla ${a.valore.sigla}, che non e' tra quelle di «Se ha»` };
    } else {
      valore = a.valore.testo.trim();
      if (/[,;\n]/.test(valore)) return { motivo: 'un testo fisso contiene una virgola' };
      if (sigleHa.has(norm(valore).trim())) return { motivo: `il testo «${valore}» si confonderebbe con una sigla di «Se ha»` };
    }
    const lista = perComponente.get(a.componente) ?? [];
    lista.push(valore);
    perComponente.set(a.componente, lista);
  }
  const comp = [...perComponente.keys()];
  const primo = perComponente.get(comp[0]!)!;
  if (comp.some(k => perComponente.get(k)!.join('\u0000') !== primo.join('\u0000'))) return { motivo: 'aggiunge valori diversi a componenti diversi' };
  const soloLaSigla = presenti === 1 && primo.length === 1 && primo[0] === ha.find(x => !x.includes('='));
  return { riga: [ha.join(' + '), non.join(' + '), comp.join(', '), soloLaSigla ? '' : primo.join(', '), r.modello === '*' ? '' : r.modello, r.ferma ? 'SI' : '', r.attiva ? '' : 'NO'] };
}

export function esportaRegoleExcel(regole: readonly RegolaCompInput[]): RisultatoEsportazione {
  const righe: string[][] = [];
  const fuori: string[][] = [];
  regole.forEach((r, i) => {
    const x = comeRiga(r);
    if ('riga' in x) righe.push(x.riga); else fuori.push([String(i + 1), r.nome, x.motivo]);
  });
  const wb = XLSX.utils.book_new();
  const foglio = XLSX.utils.aoa_to_sheet([['Se ha', 'Non ha', 'Aggiungi a', 'Valore', 'Modello', 'Ferma', 'Attiva'], ...righe]);
  foglio['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, foglio, 'Regole');
  if (fuori.length > 0) {
    const f2 = XLSX.utils.aoa_to_sheet([['Queste regole non stanno nel formato Excel: restano nella pagina Regole (non si perdono se importi questo file).'], [],
      ['N. regola', 'Regola', 'Perche\' non e\' qui'], ...fuori]);
    f2['!cols'] = [{ wch: 10 }, { wch: 80 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, f2, 'Non esportate');
  }
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, esportate: righe.length, nonEsportate: fuori.length };
}
