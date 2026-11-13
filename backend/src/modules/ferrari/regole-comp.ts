// Regole dei componenti (stile Outlook): salvataggio, tabella commesse × componenti e prova su una commessa.
// Il calcolo e' in regole-comp-base.ts e si fa al momento di mostrare la tabella: cambiare una regola aggiorna tutto, senza rileggere le schede.

import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { audit, caricaDettagli, type Utente } from './service.js';
import { dettagliValidi, type CtxSigle } from './matrice.js';
import { elencoComponenti } from './componenti.js';
import {
  applicaRegole, fattiDaScheda, MAX_REGOLE, sigleCitate,
  type RegolaComp, type RegolaCompInput, type RisultatoScheda,
} from './regole-comp-base.js';
import type { Canonico } from './types.js';

const MAX_SCHEDE = 500;
const STATI_FUORI = ['SOSTITUITO', 'QUARANTENA', 'RIFIUTATO'];

export async function leggiRegoleComp(): Promise<RegolaComp[]> {
  const righe = await db<{ id: string; nome: string; attiva: boolean; modello: string; logica: 'tutte' | 'qualsiasi'; condizioni: RegolaComp['condizioni']; eccezioni: RegolaComp['eccezioni']; azioni: RegolaComp['azioni']; ferma: boolean }[]>`
    SELECT id, nome, attiva, modello, logica, condizioni, eccezioni, azioni, ferma FROM ferrari_regola_comp ORDER BY ordine, id`;
  return righe.map(r => ({ ...r, id: Number(r.id) }));
}

/** Sostituisce l'elenco delle regole (l'ordine e' quello della lista). Ritorna le regole salvate con i loro id. */
export async function salvaRegoleComp(user: Utente, regole: RegolaCompInput[]): Promise<RegolaComp[]> {
  if (regole.length > MAX_REGOLE) throw new HTTPException(400, { message: `Massimo ${MAX_REGOLE} regole` });
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    await tx`DELETE FROM ferrari_regola_comp`;
    for (const [i, r] of regole.entries()) {
      await tx`
        INSERT INTO ferrari_regola_comp (ordine, nome, attiva, modello, logica, condizioni, eccezioni, azioni, ferma, creato_da)
        VALUES (${i}, ${r.nome}, ${r.attiva}, ${r.modello}, ${r.logica}, ${tx.json(r.condizioni as never)}, ${tx.json(r.eccezioni as never)},
                ${tx.json(r.azioni as never)}, ${r.ferma}, ${user.username})`;
    }
    await audit(tx, user, 'regole_comp.salvate', 'regole_comp', null, { regole: regole.length });
  });
  return leggiRegoleComp();
}

// ─── Contesto delle sigle di un modello (stesse decisioni della matrice: alias e sotto-sigle) ───

async function contestoSigle(modello: string): Promise<{ ctx: CtxSigle; subOk: Set<string>; decise: Set<string> }> {
  const righe = await db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null }[]>`
    SELECT modello, codice, va, sub, alias FROM ferrari_sigla WHERE modello IN ('*', ${modello})`;
  const stato = new Map<string, { va: boolean; sub: boolean; alias: string | null }>();
  for (const mod of ['*', modello]) for (const r of righe.filter(x => x.modello === mod)) stato.set(r.codice, { va: r.va, sub: r.sub, alias: r.alias });   // il modello prevale
  return {
    ctx: { alias: new Map([...stato].filter(([, d]) => d.alias).map(([c, d]) => [c, d.alias!] as [string, string])), decisi: new Set(stato.keys()) },
    subOk: new Set([...stato].filter(([, d]) => d.va && d.sub && !d.alias).map(([c]) => c)),
    decise: new Set([...stato].filter(([, d]) => d.va && !d.alias).map(([c]) => c)),     // le sigle che il modello considera vere
  };
}

export interface RigaComponenti {
  commessa: string; file_id: number; versione: string | null;
  celle: RisultatoScheda['celle']; non_coperte: string[];
}

