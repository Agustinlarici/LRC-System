import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { pickCol } from '../spma/import-logic.js';

export interface ImportResult {
  total_rows: number;
  upserted:   number;
  skipped:    number;
  warnings:   string[];
}

function readRows(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null });
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function emptyResult(totalRows: number, warning: string): ImportResult {
  return { total_rows: totalRows, upserted: 0, skipped: totalRows, warnings: [warning] };
}

// ─── Aree di montaggio ─────────────────────────────────────────────────────────
// Colonne: Codice, Descrizione

export async function importAree(buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers = Object.keys(rows[0] ?? {});
  const colCode = pickCol(headers, 'Codice', 'Code');
  const colDesc = pickCol(headers, 'Descrizione', 'Description', 'Nome', 'Area');
  if (!colCode || !colDesc) {
    return emptyResult(rows.length, 'Colonne minime mancanti: Codice, Descrizione');
  }

  let upserted = 0, skipped = 0;
  const warnings: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const code = str(rows[i][colCode]);
    const description = str(rows[i][colDesc]);
    if (!code || !description) {
      skipped++; warnings.push(`Riga ${i + 2}: Codice/Descrizione mancante`);
      continue;
    }
    await db`
      INSERT INTO prod_area_montaggio (code, description) VALUES (${code}, ${description})
      ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
    `;
    upserted++;
  }
  return { total_rows: rows.length, upserted, skipped, warnings: warnings.slice(0, 100) };
}

// ─── Articoli assegnati a un'area ──────────────────────────────────────────────
// Colonna: Codice Articolo. Sostituisce interamente la lista dell'area (come il
// textarea manuale).

export async function importAreaArticoli(areaId: number, buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers = Object.keys(rows[0] ?? {});
  const colCode = pickCol(headers, 'Codice Articolo', 'Articolo', 'Codice', 'Article Code');
  if (!colCode) return emptyResult(rows.length, 'Colonna Codice Articolo mancante');

  const codes = [...new Set(rows.map(r => str(r[colCode])).filter(Boolean))];

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    await tx`DELETE FROM prod_area_article WHERE area_id = ${areaId}`;
    if (codes.length > 0) {
      const values = codes.map(article_code => ({ area_id: areaId, article_code }));
      await tx`INSERT INTO prod_area_article ${tx(values)}`;
    }
  });

  return { total_rows: rows.length, upserted: codes.length, skipped: rows.length - codes.length, warnings: [] };
}

// ─── Regole parole chiave ──────────────────────────────────────────────────────
// Colonne: Prefisso Commessa, Categoria, Parola Chiave, Significato (=
// Caratteristica Derivata), Note. Per il modo prossimità (opzionale):
// Parola Ancora, Parola Obiettivo, Distanza Max Caratteri.
// Riga con "Parola Chiave" → modo simple. Riga senza, ma con Ancora+Obiettivo → proximity.

export async function importKeywordRules(buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers   = Object.keys(rows[0] ?? {});
  const colPref   = pickCol(headers, 'Prefisso Commessa', 'Prefisso', 'PrefissoCommessa');
  const colCat    = pickCol(headers, 'Categoria');
  const colParola = pickCol(headers, 'Parola Chiave', 'ParolaChiave');
  const colSign   = pickCol(headers, 'Significato', 'Caratteristica Derivata', 'CaratteristicaDerivata');
  const colNote   = pickCol(headers, 'Note', 'Nota');
  const colAncora = pickCol(headers, 'Parola Ancora', 'Ancora');
  const colObiett = pickCol(headers, 'Parola Obiettivo', 'Obiettivo');
  const colDist   = pickCol(headers, 'Distanza Max Caratteri', 'Distanza', 'Distanza Massima');

  if (!colPref || !colCat || !colSign) {
    return emptyResult(rows.length, 'Colonne minime mancanti: Prefisso Commessa, Categoria, Significato/Caratteristica Derivata');
  }

  let upserted = 0, skipped = 0;
  const warnings: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prefisso = str(row[colPref]);
    const categoria = str(row[colCat]);
    const significato = str(row[colSign]);
    const note = colNote ? (str(row[colNote]) || null) : null;
    const parolaChiave = colParola ? str(row[colParola]) : '';
    const ancora  = colAncora ? str(row[colAncora]) : '';
    const obiettivo = colObiett ? str(row[colObiett]) : '';
    const distanza = colDist ? parseInt(str(row[colDist]), 10) : NaN;

    if (!prefisso || !categoria || !significato) {
      skipped++; warnings.push(`Riga ${i + 2}: Prefisso/Categoria/Significato mancante`);
      continue;
    }

    if (parolaChiave) {
      await db`
        INSERT INTO prod_keyword_rules
          (prefisso_commessa, categoria, caratteristica_derivata, modo, parola_chiave, note)
        VALUES (${prefisso}, ${categoria}, ${significato}, 'simple', ${parolaChiave}, ${note})
        ON CONFLICT (prefisso_commessa, categoria, parola_chiave) WHERE modo = 'simple'
        DO UPDATE SET caratteristica_derivata = EXCLUDED.caratteristica_derivata, note = EXCLUDED.note
      `;
      upserted++;
    } else if (ancora && obiettivo && Number.isInteger(distanza) && distanza > 0) {
      await db`
        INSERT INTO prod_keyword_rules
          (prefisso_commessa, categoria, caratteristica_derivata, modo, parola_ancora, parola_obiettivo, distanza_max_caratteri, note)
        VALUES (${prefisso}, ${categoria}, ${significato}, 'proximity', ${ancora}, ${obiettivo}, ${distanza}, ${note})
        ON CONFLICT (prefisso_commessa, categoria, parola_ancora, parola_obiettivo) WHERE modo = 'proximity'
        DO UPDATE SET caratteristica_derivata = EXCLUDED.caratteristica_derivata, distanza_max_caratteri = EXCLUDED.distanza_max_caratteri, note = EXCLUDED.note
      `;
      upserted++;
    } else {
      skipped++;
      warnings.push(`Riga ${i + 2}: né Parola Chiave né (Ancora+Obiettivo+Distanza) validi`);
    }
  }

  return { total_rows: rows.length, upserted, skipped, warnings: warnings.slice(0, 100) };
}

