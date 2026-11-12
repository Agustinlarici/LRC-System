// Controllo con il SOP: caricamento dell'Excel del SOP, regole e confronto con le schede caricate (con lo storico).

import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { audit, type Utente } from './service.js';
import {
  CODICI_COLORE, confrontaRiga, leggiSop, REGOLE_SUGGERITE, rigaConDati, SopError,
  type Differenza, type Regola, type RegolaNominata, type StatoColonna,
} from './sop-base.js';
import type { Opzione } from './types.js';

const MAX_IMPORT_CONSERVATI = 5;
const MAX_DIFFERENZE = 20000;
const BLOCCO = 800;

// ─── Regole ───────────────────────────────────────────────────────────────────

const Nome = z.string().trim().min(1).max(60);
export const RegolaSchema = z.discriminatedUnion('tipo', [
  z.object({ colonna: Nome, tipo: z.literal('sigle'), sigle: z.array(z.string().trim().min(1).max(60)).max(200), base: z.string().trim().max(40), unisci: z.string().max(3) }),
  z.object({ colonna: Nome, tipo: z.literal('colore'), codici: z.array(z.string().trim().min(1).max(30)).max(40), extra: z.string().trim().max(40) }),
  z.object({ colonna: Nome, tipo: z.literal('mercato'), mappa: z.record(z.string().max(60), z.string().max(60)) }),
]);

export async function leggiRegole(): Promise<Regola[]> {
  const righe = await db<{ colonna: string; ordine: number; tipo: string; parametri: Record<string, unknown> }[]>`
    SELECT colonna, ordine, tipo, parametri FROM ferrari_sop_regola ORDER BY ordine, colonna`;
  const out: Regola[] = [];
  for (const r of righe) {
    // regola «colore» salvata con la versione precedente (gamma sotto EXTC): passa all'elenco di sigle di colore di default
    const par = r.tipo === 'colore' && !('codici' in r.parametri) ? { extra: r.parametri['extra'], codici: CODICI_COLORE } : r.parametri;
    const p = RegolaSchema.safeParse({ colonna: r.colonna, tipo: r.tipo, ...par });
    if (p.success) out.push({ ...p.data, ordine: r.ordine } as Regola);
  }
  return out;
}

const parametri = (r: RegolaNominata): Record<string, unknown> => { const { colonna: _c, tipo: _t, ...resto } = r; return resto; };

export async function salvaRegole(user: Utente, regole: RegolaNominata[]): Promise<number> {
  const nomi = regole.map(r => r.colonna.toUpperCase());
  if (new Set(nomi).size !== nomi.length) throw new HTTPException(400, { message: 'Una colonna ha piu\' di una regola' });
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    await tx`DELETE FROM ferrari_sop_regola`;
    for (const [i, r] of regole.entries()) {
      await tx`INSERT INTO ferrari_sop_regola (colonna, ordine, tipo, parametri) VALUES (${r.colonna}, ${i}, ${r.tipo}, ${tx.json(parametri(r) as never)})`;
    }
    await audit(tx, user, 'sop.regole_salvate', 'sop', null, { colonne: regole.length });
  });
  return regole.length;
}

/** Aggiunge le regole suggerite per le colonne che non ne hanno ancora una. Ritorna quante. */
export async function aggiungiRegoleSuggerite(user: Utente): Promise<number> {
  const esistenti = new Set((await leggiRegole()).map(r => r.colonna.toUpperCase()));
  const nuove = REGOLE_SUGGERITE.filter(r => !esistenti.has(r.colonna.toUpperCase()));
  if (nuove.length === 0) return 0;
  const attuali = await leggiRegole();
  await salvaRegole(user, [...attuali, ...nuove].map(({ ordine: _o, ...r }) => r as RegolaNominata));
  return nuove.length;
}

// ─── Caricamento del SOP ──────────────────────────────────────────────────────

export interface ImportSop { id: number; filename: string; colonne: string[]; righe: number; con_dati: number; caricato_da: string | null; caricato_at: Date }

