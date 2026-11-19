// Fatturazione: carica le regole da Excel/CSV. Colonne: Articolo, Cerca 1, Distanza 1, Cerca 2, Distanza 2, Cerca 3, Distanza 3, Prezzo, Note (+ Attiva, facoltativa).
// Compatibilità: una sola colonna «Distanza» vale per la 2ª e la 3ª parola.
// Una riga = una regola. Stessa regola (articolo + parole) già presente = se ne aggiornano prezzo, note e stato.
import * as XLSX from 'xlsx';
import { db } from '../../db/client.js';
import { pickCol } from '../spma/import-logic.js';
import { chiaveRegola, MAX_PASSI, MAX_REGOLE, RegolaInputSchema, type Passo, type RegolaInput } from './regole-base.js';

export interface EsitoImport { total_rows: number; upserted: number; skipped: number; warnings: string[] }

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** «1.234,56», «12,5», «12.5», «€ 10» → numero (NaN se non è un numero). */
export function leggiPrezzo(v: unknown): number {
  let t = str(v).replace(/[€\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
}

const leggiSiNo = (v: unknown): boolean => !['no', 'n', '0', 'false', 'falso'].includes(str(v).toLowerCase());

export function leggiRegoleExcel(buffer: Buffer): { regole: RegolaInput[]; total_rows: number; skipped: number; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const foglio = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : undefined;
  const righe = foglio ? XLSX.utils.sheet_to_json<Record<string, unknown>>(foglio, { raw: false, defval: null }) : [];
  if (righe.length === 0) return { regole: [], total_rows: 0, skipped: 0, warnings: ['File vuoto'] };

  const intestazioni = Object.keys(righe[0] ?? {});
  const colArt = pickCol(intestazioni, 'Articolo', 'Codice articolo', 'Codice');
  const colPrezzo = pickCol(intestazioni, 'Prezzo');
  const colCerca = [pickCol(intestazioni, 'Cerca 1', 'Parola 1'), pickCol(intestazioni, 'Cerca 2', 'Parola 2'), pickCol(intestazioni, 'Cerca 3', 'Parola 3')];
  const colDistN = [pickCol(intestazioni, 'Distanza 1'), pickCol(intestazioni, 'Distanza 2'), pickCol(intestazioni, 'Distanza 3')];
  const colDistUnica = colDistN.some(Boolean) ? null : pickCol(intestazioni, 'Distanza', 'Distanza massima');
  const colNote = pickCol(intestazioni, 'Note', 'Nota');
  const colAttiva = pickCol(intestazioni, 'Attiva', 'Attivo');
  if (!colArt || !colPrezzo) {
    return { regole: [], total_rows: righe.length, skipped: righe.length, warnings: ['Colonne minime mancanti: Articolo, Prezzo'] };
  }

  const regole: RegolaInput[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  righe.forEach((riga, i) => {
    const n = i + 2;   // riga del foglio (la 1 è l'intestazione)
    const art = str(riga[colArt]);
    const prezzo = leggiPrezzo(riga[colPrezzo]);
    if (!art) { skipped++; warnings.push(`Riga ${n}: articolo mancante`); return; }
    if (!Number.isFinite(prezzo)) { skipped++; warnings.push(`Riga ${n}: prezzo mancante o non valido`); return; }
    const distanza = (c: string | null): number | null => { const d = c ? parseInt(str(riga[c]), 10) : NaN; return Number.isInteger(d) && d > 0 ? d : null; };
    const passi: Passo[] = colCerca
      .map((c, k) => ({
        cerca: c ? str(riga[c]).split(',').map(s => s.trim()).filter(Boolean) : [],
        finestra: colDistUnica ? (k === 0 ? null : distanza(colDistUnica)) : distanza(colDistN[k] ?? null),
      }))
      .filter(p => p.cerca.length > 0);
    const candidata = {
      nome: colNote ? str(riga[colNote]) : '',
      attiva: colAttiva ? leggiSiNo(riga[colAttiva]) : true,
      article_code: /^(\*|tutti|tutte)$/i.test(art) ? '*' : art,
      prezzo, passi,
    };
    const ok = RegolaInputSchema.safeParse(candidata);
    if (!ok.success || passi.length > MAX_PASSI) { skipped++; warnings.push(`Riga ${n}: dati non validi (${ok.success ? 'troppe parole' : ok.error.issues[0]?.message})`); return; }
    regole.push(ok.data);
  });
  return { regole, total_rows: righe.length, skipped, warnings };
}

export async function importaRegole(buffer: Buffer, utente: string): Promise<EsitoImport> {
  const letto = leggiRegoleExcel(buffer);
  if (letto.regole.length === 0) return { total_rows: letto.total_rows, upserted: 0, skipped: letto.total_rows, warnings: letto.warnings };

  const esistenti = await db<{ id: string; article_code: string; condizioni: { passi: Passo[] }[] }[]>`SELECT id, article_code, condizioni FROM fatt_regola`;
  const perChiave = new Map(esistenti.map(r => [chiaveRegola({ article_code: r.article_code, passi: r.condizioni[0]?.passi ?? [] }), Number(r.id)]));
  const nuove = new Set(letto.regole.map(chiaveRegola).filter(k => !perChiave.has(k)));
  if (esistenti.length + nuove.size > MAX_REGOLE) {
    return { total_rows: letto.total_rows, upserted: 0, skipped: letto.total_rows, warnings: [`Superato il massimo di ${MAX_REGOLE} regole: non è stato caricato nulla`] };
  }

  let upserted = 0;
  const warnings = [...letto.warnings];
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    for (const r of letto.regole) {
      const k = chiaveRegola(r);
      const cond = r.passi.length > 0 ? [{ passi: r.passi }] : [];
      const id = perChiave.get(k);
      if (id !== undefined) {
        await tx`UPDATE fatt_regola SET nome = ${r.nome}, attiva = ${r.attiva}, prezzo = ${r.prezzo}, aggiornato_at = now() WHERE id = ${id}`;
      } else {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO fatt_regola (ordine, nome, attiva, article_code, prezzo, logica, condizioni, eccezioni, creato_da)
          VALUES (0, ${r.nome}, ${r.attiva}, ${r.article_code}, ${r.prezzo}, 'tutte', ${tx.json(cond as never)}, ${tx.json([] as never)}, ${utente})
          RETURNING id`;
        perChiave.set(k, Number(row!.id));   // due righe uguali nello stesso file: la seconda aggiorna la prima
      }
      upserted++;
    }
  });
  return { total_rows: letto.total_rows, upserted, skipped: letto.skipped, warnings };
}
