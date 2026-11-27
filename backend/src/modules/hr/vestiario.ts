// Vestiario per capo: parser dell'Excel di import (intestazioni «CAPO (COLORE)», celle con la taglia).
// Funzioni pure, senza accesso al DB, così si possono provare con i test.

export const TAGLIE = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] as const;
export type Taglia = typeof TAGLIE[number];

const ALIAS: Record<string, Taglia> = { '2XL': 'XXL', 'XXXL': '3XL' };

export function normText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// «FELPA BCWG004 (GRIGIA)» → { nome: 'FELPA BCWG004', colore: 'GRIGIA' }; senza parentesi il colore è vuoto.
// Si guarda l'ultima coppia di parentesi: «POLO BSW201 E BS201 (ROSSA)» → colore ROSSA.
export function parseCapoHeader(raw: string): { nome: string; colore: string } | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/^(.*)\(([^()]*)\)\s*$/);
  if (m && m[1].trim()) return { nome: m[1].trim().toUpperCase(), colore: m[2].trim().toUpperCase() };
  return { nome: s.toUpperCase(), colore: '' };
}

// Estrae la taglia da una cella che può contenere altro testo («L uomo», «xl - donna»).
// '' = cella vuota; 'ambigua' = più taglie diverse; 'sconosciuta' = testo senza taglia.
export function parseTaglia(raw: string): Taglia | '' | 'ambigua' | 'sconosciuta' {
  const s = normText(raw);
  if (!s) return '';
  const found = new Set<Taglia>();
  for (const tok of s.split(/[^A-Z0-9]+/)) {
    if (!tok) continue;
    if ((TAGLIE as readonly string[]).includes(tok)) found.add(tok as Taglia);
    else if (ALIAS[tok]) found.add(ALIAS[tok]);
  }
  if (found.size === 1) return [...found][0];
  return found.size > 1 ? 'ambigua' : 'sconosciuta';
}

// Colonna GILET: non è una taglia ma sì/no. '' = vuota (non cambia nulla), null = non riconosciuto.
export function parseSiNo(raw: string): boolean | '' | null {
  const s = normText(raw).replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  if (['SI', 'S', 'YES', 'Y', 'X', '1', 'OK'].includes(s)) return true;
  if (['NO', 'N', '0'].includes(s)) return false;
  return null;
}

export function isGiletHeader(raw: string): boolean {
  const p = parseCapoHeader(raw);
  return !!p && p.nome === 'GILET' && p.colore === '';
}

export interface EmpLite { id: number; nome: string; cognome: string; stato: string }

export interface ImportCapo { col: number; nome: string; colore: string }
export interface ImportAssegnazione { employee_id: number; col: number; taglia: Taglia }
export interface ImportPlan {
  capi: ImportCapo[];                                  // colonne riconosciute come capi
  gilet: { employee_id: number; valore: boolean }[];  // colonna GILET (sì/no)
  assegnazioni: ImportAssegnazione[];
  non_trovati: { riga: number; nome: string; motivo: string }[];
  avvisi: { riga: number; nome: string; capo: string; valore: string; motivo: string }[];
}

// header[0] = «COGNOME E NOME»; le altre colonne sono capi. rows = righe dati (senza intestazione).
export function buildImportPlan(header: string[], rows: string[][], employees: EmpLite[]): ImportPlan {
  const capi: ImportCapo[] = [];
  let giletCol = -1;
  const seen = new Set<string>();
  for (let col = 1; col < header.length; col++) {
    if (isGiletHeader(header[col] ?? '')) { if (giletCol < 0) giletCol = col; continue; }
    const p = parseCapoHeader(header[col] ?? '');
    if (!p) continue;
    const key = `${p.nome}|${p.colore}`;
    if (seen.has(key)) continue;   // colonna ripetuta: vale la prima
    seen.add(key);
    capi.push({ col, ...p });
  }

  const byName = new Map<string, EmpLite[]>();
  const add = (k: string, e: EmpLite) => byName.set(k, [...(byName.get(k) ?? []), e]);
  for (const e of employees) {
    add(normText(`${e.cognome} ${e.nome}`), e);
    add(normText(`${e.nome} ${e.cognome}`), e);   // nel caso l'Excel abbia «Nome Cognome»
  }

  const plan: ImportPlan = { capi, gilet: [], assegnazioni: [], non_trovati: [], avvisi: [] };
  const done = new Set<number>();
  rows.forEach((row, i) => {
    const riga = i + 2;   // riga Excel (1 = intestazione)
    const nome = (row[0] ?? '').replace(/\s+/g, ' ').trim();
    if (!nome) return;
    const cand = [...new Map((byName.get(normText(nome)) ?? []).map(e => [e.id, e])).values()];
    const attivi = cand.filter(e => e.stato !== 'cessato');
    const pool = attivi.length ? attivi : cand;
    if (pool.length === 0) { plan.non_trovati.push({ riga, nome, motivo: 'Dipendente non trovato' }); return; }
    if (pool.length > 1) { plan.non_trovati.push({ riga, nome, motivo: 'Più dipendenti con questo nome' }); return; }
    const emp = pool[0];
    if (done.has(emp.id)) { plan.non_trovati.push({ riga, nome, motivo: 'Dipendente ripetuto nel file (vale la prima riga)' }); return; }
    done.add(emp.id);
    if (giletCol >= 0) {
      const valore = (row[giletCol] ?? '').trim();
      const v = parseSiNo(valore);
      if (v === null) plan.avvisi.push({ riga, nome, capo: 'GILET', valore, motivo: 'Valore non riconosciuto (serve SI o NO)' });
      else if (v !== '') plan.gilet.push({ employee_id: emp.id, valore: v });
    }
    for (const c of capi) {
      const valore = (row[c.col] ?? '').trim();
      const t = parseTaglia(valore);
      if (t === '') continue;
      const capoLabel = c.colore ? `${c.nome} (${c.colore})` : c.nome;
      if (t === 'ambigua' || t === 'sconosciuta') {
        plan.avvisi.push({ riga, nome, capo: capoLabel, valore, motivo: t === 'ambigua' ? 'Più taglie nella cella' : 'Taglia non riconosciuta' });
        continue;
      }
      plan.assegnazioni.push({ employee_id: emp.id, col: c.col, taglia: t });
    }
  });
  return plan;
}

// Data di consegna «YYYY-MM-DD»: deve esistere davvero (niente 2026-02-31) e non essere nel futuro.
// Si accetta fino a domani per i fusi orari (server e browser possono avere date diverse).
export function dataConsegnaValida(s: string, now: Date = new Date()): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  if (y < 2000) return false;
  return dt.getTime() <= now.getTime() + 36 * 3600 * 1000;
}
