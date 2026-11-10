// Categorie delle colonne della tabella schede: elenco, creazione, modifica, ordine, eliminazione (con lo storico).

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { leggiCategorie, type Categoria } from './categorie-base.js';
import { audit, type Utente } from './service.js';
import { collapse } from './text.js';

export const MAX_CATEGORIE = 40;
export const MAX_TERMINI_CATEGORIA = 150;

const errore = (messaggio: string, stato: 400 | 404 | 409 = 400) => new HTTPException(stato, { message: messaggio });

/** Le categorie suggerite: si aggiungono con un clic (solo quelle che non esistono gia'). */
export const CATEGORIE_ESEMPIO: { nome: string; termini: string[] }[] = [
  { nome: 'LIVREA', termini: ['PN5X', 'PNT5', 'PN1X', 'PN10', 'LI01', 'LI02', 'LI03', 'LI04', 'LI05', 'LI06', 'LI07', 'LI08', 'LIT1', 'LIT2', 'SFCX', 'SFCL', 'AS00', 'AS01', 'AS03', 'AS06', 'AS07', 'TMSP', 'LI5X', 'LI1X'] },
  { nome: 'DREAMLINE', termini: ['DRM1', 'DRM2', 'VISTA', 'PILOTI', 'DRMX', 'TML', 'TLM'] },
  { nome: 'CAVAL.', termini: ['HBMB', 'HBSA', 'FBMB', 'CAVALL'] },
  { nome: 'CARB.', termini: ['CASP', 'FCWX', 'CEDX', 'CECE', 'CECM'] },
  { nome: 'PLAST.', termini: ['PPE1'] },
  { nome: 'GRIGLIE', termini: ['GPE1'] },
];

export function normNomeCategoria(n: string | undefined | null): string {
  const v = (n ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!v) throw errore('Indicare il nome della categoria');
  return v;
}

/** Codici o parole: maiuscolo, senza accenti, senza doppioni (uguale al resto del modulo). */
export function normTerminiCategoria(lista: unknown[] | undefined | null): string[] {
  const out: string[] = [];
  for (const t of lista ?? []) {
    const v = collapse(String(t)).slice(0, 60);
    if (v && !out.includes(v)) out.push(v);
  }
  if (out.length > MAX_TERMINI_CATEGORIA) throw errore(`Massimo ${MAX_TERMINI_CATEGORIA} codici o parole per categoria`);
  return out;
}

export const elencoCategorie = (): Promise<Categoria[]> => leggiCategorie(db);

export async function salvaCategoria(user: Utente, dati: { id?: number; nome: string; termini: unknown[] }): Promise<Categoria> {
  const nome = normNomeCategoria(dati.nome);
  const termini = normTerminiCategoria(dati.termini);
  try {
    const id = await db.begin(async raw => {
      const tx = raw as unknown as typeof db;
      let id = dati.id;
      if (id === undefined) {
        const [n] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM ferrari_categoria`;
        if ((n?.n ?? 0) >= MAX_CATEGORIE) throw errore(`Massimo ${MAX_CATEGORIE} categorie`);
        const [c] = await tx<{ id: string }[]>`
          INSERT INTO ferrari_categoria (nome, ordine, creato_da)
          VALUES (${nome}, COALESCE((SELECT max(ordine) + 1 FROM ferrari_categoria), 0), ${user.username}) RETURNING id::text AS id`;
        id = Number(c!.id);
      } else {
        const r = await tx`UPDATE ferrari_categoria SET nome = ${nome} WHERE id = ${id} RETURNING id`;
        if (r.length === 0) throw errore('Categoria non trovata', 404);
        await tx`DELETE FROM ferrari_categoria_termine WHERE categoria_id = ${id}`;
      }
      for (const [i, t] of termini.entries()) {
        await tx`INSERT INTO ferrari_categoria_termine (categoria_id, termine, ordine) VALUES (${id}, ${t}, ${i})`;
      }
      await audit(tx, user, 'categoria.salvata', 'categoria', id, { nome, termini: termini.length });
      return id;
    });
    return (await elencoCategorie()).find(c => c.id === id)!;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw errore('Esiste gia\' una categoria con questo nome', 409);
    throw e;
  }
}

export async function eliminaCategoria(user: Utente, id: number): Promise<void> {
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    const r = await tx<{ nome: string }[]>`DELETE FROM ferrari_categoria WHERE id = ${id} RETURNING nome`;
    if (r.length === 0) throw errore('Categoria non trovata', 404);
    await audit(tx, user, 'categoria.eliminata', 'categoria', id, { nome: r[0]!.nome });
  });
}

/** L'ordine delle categorie nell'elenco (e quindi dei gruppi nella tabella): `ids` nell'ordine voluto. */
export async function riordinaCategorie(user: Utente, ids: number[]): Promise<void> {
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    for (const [i, id] of ids.entries()) await tx`UPDATE ferrari_categoria SET ordine = ${i} WHERE id = ${id}`;
    await audit(tx, user, 'categorie.riordinate', 'categoria', null, { ids });
  });
}

/** Aggiunge le categorie di esempio che non esistono ancora. Ritorna quante. */
export async function aggiungiCategorieEsempio(user: Utente): Promise<number> {
  const esistenti = new Set((await elencoCategorie()).map(c => c.nome.toLowerCase()));
  let n = 0;
  for (const c of CATEGORIE_ESEMPIO) {
    if (esistenti.has(c.nome.toLowerCase())) continue;
    await salvaCategoria(user, c);
    n++;
  }
  return n;
}
