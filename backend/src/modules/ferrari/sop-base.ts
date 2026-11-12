// Controllo con il SOP: lettura dell'Excel del SOP, regole per ricavare ogni colonna dalla scheda e confronto. Funzioni pure, senza database.
// Il SOP e' un riepilogo fatto a mano (una riga per commessa, una colonna per componente: ANT, ALI POST, CODINI, COLORE, LIVREA...).
// Molte colonne dicono «il valore base» quando nella scheda non c'e' scritto niente (es. CODINI = EXAT se non c'e' EXAB).

import * as XLSX from 'xlsx';
import { collapse } from './text.js';
import type { Opzione } from './types.js';

// ─── Regole ───────────────────────────────────────────────────────────────────

/** Un elenco di sigle: se la scheda ne ha, il valore sono quelle (con la loro etichetta se scritta «COD=ETICHETTA»); se no, il valore base. */
export interface RegolaSigle { tipo: 'sigle'; sigle: string[]; base: string; unisci: string }
/**
 * Il colore: il colore del SOP deve coincidere con il valore di UNA delle sigle di colore presenti nella scheda (PNCC, PNT1, PNTE...).
 * Se il SOP dice `extra` (EXTRACAMPIONARIO) basta che il valore di una di quelle sigle lo contenga («EXTRACAMPIONARIO-NOT STANDARD»).
 * EXTC non e' nell'elenco di default: il suo valore dice «extra» anche quando il colore vero e' di gamma.
 */
export interface RegolaColore { tipo: 'colore'; codici: string[]; extra: string }
export const CODICI_COLORE = ['PNCC', 'PNT1', 'PNTE', 'PNTN', 'PNT0', 'PNTH', 'PNMT', 'PNTD', 'PNTI'];
/** Il mercato: il valore di MRKT tradotto con una tabella (GIAPPONE → EUROPA/GIAPPONE). */
export interface RegolaMercato { tipo: 'mercato'; mappa: Record<string, string> }
export type ParametriRegola = RegolaSigle | RegolaColore | RegolaMercato;
export type RegolaNominata = ParametriRegola & { colonna: string };
export type Regola = RegolaNominata & { ordine: number };

/** Regole suggerite: le risposte date per il F171VS (il valore base quando non c'e' scritto niente) e le categorie delle livree e dei componenti. */
export const REGOLE_SUGGERITE: Regola[] = (() => {
  const s = (colonna: string, sigle: string[], base = '', unisci = '/'): RegolaNominata => ({ colonna, tipo: 'sigle', sigle, base, unisci });
  const lista: RegolaNominata[] = [
    { colonna: 'MERCATO', tipo: 'mercato', mappa: { 'GIAPPONE': 'EUROPA/GIAPPONE', 'U.S.A.': 'USA', 'USA': 'USA', 'CINA': 'CINA' } },
    { colonna: 'COLORE', tipo: 'colore', codici: CODICI_COLORE, extra: 'EXTRACAMPIONARIO' },
    s('ANT', ['PACF'], 'PUR'),
    s('SP. LAT.', ['FCWS']),
    s('SENSORI', ['PAR2'], '-'),
    s('TEL ANT.', ['SURR=SV'], '-'),
    s('POST', ['SPCF'], 'PUR'),
    s('SCIVOLO', ['CEXD']),
    s('TEL. POST', ['SURR=SV'], 'RACAM'),
    s('RADAR POST', ['BRAD'], '-'),
    s('ALI POST', ['WING'], 'PUR'),
    s('CODINI', ['EXAB'], 'EXAT'),
    s('LIVREA', ['PN5X', 'PNT5', 'PN1X', 'PN10', 'LI01', 'LI02', 'LI03', 'LI04', 'LI05', 'LI06', 'LI07', 'LI08', 'LIT1', 'LIT2', 'SFCX', 'SFCL', 'AS01', 'AS03', 'AS06', 'AS07', 'TMSP', 'LI5X', 'LI1X']),
    s('DREAM.', ['DRM1', 'DRM2', 'DRMX']),
    s('CAVAL.', ['HBMB', 'HBSA', 'FBMB']),
    s('CARB.', ['CASP', 'FCWX', 'CEDX', 'CECE', 'CECM']),
    s('PLAST.', ['PPE1']),
    s('GRIGLIE', ['GPE1']),
    s('STRATI VERN.', ['PNCC', 'PNT1', 'PNTE', 'PNTN', 'PNT0', 'PNTH', 'PNMT', 'PNTD', 'PNTI']),
  ];
  return lista.map((r, i): Regola => ({ ...r, ordine: i }));
})();

// ─── Lettura del SOP ──────────────────────────────────────────────────────────

export interface RigaSop { commessa: string; valori: Record<string, string> }
export interface FoglioSop { colonne: string[]; righe: RigaSop[]; conDati: number }

export class SopError extends Error {}

const cella = (v: unknown): string => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Il primo foglio: la riga 1 ha i nomi delle colonne (serve COMMESSA); ogni riga dopo e' una commessa. */
export function leggiSop(buf: Buffer): FoglioSop {
  let righe: unknown[][];
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
    if (!ws) throw new SopError('Il file non ha nessun foglio');
    righe = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
  } catch (e) {
    if (e instanceof SopError) throw e;
    throw new SopError('File Excel illeggibile');
  }
  const intestazione = (righe[0] ?? []).map(cella);
  const iCom = intestazione.findIndex(h => collapse(h) === 'COMMESSA');
  if (iCom < 0) throw new SopError('Nella prima riga manca la colonna COMMESSA: non sembra il riepilogo del SOP');
  const colonne = intestazione.filter((h, i) => h && i !== iCom);
  const viste = new Set<string>();
  const out: RigaSop[] = [];
  let conDati = 0;
  for (const r of righe.slice(1)) {
    const commessa = cella(r[iCom]);
    if (!commessa || viste.has(commessa)) continue;                 // senza commessa o ripetuta: la prima vale
    viste.add(commessa);
    const valori: Record<string, string> = {};
    intestazione.forEach((h, i) => { if (h && i !== iCom) valori[h] = cella(r[i]); });
    if (Object.values(valori).some(v => v !== '')) conDati++;
    out.push({ commessa, valori });
  }
  if (out.length === 0) throw new SopError('Nessuna commessa nel file');
  return { colonne, righe: out, conDati };
}

