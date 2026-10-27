// Normalizzazione di una scheda Ferrari (.xls BIFF8 / .xlsx) in JSON canonico.
// Nessuna interpretazione: solo cambio di formato. Ogni riga si classifica dalla sua FORMA,
// mai dal numero di riga (l'ordine delle righe puo' cambiare). Regole in docs/FERRARI-FLUSSO.md §6.

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type {
  Anomalia, BloccoTesto, Canonico, CellaGrezza, HeaderScheda, Opzione,
} from './types.js';

export class SchedaError extends Error {
  constructor(message: string) { super(message); this.name = 'SchedaError'; }
}

export const SEZIONI = new Set([
  'ALLESTIMENTO', 'ESTERNI', 'CERCHI', 'INTERNI', 'TAPPETI/SOVRATAPPETI',
  'EQUIPAGGIAMENTI', 'N.D.', 'NO_TICKET_REQUIRED',
]);

const ETICHETTE = {
  'COMMESSA':         'commessa',
  'VARIANTE':         'variante',
  'TIPO E MATRICOLA': 'tipo_matricola',
  'DESTINAZIONE':     'destinazione',
  'NUMERO DI TELAIO': 'telaio',
} as const;
type Etichetta = typeof ETICHETTE[keyof typeof ETICHETTE];

const RE_CODICE = /^[A-Z0-9]{4}$/;
const RE_LATO   = /^LATO\s+(GUIDATORE|PASSEGGERO)\b/i;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_COLONNE = 12;

function colLetter(c: number): string {
  let s = '';
  let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function cellToText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/[   ]/g, ' ').trim();
}

function formatFromMagic(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'xls-biff8';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  throw new SchedaError('Il file non è un Excel valido (.xls / .xlsx)');
}

interface RigaLetta { riga: number; celle: string[]; numeri: boolean[] }

function leggiFoglio(buf: Buffer): { righe: RigaLetta[]; sheet: string; anomalie: Anomalia[]; celle: CellaGrezza[] } {
  if (buf.length === 0) throw new SchedaError('File vuoto');
  if (buf.length > MAX_BYTES) throw new SchedaError('File troppo grande');

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, bookVBA: true });
  } catch (e) {
    throw new SchedaError(`File illeggibile o protetto da password (${(e as Error).message})`);
  }
  if ((wb as unknown as { vbaraw?: unknown }).vbaraw) {
    throw new SchedaError('Il file contiene macro VBA: non viene analizzato');
  }
  if (wb.SheetNames.length === 0) throw new SchedaError('Nessun foglio nel file');

  const anomalie: Anomalia[] = [];
  const sheetName = wb.SheetNames[0]!;
  const sheetsMeta = (wb.Workbook?.Sheets ?? []) as { Hidden?: number }[];
  wb.SheetNames.forEach((name, i) => {
    if (i === 0) return;
    const ws = wb.Sheets[name];
    const hasData = !!ws && Object.keys(ws).some(k => !k.startsWith('!'));
    if (sheetsMeta[i]?.Hidden) {
      anomalie.push({ tipo: 'foglio_nascosto', riga: null, livello: 'attenzione', dettaglio: `Foglio nascosto "${name}"` });
    } else if (hasData) {
      anomalie.push({ tipo: 'foglio_extra', riga: null, livello: 'attenzione', dettaglio: `Altro foglio con dati "${name}" (ignorato)` });
    }
  });
  if (sheetsMeta[0]?.Hidden) {
    anomalie.push({ tipo: 'foglio_nascosto', riga: null, livello: 'attenzione', dettaglio: `Il foglio analizzato "${sheetName}" è nascosto` });
  }

  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) throw new SchedaError('Il foglio è vuoto');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const righe: RigaLetta[] = [];
  const celle: CellaGrezza[] = [];
  const ncols = Math.min(range.e.c + 1, MAX_COLONNE);

  for (let r = range.s.r; r <= range.e.r; r++) {
    const testi: string[] = [];
    const numeri: boolean[] = [];
    let any = false;
    for (let c = 0; c < ncols; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const t = cellToText(cell?.v);
      testi.push(t);
      numeri.push(typeof cell?.v === 'number');
      if (t) {
        any = true;
        celle.push({ addr: `${colLetter(c)}${r + 1}`, riga: r + 1, col: c, value: t });
      }
    }
    if (any) righe.push({ riga: r + 1, celle: testi, numeri });
  }
  return { righe, sheet: sheetName, anomalie, celle };
}