/** La tabella: una riga per commessa del modello, una colonna per componente, con le regole che hanno prodotto ogni valore. */
export async function tabellaComponenti(modello?: string, q?: string) {
  const el = await elencoComponenti(modello);
  const m = el.modello;
  const regole = await leggiRegoleComp();
  const attive = regole.filter(r => r.attiva && (r.modello === '*' || r.modello === m));
  const nomi = el.componenti.map(c => c.nome);                                    // l'ordine e i nomi scelti per il modello
  for (const r of attive) for (const a of r.azioni) if (!nomi.some(n => n.toLowerCase() === a.componente.trim().toLowerCase())) nomi.push(a.componente.trim());
  if (!m) return { modello: '', modelli: el.modelli, componenti: nomi, righe: [] as RigaComponenti[], non_coperte: [] as { sigla: string; schede: number }[], regole_attive: attive.length };

  const cerca = (q ?? '').trim();
  const tutte = await db<{ id: number; canonico: Canonico }[]>`
    SELECT id, canonico - 'celle' AS canonico FROM ferrari_file
    WHERE modello = ${m} AND stato NOT IN ${db(STATI_FUORI)} AND canonico IS NOT NULL
    ORDER BY caricato_at DESC, id DESC LIMIT 1000`;
  const schede = tutte.filter(s => !cerca || (s.canonico.header.commessa ?? '').includes(cerca)).slice(0, MAX_SCHEDE);
  const dettagli = await caricaDettagli(schede.map(s => s.canonico.header.commessa ?? '').filter(Boolean));
  const { ctx, subOk, decise } = await contestoSigle(m);
  const citate = sigleCitate(attive);
  const conteggio = new Map<string, number>();
  const righe: RigaComponenti[] = schede.map(s => {
    const commessa = s.canonico.header.commessa ?? '';
    const det = dettagliValidi(commessa, s.canonico.opzioni, dettagli);
    const f = fattiDaScheda(s.canonico, { ctx, subOk, dettagli: det.testi });
    const { celle } = applicaRegole(attive, f);
    // sigle vere per il modello presenti nella scheda che nessuna regola considera: non si perdono in silenzio
    const non_coperte = [...f.sigle].filter(x => decise.has(x) && !citate.has(x)).sort();
    for (const x of non_coperte) conteggio.set(x, (conteggio.get(x) ?? 0) + 1);
    return { commessa, file_id: s.id, versione: s.canonico.header.tipo_matricola.versione, celle, non_coperte };
  });
  const non_coperte = [...conteggio].map(([sigla, schede]) => ({ sigla, schede })).sort((a, b) => b.schede - a.schede || (a.sigla < b.sigla ? -1 : 1));
  return { modello: m, modelli: el.modelli, componenti: nomi, righe, non_coperte, regole_attive: attive.length };
}

/** Prova su una commessa: cosa c'e' nella scheda, quali regole scattano e perche', e la tabella che ne risulta. Con `bozza` prova regole non ancora salvate. */
export async function provaRegoleComp(commessa: string, bozza?: RegolaCompInput[]) {
  const c = commessa.trim();
  if (!c) throw new HTTPException(400, { message: 'Indicare la commessa' });
  const [file] = await db<{ id: number; modello: string; canonico: Canonico }[]>`
    SELECT id, modello, canonico - 'celle' AS canonico FROM ferrari_file
    WHERE canonico IS NOT NULL AND stato NOT IN ${db(STATI_FUORI)} AND canonico->'header'->>'commessa' = ${c}
    ORDER BY caricato_at DESC, id DESC LIMIT 1`;
  if (!file) throw new HTTPException(404, { message: `Nessuna scheda caricata per la commessa ${c}` });
  const regole: RegolaComp[] = bozza ? bozza.map((r, i) => ({ ...r, id: -(i + 1) })) : await leggiRegoleComp();
  const dettagli = await caricaDettagli([c]);
  const { ctx, subOk } = await contestoSigle(file.modello);
  const det = dettagliValidi(c, file.canonico.opzioni, dettagli);
  const f = fattiDaScheda(file.canonico, { ctx, subOk, dettagli: det.testi });
  const ris = applicaRegole(regole, f);
  return { commessa: c, file_id: file.id, modello: file.modello, sigle: [...f.sigle].sort(), regole: ris.regole, celle: ris.celle };
}