// ─── Ricavare una colonna dalla scheda ────────────────────────────────────────

export interface Ricavato { valore: string; nota?: 'senza_regola'; candidati?: string[] }

const lc = (s: string) => collapse(s);

export function ricava(opzioni: readonly Pick<Opzione, 'codice' | 'valore'>[], r: ParametriRegola): Ricavato {
  const codici = new Map(opzioni.map(o => [lc(o.codice), o]));
  if (r.tipo === 'sigle') {
    const trovate = r.sigle.map(voce => {
      const [cod, ...et] = voce.split('=');
      return codici.has(lc(cod ?? '')) ? (et.length ? et.join('=').trim() : lc(cod ?? '')) : null;
    }).filter((x): x is string => x !== null);
    return { valore: trovate.length ? [...new Set(trovate)].join(r.unisci || '/') : r.base };
  }
  if (r.tipo === 'colore') {
    const codiciColore = new Set(r.codici.map(lc));
    const candidati = opzioni.filter(o => codiciColore.has(lc(o.codice))).map(o => cella(o.valore)).filter(v => v !== '');
    return { valore: candidati.join(' | '), candidati };
  }
  const m = opzioni.find(o => lc(o.codice) === 'MRKT');
  const grezzo = cella(m?.valore);
  if (!grezzo) return { valore: '' };
  const mappa = new Map(Object.entries(r.mappa).map(([k, v]) => [lc(k), v]));
  const tradotto = mappa.get(lc(grezzo));
  return tradotto !== undefined ? { valore: tradotto } : { valore: grezzo, nota: 'senza_regola' };
}

// ─── Confronto ────────────────────────────────────────────────────────────────

/** «4 GLOSS» = «4GLOSS»; «AS07/AS06» = «AS06/AS07»; «-» = vuoto. Maiuscole e spazi non contano. */
export function gettoni(v: string): string[] {
  return v.toUpperCase().replace(/\s+/g, '').split('/').filter(t => t !== '' && t !== '-').sort();
}

export type EsitoCella = 'ok' | 'diverso' | 'solo_sop' | 'solo_vm';

const compatto = (v: string) => v.toUpperCase().replace(/\s+/g, '');

/** Il colore: il SOP coincide con uno dei valori delle sigle di colore della scheda (o dice `extra` e uno di quei valori lo contiene). */
export function confrontaColore(sop: string, candidati: readonly string[], extra: string): EsitoCella {
  const a = gettoni(sop).join('/');
  if (a === '') return candidati.length ? 'solo_vm' : 'ok';
  if (candidati.length === 0) return 'solo_sop';
  const e = compatto(extra);
  const trovato = candidati.some(c => gettoni(c).join('/') === a || (e !== '' && compatto(sop) === e && compatto(c).includes(e)));
  return trovato ? 'ok' : 'diverso';
}

export function confrontaCella(sop: string, vm: string): EsitoCella {
  const a = gettoni(sop), b = gettoni(vm);
  if (a.join('/') === b.join('/')) return 'ok';
  if (b.length === 0) return 'solo_sop';
  if (a.length === 0) return 'solo_vm';
  return 'diverso';
}

export interface Differenza { commessa: string; file_id: number; colonna: string; sop: string; vm: string; tipo: Exclude<EsitoCella, 'ok'>; nota?: string }
export interface StatoColonna { colonna: string; ok: number; diverso: number; solo_sop: number; solo_vm: number }

/** Una riga del SOP contro le opzioni di una scheda: gli esiti di ogni colonna con regola. */
export function confrontaRiga(
  riga: RigaSop, fileId: number, opzioni: readonly Pick<Opzione, 'codice' | 'valore'>[], regole: readonly Regola[],
): { celle: { colonna: string; esito: EsitoCella; sop: string; vm: string; nota?: string }[]; differenze: Differenza[] } {
  const celle = regole.filter(r => r.colonna in riga.valori).map(r => {
    const vm = ricava(opzioni, r);
    const sop = riga.valori[r.colonna] ?? '';
    const esito = r.tipo === 'colore' ? confrontaColore(sop, vm.candidati ?? [], r.extra) : confrontaCella(sop, vm.valore);
    return { colonna: r.colonna, esito, sop, vm: vm.valore, ...(vm.nota ? { nota: vm.nota } : {}) };
  });
  const differenze = celle.filter(c => c.esito !== 'ok').map(c => ({
    commessa: riga.commessa, file_id: fileId, colonna: c.colonna, sop: c.sop, vm: c.vm, tipo: c.esito as Differenza['tipo'], ...(c.nota ? { nota: c.nota } : {}),
  }));
  return { celle, differenze };
}

/** Una riga del SOP «piena»: ha almeno un dato oltre alla commessa (le altre sono commesse ancora da compilare). */
export const rigaConDati = (r: RigaSop): boolean => Object.values(r.valori).some(v => v !== '');
