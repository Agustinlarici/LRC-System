/**
 * Parser posizionale per file EDI Ferrari/Maserati DELINS (formato Intesa).
 * Porta fedele della logica Python in C:\Users\ALarici\Documents\edi_translator\core\parser.py
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isUncPath, listUncFolderWithMtime, readUncFile } from '../../lib/smb-writer.js';

// ─── Tipo record ──────────────────────────────────────────────────────────────

export const CAMPI_OUTPUT = [
  'source_file',
  'num_programma', 'data_documento', 'mittente', 'fornitore', 'app_reference',
  'tipo_messaggio', 'data_validita',
  'codice_stabilimento',
  'codice_articolo', 'commessa', 'descrizione', 'um', 'num_contratto', 'pos_contratto',
  'frequenza_codice', 'frequenza', 'tipo_documento',
  'ft3_testo',
  'data_calcolo', 'progressivo_programmato', 'progressivo_ricevuto', 'anticipo_ritardo',
  'pdn_num_rimesso', 'pdn_data_rimesso', 'pdn_qty_dichiarata', 'pdn_qty_ricevuta', 'pdn_data_ricevimento',
  'data_consegna', 'quantita', 'tipo_schedulazione_codice', 'tipo_schedulazione',
] as const;

export type FerrariRow = Record<typeof CAMPI_OUTPUT[number], string>;

// ─── Definizione formato ──────────────────────────────────────────────────────

interface CampoDef {
  nome: string;
  pos: number;
  lung: number;
  tipo?: string;
  raw?: boolean;
  obbligatorio?: boolean;
  lstrip_zero?: boolean;
  mappa?: Record<string, string>;
  separatore?: string;
}

interface SegmentoDef {
  campi: CampoDef[];
  accumulare?: boolean;
}

const TIPO_REC_POS  = 18;
const TIPO_REC_LUNG = 3;
const SEGMENTO_OUTPUT = 'DEL';

const GERARCHIA = ['MID', 'ARI', 'CSG', 'ARD', 'SAD', 'FT3', 'DST', 'PDN', 'DEL'] as const;

const SEGMENTI: Record<string, SegmentoDef> = {
  MID: {
    campi: [
      { nome: 'num_programma',   pos: 1,   lung: 17, tipo: 'testo' },
      { nome: 'data_documento',  pos: 21,  lung: 6,  tipo: 'data_yymmdd' },
      { nome: 'mittente',        pos: 66,  lung: 35, tipo: 'testo' },
      { nome: 'fornitore',       pos: 119, lung: 35, tipo: 'testo' },
      { nome: 'app_reference',   pos: 188, lung: 14, tipo: 'testo' },
    ],
  },
  ARI: {
    campi: [
      { nome: 'tipo_messaggio', pos: 21, lung: 1, tipo: 'testo' },
      { nome: 'data_validita',  pos: 22, lung: 6, tipo: 'data_yymmdd' },
    ],
  },
  CSG: {
    campi: [
      { nome: 'codice_stabilimento', pos: 216, lung: 17, tipo: 'testo' },
    ],
  },
  ARD: {
    campi: [
      { nome: 'codice_articolo', pos: 21,  lung: 9,  tipo: 'testo' },
      { nome: 'commessa',        pos: 31,  lung: 6,  tipo: 'testo' },
      { nome: 'descrizione',     pos: 91,  lung: 35, tipo: 'testo' },
      { nome: 'um',              pos: 276, lung: 3,  tipo: 'testo' },
      { nome: 'num_contratto',   pos: 279, lung: 10, tipo: 'testo', lstrip_zero: true },
      { nome: 'pos_contratto',   pos: 289, lung: 4,  tipo: 'testo', lstrip_zero: true },
    ],
  },
  SAD: {
    campi: [
      { nome: 'frequenza_codice', pos: 222, lung: 2, tipo: 'testo' },
      { nome: 'frequenza', pos: 222, lung: 2, tipo: 'testo',
        mappa: { '2': 'Giornaliera', '3': 'Settimanale', '4': 'Mensile', '5': 'Da ordini chiusi' } },
      { nome: 'tipo_documento', pos: 222, lung: 2, tipo: 'testo',
        mappa: { '2': 'Forecast', '3': 'Forecast', '4': 'Forecast', '5': 'Ordine chiuso' } },
    ],
  },
  FT3: {
    accumulare: true,
    campi: [
      { nome: 'ft3_testo', pos: 21, lung: 210, tipo: 'testo', raw: true },
    ],
  },
  DST: {
    campi: [
      { nome: 'data_calcolo',             pos: 21, lung: 6,  tipo: 'data_yymmdd' },
      { nome: 'progressivo_programmato',  pos: 31, lung: 10, tipo: 'numero' },
      { nome: 'progressivo_ricevuto',     pos: 41, lung: 10, tipo: 'numero' },
      { nome: 'anticipo_ritardo',         pos: 51, lung: 10, tipo: 'testo' },
    ],
  },
  PDN: {
    accumulare: true,
    campi: [
      { nome: 'pdn_num_rimesso',     pos: 21, lung: 17, tipo: 'testo' },
      { nome: 'pdn_data_rimesso',    pos: 38, lung: 6,  tipo: 'data_yymmdd' },
      { nome: 'pdn_qty_dichiarata',  pos: 44, lung: 10, tipo: 'numero' },
      { nome: 'pdn_qty_ricevuta',    pos: 54, lung: 10, tipo: 'numero' },
      { nome: 'pdn_data_ricevimento',pos: 64, lung: 6,  tipo: 'data_yymmdd' },
    ],
  },
  DEL: {
    campi: [
      { nome: 'data_consegna',            pos: 21, lung: 6,  tipo: 'data_yymmdd', obbligatorio: true },
      { nome: 'quantita',                 pos: 52, lung: 15, tipo: 'numero' },
      { nome: 'tipo_schedulazione_codice',pos: 85, lung: 1,  tipo: 'testo' },
      { nome: 'tipo_schedulazione',       pos: 85, lung: 1,  tipo: 'testo',
        mappa: { '1': 'Ordine di consegna', '4': 'Forecast' } },
    ],
  },
};

// ─── Helpers di parsing ───────────────────────────────────────────────────────

function estrai(line: string, pos: number, lung: number, raw = false): string {
  const s   = pos - 1;
  const end = s + lung;
  const val = end <= line.length
    ? line.slice(s, end)
    : s < line.length ? line.slice(s) : '';
  return raw ? val : val.trim();
}

function converti(val: string, campo: CampoDef): string {
  const tipo = campo.tipo ?? 'testo';
  const v    = val.trim();

  if (tipo === 'data_yymmdd') {
    if (!v || v === '000000') return '';
    const yy = v.slice(0, 2), mm = v.slice(2, 4), dd = v.slice(4, 6);
    const year = parseInt(yy, 10) >= 70 ? `19${yy}` : `20${yy}`;
    return `${dd}/${mm}/${year}`;
  }

  if (tipo === 'data_yyyymmdd') {
    if (!v || v === '00000000') return '';
    const yyyy = v.slice(0, 4), mm = v.slice(4, 6), dd = v.slice(6, 8);
    return `${dd}/${mm}/${yyyy}`;
  }

  if (tipo === 'numero') {
    return v.replace(/^0+/, '') || '0';
  }

  // testo
  let result = v;
  if (campo.lstrip_zero) result = result.replace(/^0+/, '');
  if (campo.mappa)       result = campo.mappa[result] ?? result;
  return result;
}

function parseSegmento(line: string, campi: CampoDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const campo of campi) {
    const raw = estrai(line, campo.pos, campo.lung, campo.raw ?? false);
    out[campo.nome] = converti(raw, campo);
  }
  return out;
}

// ─── Parser principale (un singolo file) ─────────────────────────────────────

export function parseFerrariFile(content: string, filename: string): FerrariRow[] {
  const lines = content.split(/\r?\n/);

  const stato: Record<string, Record<string, string>> = {};
  const accumulati: Record<string, Record<string, string>> = {};
  for (const seg of GERARCHIA) stato[seg] = {};

  const righe: FerrariRow[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r?\n$/, '');
    if (line.length < TIPO_REC_POS + TIPO_REC_LUNG - 1) continue;

    const tipo = estrai(line, TIPO_REC_POS, TIPO_REC_LUNG);
    if (!(tipo in SEGMENTI)) continue;

    const defSeg = SEGMENTI[tipo];

    // Quando entriamo in un segmento di livello più alto, resettiamo tutto sotto
    const gIdx = (GERARCHIA as readonly string[]).indexOf(tipo);
    if (gIdx !== -1) {
      for (let i = gIdx + 1; i < GERARCHIA.length; i++) {
        const segSotto = GERARCHIA[i];
        stato[segSotto] = {};
        delete accumulati[segSotto];
      }
    }

    const valori = parseSegmento(line, defSeg.campi);

    if (defSeg.accumulare) {
      if (!accumulati[tipo]) accumulati[tipo] = {};
      for (const campo of defSeg.campi) {
        const sep = campo.separatore ?? ' | ';
        const prev = accumulati[tipo][campo.nome];
        accumulati[tipo][campo.nome] = prev ? `${prev}${sep}${valori[campo.nome]}` : valori[campo.nome];
      }
    } else if (gIdx !== -1) {
      stato[tipo] = valori;
    }

    if (tipo === SEGMENTO_OUTPUT) {
      // Controlla campi obbligatori
      let skip = false;
      for (const campo of defSeg.campi) {
        if (campo.obbligatorio && !valori[campo.nome]) { skip = true; break; }
      }
      if (skip) continue;

      // Costruisce la riga raccogliendo da tutti i livelli
      const riga: Record<string, string> = { source_file: filename };
      for (const seg of GERARCHIA) {
        Object.assign(riga, stato[seg] ?? {});
        if (accumulati[seg]) Object.assign(riga, accumulati[seg]);
      }
      Object.assign(riga, valori);

      // Proietta sui campi_output
      const rigaOut = {} as FerrariRow;
      for (const col of CAMPI_OUTPUT) {
        rigaOut[col] = riga[col] ?? '';
      }
      righe.push(rigaOut);
    }
  }

  return righe;
}

// ─── Scanner di cartella ──────────────────────────────────────────────────────

export type ScanRow = FerrariRow & { file_mtime: Date | null };

export interface ScanResult {
  rows:            ScanRow[];
  files_processed: number;
  files_skipped:   number;
  errors:          { file: string; error: string }[];
}

export async function scanFerrariFolder(folderPath: string): Promise<ScanResult> {
  const unc = isUncPath(folderPath);

  // Lista file con date di modifica (locale o SMB)
  let fileEntries: { name: string; mtime: Date | null }[];
  if (unc) {
    fileEntries = await listUncFolderWithMtime(folderPath);
  } else {
    const entries = await readdir(folderPath, { withFileTypes: true });
    fileEntries = await Promise.all(
      entries.filter(e => e.isFile()).map(async e => ({
        name:  e.name,
        mtime: await stat(join(folderPath, e.name)).then(s => s.mtime).catch(() => null),
      }))
    );
  }

  const rows: ScanRow[] = [];
  let   files_processed = 0;
  let   files_skipped   = 0;
  const errors: { file: string; error: string }[] = [];

  for (const { name: filename, mtime: file_mtime } of fileEntries) {
    try {
      let content: string;
      if (unc) {
        const buf = await readUncFile(folderPath, filename);
        content = buf.toString('latin1');
      } else {
        content = await readFile(join(folderPath, filename), { encoding: 'latin1' });
      }

      const parsed = parseFerrariFile(content, filename);
      if (parsed.length > 0) {
        rows.push(...parsed.map(r => ({ ...r, file_mtime })));
        files_processed++;
      } else {
        files_skipped++;
      }
    } catch (err) {
      errors.push({ file: filename, error: (err as Error).message });
      files_skipped++;
    }
  }

  return { rows, files_processed, files_skipped, errors };
}
