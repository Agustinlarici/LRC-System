// Descrizione delle sigle (BIC2 = CARROZZERIA BICOLORE) e caricamento massivo di un elenco di sigle.
// Una descrizione scritta da una persona (o confermata) compare nella colonna; quella che l'Excel offre soltanto si PROPONE:
// la persona decide se aggiungerla. Stesse regole di STR-LocalAI/web/ferrari/descrizioni.py.

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { audit, normalizzaSigla, type Utente } from './service.js';
import type { Canonico } from './types.js';

type Tx = typeof db;
export const SENZA_DESCRIZIONE = '(parola cercata)';
const MAX_RIGHE = 2000;

export interface DescrizioneSalvata { descrizione: string; rifiutata: boolean }

export async function descrizioniSalvate(): Promise<Map<string, DescrizioneSalvata>> {
  const rows = await db<{ codice: string; descrizione: string; rifiutata: boolean }[]>`SELECT codice, descrizione, rifiutata FROM ferrari_sigla_descrizione`;
  return new Map(rows.map(r => [r.codice, { descrizione: r.descrizione, rifiutata: r.rifiutata }] as const));
}

const pulisci = (d: string) => d.replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '').trim().slice(0, 200);

/** Righe «CODICE<tab>descrizione», «CODICE;descrizione» oppure «CODICE descrizione» (il codice e' la prima parola). */
export function leggiElenco(testo: string): { voci: { codice: string; descrizione: string }[]; ignorate: { riga: number; motivo: string }[] } {
  const voci = new Map<string, string>();
  const ignorate: { riga: number; motivo: string }[] = [];
  const righe = testo.split(/\r?\n/);
  if (righe.length > MAX_RIGHE) throw new HTTPException(400, { message: `Massimo ${MAX_RIGHE} righe per volta` });
  righe.forEach((r, i) => {
    const l = r.trim();
    if (!l) return;
    let codice: string, desc: string;
    if (/[\t;]/.test(l)) {
      const [c, ...resto] = l.split(/[\t;]/);
      codice = c ?? ''; desc = resto.join(' ');
    } else {
      const m = /^(\S+)\s*(.*)$/.exec(l)!;
      codice = m[1]!; desc = m[2]!;
    }
    codice = normalizzaSigla(codice);
    if (voci.size === 0 && i === 0 && ['SIGLA', 'CODICE', 'CODE'].includes(codice)) return;      // intestazione
    if (!codice || codice.length > 60) { ignorate.push({ riga: i + 1, motivo: 'sigla vuota o troppo lunga' }); return; }
    voci.set(codice, pulisci(desc));
  });
  return { voci: [...voci].map(([codice, descrizione]) => ({ codice, descrizione })), ignorate };
}

/** La descrizione che hanno le schede per una sigla (la prima trovata), per proporla. */
export async function descrizioniDalleSchede(codici?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const schede = await db<{ canonico: Canonico }[]>`
    SELECT canonico FROM ferrari_file WHERE stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND canonico IS NOT NULL ORDER BY caricato_at DESC LIMIT 2000`;
  const voluti = codici ? new Set(codici) : null;
  for (const s of schede) for (const o of s.canonico.opzioni) {
    const d = pulisci(o.descrizione ?? '');
    if (d && !out.has(o.codice) && (!voluti || voluti.has(o.codice))) out.set(o.codice, d);
  }
  return out;
}

export async function salvaDescrizioni(user: Utente, voci: { codice: string; descrizione: string }[], fonte: 'utente' | 'excel' = 'utente'): Promise<number> {
  let n = 0;
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    for (const v of voci) {
      const c = normalizzaSigla(v.codice);
      const d = pulisci(v.descrizione);
      if (!c || !d) continue;
      await tx`
        INSERT INTO ferrari_sigla_descrizione (codice, descrizione, rifiutata, fonte, creato_da) VALUES (${c}, ${d}, FALSE, ${fonte}, ${user.username})
        ON CONFLICT (codice) DO UPDATE SET descrizione = EXCLUDED.descrizione, rifiutata = FALSE, fonte = EXCLUDED.fonte, creato_da = EXCLUDED.creato_da, updated_at = now()`;
      n++;
    }
    if (n) await audit(tx, user, 'sigla.descrizione', 'sigla', null, { quante: n });
  });
  return n;
}

/** «No» alla descrizione proposta dall'Excel: non si propone piu'. */
export async function rifiutaDescrizioni(user: Utente, codici: string[]): Promise<number> {
  let n = 0;
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    for (const x of codici) {
      const c = normalizzaSigla(x);
      if (!c) continue;
      await tx`
        INSERT INTO ferrari_sigla_descrizione (codice, descrizione, rifiutata, fonte, creato_da) VALUES (${c}, '', TRUE, 'utente', ${user.username})
        ON CONFLICT (codice) DO UPDATE SET rifiutata = TRUE WHERE ferrari_sigla_descrizione.descrizione = ''`;
      n++;
    }
  });
  return n;
}

/** Aggiunge la descrizione che hanno le schede alle sigle indicate (se una persona non ne ha gia' scritta una). */
export async function aggiungiDaSchede(user: Utente, codici: string[]): Promise<number> {
  const gia = await descrizioniSalvate();
  const trovate = await descrizioniDalleSchede(codici);
  const voci = codici.filter(c => !(gia.get(c)?.descrizione)).flatMap(c => trovate.has(c) ? [{ codice: c, descrizione: trovate.get(c)! }] : []);
  return salvaDescrizioni(user, voci, 'excel');
}