function parseHeader(valori: Partial<Record<Etichetta, RigaLetta>>, anomalie: Anomalia[]): HeaderScheda {
  const get = (e: Etichetta, i: number): string | null => {
    const t = valori[e]?.celle[i] ?? '';
    return t === '' ? null : t;
  };

  // VARIANTE: B = codice, C = "revisione  gg.mm.aaaa hh:mm"
  const varianteRaw = get('variante', 2);
  let revisione: string | null = null;
  let data: string | null = null;
  if (varianteRaw) {
    const m = /^(\d+)\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(varianteRaw.replace(/\s+/g, ' ').trim());
    if (m) { revisione = m[1]!; data = `${m[4]}-${m[3]}-${m[2]}T${m[5]}:${m[6]}`; }
    else revisione = varianteRaw;
  }

  // TIPO E MATRICOLA: B = "MODELLO - VERSIONE/MM SIG [MYxx]", C = "matricola progressivo"
  const tipoRaw = get('tipo_matricola', 1);
  let modello: string | null = null;
  let versione: string | null = null;
  let mercatoCodice: string | null = null;
  let mercatoSigla: string | null = null;
  if (tipoRaw) {
    const compat = tipoRaw.replace(/\s+/g, ' ').trim();
    const sep = compat.indexOf(' - ');
    if (sep > 0) {
      modello = compat.slice(0, sep).trim().toUpperCase();
      versione = compat.slice(sep + 3).trim().toUpperCase();
    } else {
      modello = compat.split(' ')[0]!.toUpperCase();
      anomalie.push({ tipo: 'modello_senza_separatore', riga: valori.tipo_matricola?.riga ?? null, livello: 'attenzione',
        dettaglio: `TIPO E MATRICOLA senza " - ": "${compat}"` });
    }
    const mm = /\/(\d{2,3})\s+([A-Z]{2,4})\b/.exec(versione ?? '');
    if (mm) { mercatoCodice = mm[1]!; mercatoSigla = mm[2]!; }
  }
  const matr = (get('tipo_matricola', 2) ?? '').split(/\s+/).filter(Boolean);

  // DESTINAZIONE: B = paese, C = "MRKT  <sigla> <paese> <codice>"
  const mrktRaw = get('destinazione', 2);
  let codiceMercato: string | null = null;
  if (mrktRaw) {
    const m = /(\d{2,3})\s*$/.exec(mrktRaw.trim());
    if (m) codiceMercato = m[1]!;
  }

  const telaio = get('telaio', 1);
  if (valori.telaio?.numeri[1] && telaio) {
    anomalie.push({ tipo: 'numero_come_testo', riga: valori.telaio.riga, livello: 'info',
      dettaglio: `NUMERO DI TELAIO letto come numero (${telaio}): eventuali zeri iniziali non sono recuperabili` });
  }

  return {
    commessa: get('commessa', 1),
    variante: { codice: get('variante', 1), revisione, data },
    tipo_matricola: {
      raw: tipoRaw, modello, versione, mercato_codice: mercatoCodice, mercato_sigla: mercatoSigla,
      matricola: matr[0] ?? null, progressivo: matr[1] ?? null,
    },
    destinazione: { paese: get('destinazione', 1), codice_mercato: codiceMercato, raw_mrkt: mrktRaw },
    telaio,
  };
}

export function parseScheda(buf: Buffer, filename: string): Canonico {
  const format = formatFromMagic(buf);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const { righe, sheet, anomalie, celle } = leggiFoglio(buf);

  const etichette: Partial<Record<Etichetta, RigaLetta>> = {};
  const opzioni: Opzione[] = [];
  let sezione: string | null = null;
  let corrente: Opzione | null = null;
  let bloccoAperto = false;

  for (const r of righe) {
    const a = r.celle[0] ?? '';
    const resto = r.celle.slice(1).some(t => t !== '');
    const aUp = a.toUpperCase();

    if (a === '') {
      anomalie.push({ tipo: 'riga_ignota', riga: r.riga, livello: 'attenzione',
        dettaglio: `Riga senza testo nella prima colonna: ${r.celle.filter(Boolean).join(' | ')}` });
      continue;
    }

    // 1. testata
    const etichetta = (ETICHETTE as Record<string, Etichetta>)[aUp];
    if (etichetta) {
      if (etichette[etichetta]) {
        anomalie.push({ tipo: 'testata_duplicata', riga: r.riga, livello: 'attenzione', dettaglio: `${aUp} compare più volte` });
      } else {
        etichette[etichetta] = r;
      }
      continue;
    }

    // 2. sezione (insieme chiuso, puo' ripetersi): interrompe l'opzione corrente
    if (!resto && SEZIONI.has(aUp)) {
      if (aUp !== 'ALLESTIMENTO' && aUp !== 'NO_TICKET_REQUIRED') sezione = aUp;
      corrente = null;
      bloccoAperto = false;
      continue;
    }

    // 3. opzione: codice di 4 caratteri + almeno un'altra cella
    if (RE_CODICE.test(aUp) && resto) {
      corrente = {
        riga: r.riga, sezione, codice: aUp,
        descrizione: r.celle[1] ?? '', valore: r.celle[2] ?? '', nota: r.celle[3] ?? '',
        blocchi_testo: [],
      };
      opzioni.push(corrente);
      bloccoAperto = false;
      continue;
    }

    // 4. testo libero: cella unica che non e' una sezione → appartiene all'opzione sopra
    if (!resto) {
      if (!corrente) {
        anomalie.push({ tipo: 'testo_orfano', riga: r.riga, livello: 'attenzione', dettaglio: `Testo senza opzione precedente: ${a}` });
        continue;
      }
      const blocchi: BloccoTesto[] = corrente.blocchi_testo;
      if (blocchi.length === 0 || !bloccoAperto || RE_LATO.test(a)) {
        blocchi.push({ n: blocchi.length, righe: [r.riga], testo: a });
      } else {
        const b = blocchi[blocchi.length - 1]!;
        b.righe.push(r.riga);
        b.testo += ' ' + a;
      }
      bloccoAperto = true;
      continue;
    }

    // 6. non classificabile: mai scartata in silenzio
    anomalie.push({ tipo: 'riga_ignota', riga: r.riga, livello: 'attenzione',
      dettaglio: `Riga non riconosciuta: ${r.celle.filter(Boolean).join(' | ')}` });
  }

  if (!etichette.commessa || !etichette.tipo_matricola) {
    throw new SchedaError('Testata mancante: servono almeno COMMESSA e TIPO E MATRICOLA');
  }
  if (opzioni.length === 0) throw new SchedaError('Nessuna opzione riconosciuta nella scheda');

  const header = parseHeader(etichette, anomalie);
  if (!header.commessa) throw new SchedaError('COMMESSA vuota');
  if (!header.tipo_matricola.modello) throw new SchedaError('Modello non identificabile in TIPO E MATRICOLA');

  return {
    schema_version: 1,
    source: { filename, sha256, format, sheet },
    header,
    opzioni,
    anomalie,
    celle,
  };
}
