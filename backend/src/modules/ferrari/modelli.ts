// Elenco dei modelli Ferrari: quelli creati da una persona, quelli nuovi trovati nelle schede (da confermare)
// e gli errori di scrittura di un modello (es. F171V5 invece di F171VS), che da quel momento si correggono da soli.
// Stesse regole di STR-LocalAI/web/ferrari/modelli.py.

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { audit, type Utente } from './service.js';

type Tx = typeof db;

function nome(m: string | null | undefined): string {
  const v = String(m ?? '').replace(/\s+/g, '').toUpperCase();
  if (!v || v.length > 30) throw new HTTPException(400, { message: 'Scrivi il nome del modello (per esempio F171VS)' });
  return v;
}

/** F171VS -> A999AA: lettere e cifre in ordine, per riconoscere i nomi dei prossimi modelli. */
export const forma = (m: string) => m.toUpperCase().replace(/[A-Z]/g, 'A').replace(/\d/g, '9');

/** Somiglianza grossolana tra due nomi (0..1), come difflib.get_close_matches con cutoff 0.8. */
function somiglianza(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m && !n) return 1;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[m]![n]! / Math.max(m, n);
}

export async function elencoModelli() {
  const schede = new Map((await db<{ modello: string; n: number }[]>`
    SELECT modello, count(*)::int AS n FROM ferrari_file
    WHERE modello IS NOT NULL AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') GROUP BY modello`).map(r => [r.modello, r.n] as const));
  const noti = (await db<{ modello: string }[]>`SELECT modello FROM ferrari_modello_noto ORDER BY creato_at, modello`).map(r => r.modello);
  const alias = await db<{ sbagliato: string; giusto: string }[]>`SELECT sbagliato, giusto FROM ferrari_modello_alias ORDER BY sbagliato`;
  const forme = [...new Set(noti.map(forma))].sort();
  const nuovi = [...schede.keys()].filter(m => !noti.includes(m)).sort().map(m => {
    const vicino = noti.map(x => [somiglianza(m, x), x] as const).filter(([s]) => s >= 0.8).sort((a, b) => b[0] - a[0])[0];
    return { modello: m, schede: schede.get(m)!, forma_nota: forme.length ? forme.includes(forma(m)) : null, simile_a: vicino ? vicino[1] : null };
  });
  return {
    noti: noti.map(m => ({ modello: m, schede: schede.get(m) ?? 0, forma: forma(m) })),
    nuovi, forme, alias: alias.map(a => ({ sbagliato: a.sbagliato, giusto: a.giusto })),
  };
}

export async function creaModello(user: Utente, modello: string): Promise<string> {
  const m = nome(modello);
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`INSERT INTO ferrari_modello_noto (modello) VALUES (${m}) ON CONFLICT DO NOTHING`;
    await tx`DELETE FROM ferrari_modello_alias WHERE sbagliato = ${m}`;
    await audit(tx, user, 'modello.creato', 'modello', m, null);
  });
  return m;
}

/** Toglie il modello dall'elenco (le schede restano: se ce ne sono, il modello torna «da confermare»). */
export async function togliModello(user: Utente, modello: string): Promise<void> {
  const m = nome(modello);
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`DELETE FROM ferrari_modello_noto WHERE modello = ${m}`;
    await tx`DELETE FROM ferrari_modello_alias WHERE sbagliato = ${m} OR giusto = ${m}`;
    await audit(tx, user, 'modello.tolto', 'modello', m, null);
  });
}

/** «sbagliato» e' un errore di scrittura di «giusto»: le schede gia' caricate si correggono e le prossime pure. Ritorna quante. */
export async function modelloErroreDi(user: Utente, sbagliato: string, giusto: string): Promise<number> {
  const s = nome(sbagliato), g = nome(giusto);
  if (s === g) throw new HTTPException(400, { message: 'Il modello giusto deve essere diverso' });
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`INSERT INTO ferrari_modello_noto (modello) VALUES (${g}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO ferrari_modello_alias (sbagliato, giusto) VALUES (${s}, ${g}) ON CONFLICT (sbagliato) DO UPDATE SET giusto = EXCLUDED.giusto`;
    await tx`DELETE FROM ferrari_modello_noto WHERE modello = ${s}`;
    const r = await tx`
      UPDATE ferrari_file SET modello = ${g}, canonico = jsonb_set(canonico, '{header,tipo_matricola,modello}', to_jsonb(${g}::text))
      WHERE modello = ${s}`;
    await audit(tx, user, 'modello.errore', 'modello', `${s}->${g}`, { schede: r.count });
    return r.count;
  });
}

/** Il nome giusto di un modello letto da una scheda (corregge gli errori di scrittura gia' segnalati). */
export async function normalizzaModello(modello: string | null, tx: Tx = db): Promise<string | null> {
  if (!modello) return modello;
  const [r] = await tx<{ giusto: string }[]>`SELECT giusto FROM ferrari_modello_alias WHERE sbagliato = ${modello.toUpperCase()}`;
  return r?.giusto ?? modello;
}