export async function importaSop(user: Utente, filename: string, buf: Buffer): Promise<ImportSop> {
  let foglio;
  try { foglio = leggiSop(buf); } catch (e) {
    if (e instanceof SopError) throw new HTTPException(400, { message: e.message });
    throw e;
  }
  const nome = filename.replace(/[\\/]/g, '_').slice(0, 200) || 'SOP.xlsx';
  return db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    const [imp] = await tx<ImportSop[]>`
      INSERT INTO ferrari_sop_import (filename, colonne, righe, con_dati, caricato_da)
      VALUES (${nome}, ${tx.json(foglio.colonne as never)}, ${foglio.righe.length}, ${foglio.conDati}, ${user.username})
      RETURNING id::int AS id, filename, colonne, righe, con_dati, caricato_da, caricato_at`;
    for (let i = 0; i < foglio.righe.length; i += 2000) {
      const blocco = foglio.righe.slice(i, i + 2000);
      await tx`
        INSERT INTO ferrari_sop_riga (import_id, commessa, valori)
        SELECT ${imp!.id}, t.c, t.v::jsonb FROM unnest(${blocco.map(r => r.commessa)}::text[], ${blocco.map(r => JSON.stringify(r.valori))}::text[]) AS t(c, v)`;
    }
    await tx`DELETE FROM ferrari_sop_import WHERE id NOT IN (SELECT id FROM ferrari_sop_import ORDER BY id DESC LIMIT ${MAX_IMPORT_CONSERVATI})`;
    await audit(tx, user, 'sop.caricato', 'sop', imp!.id, { filename: nome, righe: foglio.righe.length, con_dati: foglio.conDati });
    return imp!;
  });
}

export const elencoImport = () => db<ImportSop[]>`
  SELECT id::int AS id, filename, colonne, righe, con_dati, caricato_da, caricato_at FROM ferrari_sop_import ORDER BY id DESC LIMIT 10`;

// ─── Differenze gia' viste ────────────────────────────────────────────────────

export interface ChiaveDifferenza { commessa: string; colonna: string; sop: string; vm: string }
const chiaveDifferenza = (d: ChiaveDifferenza) => [d.commessa, d.colonna, d.sop, d.vm].join('\u0000');

async function leggiViste(): Promise<Map<string, { da: string | null; at: string }>> {
  const righe = await db<{ commessa: string; colonna: string; sop: string; vm: string; visto_da: string | null; visto_at: Date }[]>`
    SELECT commessa, colonna, sop, vm, visto_da, visto_at FROM ferrari_sop_visto`;
  return new Map(righe.map(r => [chiaveDifferenza(r), { da: r.visto_da, at: r.visto_at.toISOString() }]));
}

/** Segna come viste (o torna «da vedere») le differenze indicate. Ritorna quante ne ha cambiate. */
export async function segnaViste(user: Utente, differenze: ChiaveDifferenza[], viste: boolean): Promise<number> {
  if (differenze.length === 0) return 0;
  const unici = [...new Map(differenze.map(d => [chiaveDifferenza(d), d])).values()];
  return db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    let n = 0;
    for (let i = 0; i < unici.length; i += 500) {
      const blocco = unici.slice(i, i + 500);
      const arr = (k: keyof ChiaveDifferenza) => blocco.map(d => d[k]);
      const r = viste
        ? await tx`
            INSERT INTO ferrari_sop_visto (commessa, colonna, sop, vm, visto_da)
            SELECT t.c, t.col, t.s, t.v, ${user.username} FROM unnest(${arr('commessa')}::text[], ${arr('colonna')}::text[], ${arr('sop')}::text[], ${arr('vm')}::text[]) AS t(c, col, s, v)
            ON CONFLICT DO NOTHING RETURNING 1`
        : await tx`
            DELETE FROM ferrari_sop_visto v USING unnest(${arr('commessa')}::text[], ${arr('colonna')}::text[], ${arr('sop')}::text[], ${arr('vm')}::text[]) AS t(c, col, s, vv)
            WHERE v.commessa = t.c AND v.colonna = t.col AND v.sop = t.s AND v.vm = t.vv RETURNING 1`;
      n += r.length;
    }
    if (n > 0) await audit(tx, user, viste ? 'sop.viste' : 'sop.da_rivedere', 'sop', null, { differenze: n });
    return n;
  });
}

