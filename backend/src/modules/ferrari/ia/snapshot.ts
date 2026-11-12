// Snapshot delle sigle della VM da mandare alla PC IA (la VM e' la fonte di verita'). Si manda UNA volta per versione:
// ogni scheda indica solo `versione_sigle`. Le colonne sono l'unione di quelle di tutti i modelli: la IA non salta mai qualcosa che serve.

import { createHash } from 'node:crypto';
import { db } from '../../../db/client.js';
import { stableStringify } from '../bundle.js';
import { esportaComponenti } from '../componenti-base.js';
import type { SnapshotSigle } from './contratto.js';

type Corpo = Omit<SnapshotSigle, 'versione_sigle'>;

const ordina = (xs: string[]) => [...new Set(xs)].sort();

/** Versione = sha256 del contenuto in forma stabile: stesso contenuto, stessa versione (idempotente). */
export function versioneSigle(corpo: Corpo): string {
  return createHash('sha256').update(stableStringify(corpo), 'utf8').digest('hex');
}

/** Normalizza (ordine e doppioni) e aggiunge la versione. Pura: la usano anche i test. */
export function costruisciSnapshot(g: {
  colonne: string[]; sotto_sigle: { codice: string; padre: string | null }[]; alias: Record<string, string>; modelli: string[];
  esempi?: SnapshotSigle['esempi'];
  decisioni?: NonNullable<SnapshotSigle['decisioni']>; componenti?: NonNullable<SnapshotSigle['componenti']>;
  modelli_noti?: string[]; modelli_alias?: NonNullable<SnapshotSigle['modelli_alias']>;
}): SnapshotSigle {
  const sotto = new Map<string, string | null>();
  for (const s of g.sotto_sigle) sotto.set(s.codice, sotto.has(s.codice) && sotto.get(s.codice) !== s.padre ? null : s.padre);   // padri diversi per modello = «in qualsiasi voce»
  const corpo: Corpo = {
    colonne: ordina(g.colonne),
    sotto_sigle: [...sotto].sort(([a], [b]) => a.localeCompare(b)).map(([codice, padre]) => ({ codice, padre })),
    alias: Object.fromEntries(Object.entries(g.alias).sort(([a], [b]) => a.localeCompare(b))),
    modelli: ordina(g.modelli),
    esempi: g.esempi ?? [],
  };
  // le liste vuote non si mandano: l'hash di prima (senza questi campi) resta valido. L'ordine delle decisioni e' quello della VM.
  const viste = new Set<string>();
  const decisioni = (g.decisioni ?? []).filter(d => { const k = `${d.modello}\u0000${d.codice}`; return !viste.has(k) && !!viste.add(k); });
  const componenti = [...(g.componenti ?? [])].sort((a, b) => a.modello.localeCompare(b.modello) || a.nome.localeCompare(b.nome));
  if (decisioni.length) corpo.decisioni = decisioni;
  if (componenti.length) corpo.componenti = componenti;
  const noti = [...new Set(g.modelli_noti ?? [])];                                 // ordine di creazione della VM
  const alias = [...(g.modelli_alias ?? [])].sort((a, b) => a.sbagliato.localeCompare(b.sbagliato));
  if (noti.length) corpo.modelli_noti = noti;
  if (alias.length) corpo.modelli_alias = alias;
  return { versione_sigle: versioneSigle(corpo), ...corpo };
}

export async function leggiSnapshotDaDb(): Promise<SnapshotSigle> {
  const sigle = await db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null; nosigla: boolean; padre: string | null }[]>`
    SELECT modello, codice, va, sub, alias, nosigla, padre FROM ferrari_sigla ORDER BY ordine`;
  const modelli = await db<{ modello: string }[]>`
    SELECT modello FROM ferrari_modello_noto
    UNION SELECT DISTINCT modello FROM ferrari_file WHERE modello IS NOT NULL AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO')`;
  return costruisciSnapshot({
    colonne: sigle.filter(s => s.va && !s.sub && !s.nosigla && !s.alias).map(s => s.codice),
    sotto_sigle: sigle.filter(s => s.va && s.sub && !s.nosigla && !s.alias).map(s => ({ codice: s.codice, padre: s.padre })),
    alias: Object.fromEntries(sigle.filter(s => s.alias).map(s => [s.codice, s.alias!])),
    modelli: modelli.map(m => m.modello),
    decisioni: sigle.map(s => ({ modello: s.modello, codice: s.codice, va: s.va, sub: s.sub, alias: s.alias, nosigla: s.nosigla, padre: s.padre })),
    componenti: await esportaComponenti(db),
    modelli_noti: (await db<{ modello: string }[]>`SELECT modello FROM ferrari_modello_noto ORDER BY creato_at, modello`).map(m => m.modello),
    modelli_alias: await db<{ sbagliato: string; giusto: string }[]>`SELECT sbagliato, giusto FROM ferrari_modello_alias`,
  });
}