// ─── Parole chiave colore ──────────────────────────────────────────────────────
// Colonne: Parola Chiave, Colore

export async function importColorKeywords(buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers = Object.keys(rows[0] ?? {});
  const colParola = pickCol(headers, 'Parola Chiave', 'ParolaChiave', 'Keyword');
  const colColore = pickCol(headers, 'Colore', 'Color');
  if (!colParola || !colColore) {
    return emptyResult(rows.length, 'Colonne minime mancanti: Parola Chiave, Colore');
  }

  let upserted = 0, skipped = 0;
  const warnings: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const keyword = str(rows[i][colParola]);
    const color = str(rows[i][colColore]);
    if (!keyword || !color) {
      skipped++; warnings.push(`Riga ${i + 2}: Parola Chiave/Colore mancante`);
      continue;
    }
    await db`
      INSERT INTO prod_color_keywords (keyword, color) VALUES (${keyword}, ${color})
      ON CONFLICT (keyword) DO UPDATE SET color = EXCLUDED.color
    `;
    upserted++;
  }
  return { total_rows: rows.length, upserted, skipped, warnings: warnings.slice(0, 100) };
}

// ─── Nomi categoria per attributi BC ───────────────────────────────────────────
// Colonne: Item Attribute ID, Nome Categoria

export async function importItemAttributeLabels(buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers = Object.keys(rows[0] ?? {});
  const colId    = pickCol(headers, 'Item Attribute ID', 'ID Attributo', 'Attribute ID');
  const colLabel = pickCol(headers, 'Nome Categoria', 'Categoria', 'Label');
  if (!colId || !colLabel) {
    return emptyResult(rows.length, 'Colonne minime mancanti: Item Attribute ID, Nome Categoria');
  }

  let upserted = 0, skipped = 0;
  const warnings: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const idVal = parseInt(str(rows[i][colId]), 10);
    const label = str(rows[i][colLabel]);
    if (!Number.isInteger(idVal) || !label) {
      skipped++; warnings.push(`Riga ${i + 2}: Item Attribute ID/Nome Categoria non valido`);
      continue;
    }
    await db`
      INSERT INTO prod_item_attribute_label (item_attribute_id, categoria_label, active, updated_at)
      VALUES (${idVal}, ${label}, TRUE, now())
      ON CONFLICT (item_attribute_id) DO UPDATE SET categoria_label = EXCLUDED.categoria_label, updated_at = now()
    `;
    upserted++;
  }
  return { total_rows: rows.length, upserted, skipped, warnings: warnings.slice(0, 100) };
}

// ─── Caratteristiche manuali per articolo ──────────────────────────────────────
// Colonne: Codice Articolo, Modello, Categoria, Caratteristiche Manuali

export async function importArticleInfo(buffer: Buffer): Promise<ImportResult> {
  const rows = readRows(buffer);
  if (rows.length === 0) return emptyResult(0, 'File vuoto');

  const headers   = Object.keys(rows[0] ?? {});
  const colCode   = pickCol(headers, 'Codice Articolo', 'Articolo', 'Codice');
  const colModel  = pickCol(headers, 'Modello', 'Model');
  const colCat    = pickCol(headers, 'Categoria');
  const colCaratt = pickCol(headers, 'Caratteristiche Manuali', 'Caratteristiche', 'CaratteristicheManuali');
  if (!colCode || !colCat || !colCaratt) {
    return emptyResult(rows.length, 'Colonne minime mancanti: Codice Articolo, Categoria, Caratteristiche Manuali');
  }

  let upserted = 0, skipped = 0;
  const warnings: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const codiceArticolo = str(row[colCode]);
    const categoria = str(row[colCat]);
    const caratteristiche = str(row[colCaratt]);
    const modello = colModel ? (str(row[colModel]) || null) : null;
    if (!codiceArticolo || !categoria || !caratteristiche) {
      skipped++; warnings.push(`Riga ${i + 2}: Codice Articolo/Categoria/Caratteristiche mancante`);
      continue;
    }
    await db`
      INSERT INTO prod_article_info (codice_articolo, modello, categoria, caratteristiche_manuali)
      VALUES (${codiceArticolo}, ${modello}, ${categoria}, ${caratteristiche})
      ON CONFLICT (codice_articolo, categoria) DO UPDATE SET
        modello = EXCLUDED.modello, caratteristiche_manuali = EXCLUDED.caratteristiche_manuali
    `;
    upserted++;
  }
  return { total_rows: rows.length, upserted, skipped, warnings: warnings.slice(0, 100) };
}