// ─── Confronto ────────────────────────────────────────────────────────────────

export async function confrontoSop(importId?: number) {
  const [imp] = importId === undefined
    ? await db<ImportSop[]>`SELECT id::int AS id, filename, colonne, righe, con_dati, caricato_da, caricato_at FROM ferrari_sop_import ORDER BY id DESC LIMIT 1`
    : await db<ImportSop[]>`SELECT id::int AS id, filename, colonne, righe, con_dati, caricato_da, caricato_at FROM ferrari_sop_import WHERE id = ${importId}`;
  if (!imp) throw new HTTPException(404, { message: 'Carica prima l\'Excel del SOP' });
  const regole = await leggiRegole();
  const righe = (await db<{ commessa: string; valori: Record<string, string> }[]>`
    SELECT commessa, valori FROM ferrari_sop_riga WHERE import_id = ${imp.id} ORDER BY commessa`).filter(rigaConDati);

  const opzioniPer = new Map<string, { file_id: number; opzioni: Pick<Opzione, 'codice' | 'valore'>[] }>();
  for (let i = 0; i < righe.length; i += BLOCCO) {
    const trovate = await db<{ id: number; commessa: string; opzioni: Pick<Opzione, 'codice' | 'valore'>[] }[]>`
      SELECT DISTINCT ON (commessa) id, commessa, canonico->'opzioni' AS opzioni FROM ferrari_file
      WHERE commessa = ANY(${righe.slice(i, i + BLOCCO).map(r => r.commessa)}) AND canonico IS NOT NULL AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO')
      ORDER BY commessa, caricato_at DESC, id DESC`;
    for (const t of trovate) opzioniPer.set(t.commessa, { file_id: t.id, opzioni: t.opzioni ?? [] });
  }

  const colonne = new Map<string, StatoColonna>(regole.filter(r => imp.colonne.includes(r.colonna)).map(r => [r.colonna, { colonna: r.colonna, ok: 0, diverso: 0, solo_sop: 0, solo_vm: 0 }]));
  const differenze: Differenza[] = [];
  const nonCaricate: string[] = [];
  const viste = await leggiViste();
  let confrontate = 0, tutteOk = 0, conDifferenze = 0, senzaRegolaMercato = 0, vedute = 0;
  for (const riga of righe) {
    const f = opzioniPer.get(riga.commessa);
    if (!f) { nonCaricate.push(riga.commessa); continue; }
    const r = confrontaRiga(riga, f.file_id, f.opzioni, regole);
    confrontate++;
    if (r.differenze.length === 0) tutteOk++; else conDifferenze++;
    for (const c of r.celle) colonne.get(c.colonna)![c.esito]++;
    if (r.celle.some(c => c.nota === 'senza_regola')) senzaRegolaMercato++;
    for (const d of r.differenze) {
      const v = viste.get(chiaveDifferenza(d));
      if (v) vedute++;
      if (differenze.length < MAX_DIFFERENZE) differenze.push(v ? { ...d, visto: v } : d);
    }
  }
  const conRegola = new Set(regole.map(r => r.colonna));
  return {
    import: imp,
    riepilogo: {
      righe_sop: imp.righe, con_dati: righe.length, confrontate, non_caricate: nonCaricate.length, tutte_ok: tutteOk, con_differenze: conDifferenze,
      differenze_totali: [...colonne.values()].reduce((a, c) => a + c.diverso + c.solo_sop + c.solo_vm, 0), mercato_senza_regola: senzaRegolaMercato,
      viste: vedute,
    },
    colonne: [...colonne.values()],
    colonne_senza_regola: imp.colonne.filter(c => !conRegola.has(c)),
    differenze,
    troncato: differenze.length >= MAX_DIFFERENZE,
    non_caricate: nonCaricate.slice(0, 500),
    regole_mancanti: regole.length === 0,
  };
}
