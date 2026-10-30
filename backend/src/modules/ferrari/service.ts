// Logica di dominio delle Schede Ferrari (accesso al database). Le routes sono sottili: validano e chiamano qui.
// Flusso e stati: docs/FERRARI-FLUSSO.md.

import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { analizzaVm } from './analyzer.js';
import {
  BundleError, buildKnowledge, buildSigle, buildToAi, leggiBundle, leggiComponenti, leggiDettagli, leggiRisultatoIa, leggiSigle, sha256, stableStringify,
  type EsempioConoscenza, type VoceComponente, type VoceDettaglio,
} from './bundle.js';
import { confronta } from './compare.js';
import { parseScheda, righeFoglio, SchedaError } from './parser.js';
import { MIN_SCHEDE_RIFERIMENTO, riferimento, segna } from './anomalie.js';
import type {
  AnalisiIa, AnalisiVm, Canonico, Conoscenza, ItemConfronto, RisultatoConfronto,
} from './types.js';
import { TIPI_COMPONENTE } from './types.js';
import { TIPO_NEUTRO } from './analyzer.js';
import {
  costruisciDatiValidati, erroreDecisione, itemNonRisolti,
  type Decisione, type DecisioneRecord, type ValoreDopo,
} from './validato.js';
import { collapse } from './text.js';
import { costruisciMatrice, nuoveSigle, type CtxSigle, type DettagliPerCommessa } from './matrice.js';
import { esportaComponenti, importaComponenti } from './componenti-base.js';

type Tx = typeof db;

export interface Utente { id: number; username: string }

const J = (tx: Tx, v: unknown) => tx.json(v as never);
const HASH_ZERO = '0'.repeat(64);
const LOCK_AUDIT = 7310061;
const LOCK_CONOSCENZA = 7310062;

export const TIPI_DIZIONARIO: string[] = [...TIPI_COMPONENTE, TIPO_NEUTRO];

// ─── Configurazione ───────────────────────────────────────────────────────────

export async function getConfig(key: string, tx: Tx = db): Promise<string | null> {
  const [r] = await tx<{ value: string }[]>`SELECT value FROM ferrari_config WHERE key = ${key}`;
  return r?.value ?? null;
}

export async function setConfig(key: string, value: string, tx: Tx = db): Promise<void> {
  await tx`
    INSERT INTO ferrari_config (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

/** Segreto condiviso con la PC IA per firmare i pacchetti. Si genera la prima volta che serve. */
export async function getSecret(): Promise<string> {
  const esistente = await getConfig('bundle_secret');
  if (esistente) return esistente;
  await db`INSERT INTO ferrari_config (key, value) VALUES ('bundle_secret', ${randomBytes(32).toString('hex')}) ON CONFLICT (key) DO NOTHING`;
  return (await getConfig('bundle_secret'))!;
}

async function samplingPct(tx: Tx = db): Promise<number> {
  const n = Number(await getConfig('sampling_pct', tx));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
}

// ─── Storico (append-only, con catena di hash) ────────────────────────────────

export async function audit(
  tx: Tx, user: Utente | null, azione: string, entita: string | null, entitaId: string | number | null,
  dettagli: Record<string, unknown> | null = null,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${LOCK_AUDIT})`;
  const [last] = await tx<{ hash: string }[]>`SELECT hash FROM ferrari_audit ORDER BY id DESC LIMIT 1`;
  const prev = last?.hash ?? HASH_ZERO;
  const ts = new Date();
  const payload = {
    ts: ts.toISOString(), user_id: user?.id ?? null, username: user?.username ?? null, azione,
    entita, entita_id: entitaId === null ? null : String(entitaId), dettagli: dettagli ?? null,
  };
  const hash = createHash('sha256').update(prev + stableStringify(payload)).digest('hex');
  await tx`
    INSERT INTO ferrari_audit (ts, user_id, username, azione, entita, entita_id, dettagli, hash_prec, hash)
    VALUES (${ts}, ${payload.user_id}, ${payload.username}, ${azione}, ${entita}, ${payload.entita_id},
            ${dettagli ? J(tx, dettagli) : null}, ${prev}, ${hash})
  `;
}

export async function verificaCatenaAudit(): Promise<{ ok: boolean; righe: number; errore?: string }> {
  const rows = await db<{ id: string; ts: Date; user_id: number | null; username: string | null; azione: string;
    entita: string | null; entita_id: string | null; dettagli: unknown; hash_prec: string; hash: string }[]>`
    SELECT id, ts, user_id, username, azione, entita, entita_id, dettagli, hash_prec, hash FROM ferrari_audit ORDER BY id`;
  let prev = HASH_ZERO;
  for (const r of rows) {
    const payload = {
      ts: r.ts.toISOString(), user_id: r.user_id, username: r.username, azione: r.azione,
      entita: r.entita, entita_id: r.entita_id, dettagli: r.dettagli ?? null,
    };
    const atteso = createHash('sha256').update(prev + stableStringify(payload)).digest('hex');
    if (r.hash_prec !== prev || r.hash !== atteso) {
      return { ok: false, righe: rows.length, errore: `Catena interrotta alla riga ${r.id}` };
    }
    prev = r.hash;
  }
  return { ok: true, righe: rows.length };
}

// ─── Conoscenza ───────────────────────────────────────────────────────────────

export async function caricaConoscenza(tx: Tx = db): Promise<Conoscenza> {
  const [codici, componenti, versione] = await Promise.all([
    tx<{ codice: string; modello: string | null; significato: string; categoria: string | null }[]>`
      SELECT codice, modello, significato, categoria FROM ferrari_codice WHERE stato = 'approvata' ORDER BY id`,
    tx<{ pattern: string; tipo: string; valore: string; modello: string | null }[]>`
      SELECT pattern, tipo, valore, modello FROM ferrari_componente WHERE stato = 'approvata' ORDER BY id`,
    getConfig('conoscenza_versione', tx),
  ]);
  return { versione: Number(versione ?? 0), codici: [...codici], componenti: [...componenti] };
}

async function esempiConoscenza(): Promise<EsempioConoscenza[]> {
  const rows = await db<{ esempio_testo: string; pattern: string; tipo: string; valore: string; modello: string | null }[]>`
    SELECT esempio_testo, pattern, tipo, valore, modello FROM ferrari_componente
    WHERE stato = 'approvata' AND esempio_testo IS NOT NULL ORDER BY id DESC LIMIT 300`;
  return rows.map(r => ({ testo: r.esempio_testo, pattern: r.pattern, tipo: r.tipo, valore: r.valore, modello: r.modello }));
}

async function incrementaVersioneConoscenza(tx: Tx): Promise<number> {
  await tx`SELECT pg_advisory_xact_lock(${LOCK_CONOSCENZA})`;
  const [r] = await tx<{ value: string }[]>`
    UPDATE ferrari_config SET value = (value::int + 1)::text, updated_at = now()
    WHERE key = 'conoscenza_versione' RETURNING value`;
  return Number(r!.value);
}

// ─── Caricamento delle schede ─────────────────────────────────────────────────

export interface EsitoCaricamento {
  modello?: string | null; id: number; filename: string; stato: string; duplicato: boolean; sostituisce: number[]; stessa_commessa?: number[]; motivo?: string;
}

/**
 * La VM lavora sempre senza IA: la scheda e' subito leggibile, non aspetta nessuna risposta della PC IA.
 * (Il collegamento con la PC IA non e' attivo: resta pronto in caricaSchedaConIa, che non usa nessuna pagina.)
 */
export const caricaScheda = (user: Utente, filename: string, buf: Buffer) => caricaSchedaModo(user, filename, buf, false);
export const caricaSchedaConIa = (user: Utente, filename: string, buf: Buffer) => caricaSchedaModo(user, filename, buf, true);

async function caricaSchedaModo(user: Utente, filename: string, buf: Buffer, conIa: boolean): Promise<EsitoCaricamento> {
  const statoIniziale = conIa ? 'IN_ATTESA_IA' : 'ACCETTATO_AUTO';
  const iaStato = conIa ? 'in_attesa' : 'assente';
  const hash = sha256(buf);
  const nome = filename.replace(/[\\/]/g, '_').slice(0, 200) || 'scheda.xls';

  const [dup] = await db<{ id: number; stato: string }[]>`SELECT id, stato FROM ferrari_file WHERE sha256 = ${hash}`;
  if (dup) {
    await db.begin(async raw => audit(raw as unknown as Tx, user, 'file.duplicato', 'file', dup.id, { filename: nome }));
    return { id: dup.id, filename: nome, stato: dup.stato, duplicato: true, sostituisce: [] };
  }

  let canonico: Canonico | null = null;
  let motivoQuarantena: string | null = null;
  try {
    canonico = parseScheda(buf, nome);
  } catch (e) {
    if (!(e instanceof SchedaError)) throw e;
    motivoQuarantena = e.message;
  }

  try {
    return await db.begin(async raw => {
      const tx = raw as unknown as Tx;

      if (!canonico) {
        const [f] = await tx<{ id: number }[]>`
          INSERT INTO ferrari_file (filename, sha256, size_bytes, original, stato, ia_stato, quarantena_motivo, caricato_da_id, caricato_da)
          VALUES (${nome}, ${hash}, ${buf.length}, ${buf}, 'QUARANTENA', 'assente', ${motivoQuarantena}, ${user.id}, ${user.username})
          RETURNING id`;
        await audit(tx, user, 'file.quarantena', 'file', f!.id, { filename: nome, motivo: motivoQuarantena });
        return { id: f!.id, filename: nome, stato: 'QUARANTENA', duplicato: false, sostituisce: [], motivo: motivoQuarantena! };
      }

      const h = canonico.header;
      // un modello scritto male e gia' segnalato come errore si corregge da solo
      const [al] = h.tipo_matricola.modello
        ? await tx<{ giusto: string }[]>`SELECT giusto FROM ferrari_modello_alias WHERE sbagliato = ${h.tipo_matricola.modello.toUpperCase()}`
        : [];
      if (al) h.tipo_matricola.modello = al.giusto;
      // righe toccate a mano nell'Excel: non si scartano in silenzio, si segnano (e si propone la correzione)
      try {
        const altre = h.tipo_matricola.modello
          ? await tx<{ canonico: Canonico }[]>`
              SELECT canonico FROM ferrari_file WHERE modello = ${h.tipo_matricola.modello} AND commessa IS DISTINCT FROM ${h.commessa}
                AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND canonico IS NOT NULL`
          : [];
        const altreOpz = altre.map(a => a.canonico.opzioni);
        const noti = new Set<string>([...altreOpz.flatMap(l => l.map(o => o.codice)), ...canonico.opzioni.map(o => o.codice),
          ...(await tx<{ codice: string }[]>`SELECT DISTINCT codice FROM ferrari_sigla`).map(r => r.codice)]);
        const insiemi = altreOpz.map(l => new Set(l.map(o => o.codice)));
        const sempre = insiemi.length >= MIN_SCHEDE_RIFERIMENTO ? new Set([...insiemi[0]!].filter(c => insiemi.every(i => i.has(c)))) : new Set<string>();
        segna(canonico.opzioni, righeFoglio(buf), noti, sempre, riferimento(altreOpz));
      } catch { /* il controllo e' un di piu': non deve mai impedire di salvare la scheda */ }
      // due caricamenti insieme della stessa commessa: uno aspetta l'altro, cosi' la sostituzione vede la riga precedente
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'ferrari:' + h.commessa}))`;
      const [f] = await tx<{ id: number }[]>`
        INSERT INTO ferrari_file (filename, sha256, size_bytes, original, stato, ia_stato, commessa, modello, versione,
                                  mercato_codice, paese, matricola, canonico, caricato_da_id, caricato_da)
        VALUES (${nome}, ${hash}, ${buf.length}, ${buf}, ${statoIniziale}, ${iaStato}, ${h.commessa},
                ${h.tipo_matricola.modello}, ${h.tipo_matricola.versione}, ${h.tipo_matricola.mercato_codice},
                ${h.destinazione.paese}, ${h.tipo_matricola.matricola}, ${J(tx, canonico)}, ${user.id}, ${user.username})
        RETURNING id`;
      const id = f!.id;

      const k = await caricaConoscenza(tx);
      const vm = analizzaVm(canonico, k);
      await tx`INSERT INTO ferrari_analisi (file_id, fonte, risultato, versione_conoscenza) VALUES (${id}, 'vm', ${J(tx, vm)}, ${k.versione})`;

      // Nuova versione della stessa commessa e della stessa variante: la precedente resta archiviata e collegata.
      // Una variante diversa potrebbe essere un'altra vettura: non si tocca, ma si segnala.
      const variante = h.variante.codice;
      const vecchie = variante
        ? await tx<{ id: number }[]>`
            UPDATE ferrari_file SET stato = 'SOSTITUITO', sostituito_da = ${id}, chiuso_at = now(), chiuso_da = ${user.username}
            WHERE commessa = ${h.commessa} AND id <> ${id} AND stato NOT IN ('SOSTITUITO', 'QUARANTENA')
              AND canonico #>> '{header,variante,codice}' = ${variante}
            RETURNING id`
        : [];
      for (const v of vecchie) await audit(tx, user, 'file.sostituito', 'file', v.id, { sostituito_da: id });
      const altre = await tx<{ id: number }[]>`
        SELECT id FROM ferrari_file WHERE commessa = ${h.commessa} AND id <> ${id} AND stato NOT IN ('SOSTITUITO', 'QUARANTENA')`;

      await audit(tx, user, 'file.caricato', 'file', id, { filename: nome, sha256: hash, commessa: h.commessa, modello: h.tipo_matricola.modello });
      return { id, modello: h.tipo_matricola.modello, filename: nome, stato: statoIniziale, duplicato: false, sostituisce: vecchie.map(v => v.id), stessa_commessa: altre.map(a => a.id) };
    });
  } catch (e) {
    // Due caricamenti simultanei dello stesso file: vince il primo
    if ((e as { code?: string }).code === '23505') {
      const [again] = await db<{ id: number; stato: string }[]>`SELECT id, stato FROM ferrari_file WHERE sha256 = ${hash}`;
      if (again) return { id: again.id, filename: nome, stato: again.stato, duplicato: true, sostituisce: [] };
    }
    throw e;
  }
}

// ─── Pacchetti verso la PC IA ─────────────────────────────────────────────────

export async function creaPacchettoToAi(user: Utente, fileIds?: number[]) {
  const secret = await getSecret();
  const righe = await db<{ id: number; canonico: Canonico }[]>`
    SELECT id, canonico FROM ferrari_file
    WHERE stato = 'IN_ATTESA_IA' AND ia_stato = 'in_attesa'
      ${fileIds && fileIds.length ? db`AND id = ANY(${fileIds})` : db``}
    ORDER BY id`;
  if (righe.length === 0) throw new HTTPException(409, { message: 'Nessuna scheda in attesa di analisi IA' });

  const k = await caricaConoscenza();
  const { zip, manifest } = buildToAi({
    secret, schede: righe.map(r => ({ dbId: r.id, canonico: r.canonico })), conoscenza: k, esempi: await esempiConoscenza(),
  });

  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`
      INSERT INTO ferrari_bundle (bundle_id, tipo, direzione, batch_id, stato, manifest, file_ids, sha256, contenuto, creato_da)
      VALUES (${manifest.bundle_id}, 'to-ai', 'out', ${manifest.batch_id}, 'creato', ${J(tx, manifest)},
              ${righe.map(r => r.id)}, ${sha256(zip)}, ${zip}, ${user.username})`;
    await tx`UPDATE ferrari_file SET inviato_ia_at = now() WHERE id = ANY(${righe.map(r => r.id)})`;
    await audit(tx, user, 'bundle.to-ai.creato', 'bundle', manifest.bundle_id, { schede: righe.length, knowledge_version: k.versione });
  });
  return { zip, manifest, filename: `FERRARI_to-ai_${manifest.bundle_id}.zip`, schede: righe.length };
}

export async function creaPacchettoConoscenza(user: Utente) {
  const secret = await getSecret();
  const k = await caricaConoscenza();
  const { zip, manifest } = buildKnowledge({ secret, conoscenza: k, esempi: await esempiConoscenza() });
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`
      INSERT INTO ferrari_bundle (bundle_id, tipo, direzione, batch_id, stato, manifest, sha256, contenuto, creato_da)
      VALUES (${manifest.bundle_id}, 'knowledge', 'out', ${manifest.batch_id}, 'creato', ${J(tx, manifest)},
              ${sha256(zip)}, ${zip}, ${user.username})`;
    await audit(tx, user, 'bundle.knowledge.creato', 'bundle', manifest.bundle_id, { versione: k.versione });
  });
  return { zip, manifest, filename: `FERRARI_knowledge_v${k.versione}_${manifest.bundle_id}.zip` };
}

// ─── Importazione del risultato della IA ──────────────────────────────────────

export interface EsitoImportFile {
  file_id: string; id: number | null; esito: string | null; stato: string | null; errore?: string;
}

async function rifiutaBundle(user: Utente, filename: string, hash: string, motivo: string): Promise<never> {
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`INSERT INTO ferrari_bundle_rifiutato (filename, sha256, motivo, utente) VALUES (${filename.slice(0, 200)}, ${hash}, ${motivo}, ${user.username})`;
    await audit(tx, user, 'bundle.rifiutato', 'bundle', null, { filename, sha256: hash, motivo });
  });
  throw new HTTPException(400, { message: motivo });
}

function inCampione(hash: string, pct: number): boolean {
  return parseInt(hash.slice(0, 8), 16) % 100 < pct;
}

async function registraConfronto(
  tx: Tx, user: Utente, file: { id: number; sha256: string; canonico: Canonico },
  ia: { analisi: AnalisiIa; bundleId: string } | null, pct: number,
): Promise<{ esito: string; stato: string }> {
  const k = await caricaConoscenza(tx);
  const vm = analizzaVm(file.canonico, k);
  const [avm] = await tx<{ id: number }[]>`
    INSERT INTO ferrari_analisi (file_id, fonte, risultato, versione_conoscenza) VALUES (${file.id}, 'vm', ${J(tx, vm)}, ${k.versione}) RETURNING id`;
  let aiaId: number | null = null;
  if (ia) {
    const [aia] = await tx<{ id: number }[]>`
      INSERT INTO ferrari_analisi (file_id, fonte, risultato, versione_conoscenza, bundle_id)
      VALUES (${file.id}, 'ia', ${J(tx, ia.analisi)}, ${ia.analisi.run.knowledge_version}, ${ia.bundleId}) RETURNING id`;
    aiaId = aia!.id;
  }
  const r = confronta(vm, ia?.analisi ?? null);
  const [conf] = await tx<{ id: number }[]>`
    INSERT INTO ferrari_confronto (file_id, analisi_vm_id, analisi_ia_id, esito, risultato)
    VALUES (${file.id}, ${avm!.id}, ${aiaId}, ${r.esito}, ${J(tx, r)}) RETURNING id`;

  // Una rianalisi non deve far perdere il lavoro gia' fatto: le decisioni sugli item identici (stessa chiave,
  // calcolata sul contenuto) si riportano sul nuovo confronto, con la persona e l'ora originali.
  const chiavi = r.items.map(i => i.key);
  let riportate = 0;
  if (chiavi.length) {
    const copia = await tx`
      INSERT INTO ferrari_decisione (file_id, confronto_id, item_key, decisione, valore_dopo, motivo, proposta_id, user_id, username, creata_at, riportata_da)
      SELECT d.file_id, ${conf!.id}, d.item_key, d.decisione, d.valore_dopo, d.motivo, d.proposta_id, d.user_id, d.username, d.creata_at, d.id
      FROM ferrari_decisione d
      WHERE d.confronto_id = (SELECT id FROM ferrari_confronto WHERE file_id = ${file.id} AND id < ${conf!.id} ORDER BY id DESC LIMIT 1)
        AND d.item_key = ANY(${chiavi})
        AND d.id = (SELECT max(x.id) FROM ferrari_decisione x WHERE x.confronto_id = d.confronto_id AND x.item_key = d.item_key)`;
    riportate = copia.count;
  }

  const campione = r.esito === 'VERDE' && inCampione(file.sha256, pct);
  const auto = r.esito === 'VERDE' && !campione;
  const stato = auto ? 'ACCETTATO_AUTO' : 'IN_REVISIONE';
  const dati = auto ? costruisciDatiValidati(vm, r, [], true) : null;
  await tx`
    UPDATE ferrari_file SET stato = ${stato}, esito = ${r.esito}, campione = ${campione},
      ia_stato = ${ia ? 'ricevuta' : 'assente'}, dati_validati = ${dati ? J(tx, dati) : null},
      chiuso_da = ${auto ? 'automatico' : null}, chiuso_at = ${auto ? new Date() : null}
    WHERE id = ${file.id}`;
  await audit(tx, user, auto ? 'file.accettato_auto' : 'file.confrontato', 'file', file.id, {
    confronto_id: conf!.id, esito: r.esito, items: r.items.length, decisioni_riportate: riportate, campione, ia: !!ia,
    versioni: r.versioni,
  });
  return { esito: r.esito, stato };
}

export async function importaRisultatoIa(user: Utente, filename: string, buf: Buffer) {
  const hash = sha256(buf);
  const secret = await getSecret();
  let letto;
  try {
    letto = leggiBundle(buf, secret, 'from-ai');
  } catch (e) {
    if (e instanceof BundleError) return rifiutaBundle(user, filename, hash, e.message);
    throw e;
  }
  const { manifest, files } = letto;

  const [gia] = await db<{ bundle_id: string }[]>`SELECT bundle_id FROM ferrari_bundle WHERE bundle_id = ${manifest.bundle_id}`;
  if (gia) return rifiutaBundle(user, filename, hash, 'Pacchetto già importato (stesso bundle_id)');

  if (!manifest.in_reply_to) return rifiutaBundle(user, filename, hash, 'Il pacchetto non indica a quale invio risponde (in_reply_to)');
  const [invio] = await db<{ bundle_id: string; batch_id: string; file_ids: number[]; manifest: { knowledge_version: number } }[]>`
    SELECT bundle_id, batch_id, file_ids, manifest FROM ferrari_bundle WHERE bundle_id = ${manifest.in_reply_to} AND tipo = 'to-ai' AND direzione = 'out'`;
  if (!invio) return rifiutaBundle(user, filename, hash, 'Il pacchetto risponde a un invio sconosciuto');
  if (invio.batch_id !== manifest.batch_id) return rifiutaBundle(user, filename, hash, 'batch_id diverso da quello dell\'invio');

  const risultati = new Map<string, AnalisiIa>();
  const errori = new Map<string, string>();
  for (const [path, contenuto] of files) {
    const m = /^results\/(f\d+)\.json$/.exec(path);
    if (!m) continue;
    try {
      risultati.set(m[1]!, leggiRisultatoIa(contenuto));
    } catch (e) {
      errori.set(m[1]!, (e as Error).message);
    }
  }
  if (risultati.size === 0 && errori.size === 0) return rifiutaBundle(user, filename, hash, 'Nessun risultato nel pacchetto');

  const pct = await samplingPct();
  const report: EsitoImportFile[] = [];

  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    for (const [fid, msg] of errori) report.push({ file_id: fid, id: null, esito: null, stato: null, errore: msg });

    for (const [fid, ia] of risultati) {
      const id = Number(fid.slice(1));
      if (ia.file_id !== fid) { report.push({ file_id: fid, id, esito: null, stato: null, errore: 'file_id interno diverso dal nome' }); continue; }
      if (!invio.file_ids.includes(id)) { report.push({ file_id: fid, id, esito: null, stato: null, errore: 'scheda non inclusa nell\'invio' }); continue; }
      const [f] = await tx<{ id: number; sha256: string; stato: string; canonico: Canonico }[]>`
        SELECT id, sha256, stato, canonico FROM ferrari_file WHERE id = ${id} FOR UPDATE`;
      if (!f) { report.push({ file_id: fid, id, esito: null, stato: null, errore: 'scheda inesistente' }); continue; }
      if (f.sha256 !== ia.source_sha256) { report.push({ file_id: fid, id, esito: null, stato: null, errore: 'hash della scheda diverso: risultato riferito a un altro file' }); continue; }
      if (!['IN_ATTESA_IA', 'IN_REVISIONE', 'ACCETTATO_AUTO'].includes(f.stato)) {
        report.push({ file_id: fid, id, esito: null, stato: f.stato, errore: `scheda già chiusa (${f.stato})` }); continue;
      }
      const r = await registraConfronto(tx, user, f, { analisi: ia, bundleId: manifest.bundle_id }, pct);
      report.push({ file_id: fid, id, esito: r.esito, stato: r.stato });
    }

    const accettati = report.filter(r => r.esito).map(r => r.id!);
    await tx`
      INSERT INTO ferrari_bundle (bundle_id, tipo, direzione, batch_id, in_reply_to, stato, manifest, file_ids, sha256, creato_da)
      VALUES (${manifest.bundle_id}, 'from-ai', 'in', ${manifest.batch_id}, ${manifest.in_reply_to}, 'importato',
              ${J(tx, manifest)}, ${accettati}, ${hash}, ${user.username})`;
    await audit(tx, user, 'bundle.from-ai.importato', 'bundle', manifest.bundle_id, {
      accettati: accettati.length, scartati: report.length - accettati.length, filename,
    });
  });

  const mancanti = invio.file_ids.filter(id => !report.some(r => r.id === id));
  return { bundle_id: manifest.bundle_id, report, mancanti };
}

// ─── Casi particolari ─────────────────────────────────────────────────────────

/** Rivede una scheda senza attendere la IA (IA non disponibile). Non puo' mai essere accettata in automatico. */
export async function revisioneSenzaIa(user: Utente, id: number) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; sha256: string; stato: string; canonico: Canonico }[]>`
      SELECT id, sha256, stato, canonico FROM ferrari_file WHERE id = ${id} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (f.stato !== 'IN_ATTESA_IA') throw new HTTPException(409, { message: `Stato ${f.stato}: solo le schede in attesa della IA possono passare senza` });
    const r = await registraConfronto(tx, user, f, null, 100);
    await audit(tx, user, 'file.solo_vm', 'file', id, null);
    return r;
  });
}

/** Rimanda una scheda alla IA (es. risposta incompleta). Le decisioni gia' prese si riportano alla prossima importazione. */
export async function reinviaAllaIa(user: Utente, id: number) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; stato: string }[]>`SELECT id, stato FROM ferrari_file WHERE id = ${id} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (!['IN_REVISIONE', 'ACCETTATO_AUTO'].includes(f.stato)) {
      throw new HTTPException(409, { message: `Stato ${f.stato}: la scheda non si può rimandare alla IA` });
    }
    await tx`UPDATE ferrari_file SET stato = 'IN_ATTESA_IA', ia_stato = 'in_attesa', inviato_ia_at = NULL, esito = NULL,
             campione = FALSE, chiuso_da = NULL, chiuso_at = NULL, dati_validati = NULL, rev = rev + 1 WHERE id = ${id}`;
    await audit(tx, user, 'file.reinviato_ia', 'file', id, null);
    return { stato: 'IN_ATTESA_IA' };
  });
}

/** Rifa l'analisi della VM con la conoscenza attuale e la ricompara con l'ultima analisi IA (se c'e'). */
export async function rianalizza(user: Utente, id: number) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; sha256: string; stato: string; canonico: Canonico; ia_stato: string }[]>`
      SELECT id, sha256, stato, canonico, ia_stato FROM ferrari_file WHERE id = ${id} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (!['IN_ATTESA_IA', 'IN_REVISIONE', 'ACCETTATO_AUTO'].includes(f.stato)) {
      throw new HTTPException(409, { message: `Stato ${f.stato}: la scheda non si può rianalizzare` });
    }
    if (f.stato === 'IN_ATTESA_IA') {
      const k = await caricaConoscenza(tx);
      const vm = analizzaVm(f.canonico, k);
      await tx`INSERT INTO ferrari_analisi (file_id, fonte, risultato, versione_conoscenza) VALUES (${id}, 'vm', ${J(tx, vm)}, ${k.versione})`;
      await audit(tx, user, 'file.rianalizzato', 'file', id, { versione: k.versione });
      return { esito: null, stato: f.stato };
    }
    const [ultimaIa] = await tx<{ risultato: AnalisiIa; bundle_id: string }[]>`
      SELECT risultato, bundle_id FROM ferrari_analisi WHERE file_id = ${id} AND fonte = 'ia' ORDER BY id DESC LIMIT 1`;
    const r = await registraConfronto(tx, user, f, ultimaIa ? { analisi: ultimaIa.risultato, bundleId: ultimaIa.bundle_id } : null, await samplingPct(tx));
    await tx`UPDATE ferrari_file SET rev = rev + 1 WHERE id = ${id}`;
    await audit(tx, user, 'file.rianalizzato', 'file', id, { esito: r.esito });
    return r;
  });
}

// ─── Revisione: decisioni ─────────────────────────────────────────────────────

export interface PropostaInput {
  tipo: 'componente' | 'codice';
  ambito: 'MODELLO' | 'TUTTI';
  modello?: string;                 // solo per proposte fuori da una scheda con ambito MODELLO
  // componente
  pattern?: string; comp_tipo?: string; valore?: string; esempio_testo?: string;
  // codice
  codice?: string; significato?: string; categoria?: string;
}

export interface DecisioneInput {
  rev: number; item_key: string; decisione: Decisione;
  valore_dopo?: ValoreDopo | null; motivo?: string | null; proposta?: PropostaInput | null;
}

async function ultimoConfronto(tx: Tx, fileId: number) {
  const [c] = await tx<{ id: number; risultato: RisultatoConfronto; analisi_vm_id: number }[]>`
    SELECT id, risultato, analisi_vm_id FROM ferrari_confronto WHERE file_id = ${fileId} ORDER BY id DESC LIMIT 1`;
  return c ?? null;
}

async function decisioniDelConfronto(tx: Tx, confrontoId: number): Promise<DecisioneRecord[]> {
  return tx<DecisioneRecord[]>`
    SELECT item_key, decisione, valore_dopo, motivo, username, creata_at
    FROM ferrari_decisione WHERE confronto_id = ${confrontoId} ORDER BY id`;
}

async function creaProposta(tx: Tx, user: Utente, file: { id: number; modello: string | null }, p: PropostaInput): Promise<number> {
  const modello = p.ambito === 'MODELLO' ? ((p.modello?.trim().toUpperCase() || file.modello) ?? null) : null;
  if (p.ambito === 'MODELLO' && !modello) throw new HTTPException(400, { message: 'Indicare il modello oppure usare ambito TUTTI' });

  if (p.tipo === 'codice') {
    const codice = (p.codice ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(codice)) throw new HTTPException(400, { message: 'Codice non valido (4 caratteri)' });
    if (!p.significato?.trim()) throw new HTTPException(400, { message: 'Indicare il significato del codice' });
    const [dup] = await tx<{ id: number }[]>`
      SELECT id FROM ferrari_codice WHERE codice = ${codice} AND COALESCE(modello, '') = ${modello ?? ''} AND stato IN ('proposta', 'approvata') LIMIT 1`;
    if (dup) return dup.id;
    const [r] = await tx<{ id: number }[]>`
      INSERT INTO ferrari_codice (codice, modello, significato, categoria, proposto_da, proposto_da_id, file_origine_id)
      VALUES (${codice}, ${modello}, ${p.significato.trim()}, ${p.categoria?.trim() || null}, ${user.username}, ${user.id}, ${file.id || null})
      RETURNING id`;
    await audit(tx, user, 'conoscenza.codice.proposto', 'codice', r!.id, { codice, modello });
    return r!.id;
  }

  const pattern = collapse(p.pattern ?? '');
  const tipo = (p.comp_tipo ?? '').trim().toUpperCase();
  if (!pattern || pattern.length > 200) throw new HTTPException(400, { message: 'Pattern non valido' });
  if (!TIPI_DIZIONARIO.includes(tipo)) throw new HTTPException(400, { message: `Tipo non valido (ammessi: ${TIPI_DIZIONARIO.join(', ')})` });
  const valore = tipo === TIPO_NEUTRO ? '-' : (p.valore ?? '').trim();
  if (!valore) throw new HTTPException(400, { message: 'Indicare il valore' });
  const [dup] = await tx<{ id: number }[]>`
    SELECT id FROM ferrari_componente WHERE pattern = ${pattern} AND tipo = ${tipo} AND COALESCE(modello, '') = ${modello ?? ''}
      AND stato IN ('proposta', 'approvata') LIMIT 1`;
  if (dup) return dup.id;
  const [r] = await tx<{ id: number }[]>`
    INSERT INTO ferrari_componente (pattern, tipo, valore, modello, esempio_testo, proposto_da, proposto_da_id, file_origine_id)
    VALUES (${pattern}, ${tipo}, ${valore}, ${modello}, ${p.esempio_testo?.slice(0, 1000) ?? null}, ${user.username}, ${user.id}, ${file.id || null})
    RETURNING id`;
  await audit(tx, user, 'conoscenza.componente.proposto', 'componente', r!.id, { pattern, tipo, valore, modello });
  return r!.id;
}

export async function registraDecisione(user: Utente, fileId: number, d: DecisioneInput) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; stato: string; rev: number; modello: string | null }[]>`
      SELECT id, stato, rev, modello FROM ferrari_file WHERE id = ${fileId} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (f.stato !== 'IN_REVISIONE') throw new HTTPException(409, { message: `Stato ${f.stato}: la scheda non è in revisione` });
    if (f.rev !== d.rev) throw new HTTPException(409, { message: 'La scheda è stata modificata da un\'altra persona: ricaricare' });

    const conf = await ultimoConfronto(tx, fileId);
    if (!conf) throw new HTTPException(409, { message: 'Nessun confronto disponibile' });
    const item = conf.risultato.items.find(i => i.key === d.item_key);
    if (!item) throw new HTTPException(404, { message: 'Elemento da rivedere non trovato' });

    const err = erroreDecisione(item, d.decisione, d.valore_dopo ?? null, d.motivo ?? null);
    if (err) throw new HTTPException(400, { message: err });

    let propostaId: number | null = null;
    if (d.proposta) {
      if (d.decisione !== 'correggi' && d.decisione !== 'conferma_ia' && d.decisione !== 'conferma_vm') {
        throw new HTTPException(400, { message: 'Una regola si può proporre solo confermando o correggendo' });
      }
      propostaId = await creaProposta(tx, user, f, d.proposta);
    }

    await tx`
      INSERT INTO ferrari_decisione (file_id, confronto_id, item_key, decisione, valore_dopo, motivo, proposta_id, user_id, username)
      VALUES (${fileId}, ${conf.id}, ${d.item_key}, ${d.decisione}, ${d.valore_dopo ? J(tx, d.valore_dopo) : null},
              ${d.motivo?.trim() || null}, ${propostaId}, ${user.id}, ${user.username})`;
    const [upd] = await tx<{ rev: number }[]>`UPDATE ferrari_file SET rev = rev + 1 WHERE id = ${fileId} RETURNING rev`;
    await audit(tx, user, 'decisione.registrata', 'file', fileId, {
      item_key: d.item_key, tipo: item.tipo, decisione: d.decisione, proposta_id: propostaId, motivo: d.motivo ?? null,
    });
    return { rev: upd!.rev, proposta_id: propostaId };
  });
}

export async function validaScheda(user: Utente, fileId: number, rev: number) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; stato: string; rev: number }[]>`SELECT id, stato, rev FROM ferrari_file WHERE id = ${fileId} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (f.stato !== 'IN_REVISIONE') throw new HTTPException(409, { message: `Stato ${f.stato}: la scheda non è in revisione` });
    if (f.rev !== rev) throw new HTTPException(409, { message: 'La scheda è stata modificata da un\'altra persona: ricaricare' });
    const conf = await ultimoConfronto(tx, fileId);
    if (!conf) throw new HTTPException(409, { message: 'Nessun confronto disponibile' });
    const decisioni = await decisioniDelConfronto(tx, conf.id);
    const aperti = itemNonRisolti(conf.risultato, decisioni);
    if (aperti.length) throw new HTTPException(409, { message: `Restano ${aperti.length} elementi da rivedere` });
    const [avm] = await tx<{ risultato: AnalisiVm }[]>`SELECT risultato FROM ferrari_analisi WHERE id = ${conf.analisi_vm_id}`;
    const dati = costruisciDatiValidati(avm!.risultato, conf.risultato, decisioni, false);
    await tx`
      UPDATE ferrari_file SET stato = 'VALIDATO', dati_validati = ${J(tx, dati)}, chiuso_da = ${user.username}, chiuso_at = now(), rev = rev + 1
      WHERE id = ${fileId}`;
    await audit(tx, user, 'file.validato', 'file', fileId, { confronto_id: conf.id, decisioni: decisioni.length });
    return { stato: 'VALIDATO' };
  });
}

export async function rifiutaScheda(user: Utente, fileId: number, rev: number, motivo: string) {
  if (!motivo.trim()) throw new HTTPException(400, { message: 'Il motivo del rifiuto è obbligatorio' });
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const [f] = await tx<{ id: number; stato: string; rev: number }[]>`SELECT id, stato, rev FROM ferrari_file WHERE id = ${fileId} FOR UPDATE`;
    if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
    if (['VALIDATO', 'RIFIUTATO', 'SOSTITUITO'].includes(f.stato)) throw new HTTPException(409, { message: `Stato ${f.stato}: scheda già chiusa` });
    if (f.rev !== rev) throw new HTTPException(409, { message: 'La scheda è stata modificata da un\'altra persona: ricaricare' });
    await tx`UPDATE ferrari_file SET stato = 'RIFIUTATO', chiuso_da = ${user.username}, chiuso_at = now(), rev = rev + 1 WHERE id = ${fileId}`;
    await audit(tx, user, 'file.rifiutato', 'file', fileId, { motivo: motivo.trim() });
    return { stato: 'RIFIUTATO' };
  });
}

// ─── Conoscenza: approvazione ─────────────────────────────────────────────────

export type Entita = 'codice' | 'componente';

export async function decidiConoscenza(
  user: Utente, entita: Entita, ids: number[], azione: 'approva' | 'rifiuta' | 'revoca', motivo: string | null,
) {
  if (ids.length === 0) throw new HTTPException(400, { message: 'Nessun elemento selezionato' });
  if ((azione === 'rifiuta' || azione === 'revoca') && !(motivo && motivo.trim())) {
    throw new HTTPException(400, { message: 'Il motivo è obbligatorio' });
  }
  const quattroOcchi = (await getConfig('four_eyes')) !== 'false';

  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const tabella = entita === 'codice' ? 'ferrari_codice' : 'ferrari_componente';
    const righe = await tx<{ id: number; stato: string; proposto_da_id: number | null }[]>`
      SELECT id, stato, proposto_da_id FROM ${tx(tabella)} WHERE id = ANY(${ids}) FOR UPDATE`;
    if (righe.length !== new Set(ids).size) throw new HTTPException(404, { message: 'Elemento non trovato' });

    for (const r of righe) {
      if (azione === 'revoca' ? r.stato !== 'approvata' : r.stato !== 'proposta') {
        throw new HTTPException(409, { message: `Elemento ${r.id}: stato ${r.stato}, azione "${azione}" non possibile` });
      }
      if (azione === 'approva' && quattroOcchi && r.proposto_da_id !== null && r.proposto_da_id === user.id) {
        throw new HTTPException(403, { message: `Elemento ${r.id}: chi propone una regola non può approvarla (doppia firma)` });
      }
    }

    const nuovoStato = azione === 'approva' ? 'approvata' : azione === 'rifiuta' ? 'rifiutata' : 'revocata';
    let versione: number | null = null;
    if (azione !== 'rifiuta') versione = await incrementaVersioneConoscenza(tx);

    try {
      await tx`
        UPDATE ${tx(tabella)} SET stato = ${nuovoStato}, deciso_da = ${user.username}, deciso_da_id = ${user.id},
          deciso_at = now(), motivo = ${motivo?.trim() || null},
          versione_in = ${azione === 'approva' ? versione : null}
        WHERE id = ANY(${ids})`;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new HTTPException(409, { message: 'Esiste già una regola approvata uguale' });
      }
      throw e;
    }
    for (const id of ids) await audit(tx, user, `conoscenza.${entita}.${azione}`, entita, id, { motivo: motivo ?? null, versione });
    return { versione: versione ?? Number(await getConfig('conoscenza_versione', tx)), aggiornati: ids.length };
  });
}

export async function proponiConoscenzaDiretta(user: Utente, p: PropostaInput) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    // Proposta senza scheda di origine (es. caricamento della tabella codici): il modello arriva dal chiamante
    return creaProposta(tx, user, { id: 0, modello: null }, p);
  });
}

// ─── Lettura ──────────────────────────────────────────────────────────────────

export interface FiltriFile {
  stato?: string; esito?: string; modello?: string; q?: string; dal?: string; al?: string; codice?: string;
  limite?: number; offset?: number;
}

export async function listaFile(f: FiltriFile) {
  const limite = Math.min(Math.max(f.limite ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const q = f.q?.trim();
  const rows = await db`
    SELECT id, filename, stato, ia_stato, esito, campione, commessa, modello, versione, mercato_codice, paese,
           caricato_da, caricato_at, inviato_ia_at, chiuso_da, chiuso_at, sostituito_da, quarantena_motivo,
           (SELECT count(*)::int FROM ferrari_confronto c WHERE c.file_id = ferrari_file.id) AS n_confronti,
           COALESCE((SELECT jsonb_array_length(risultato->'items') FROM ferrari_confronto c WHERE c.file_id = ferrari_file.id ORDER BY id DESC LIMIT 1), 0)::int AS n_items,
           COALESCE((SELECT count(DISTINCT d.item_key) FROM ferrari_decisione d JOIN (SELECT id FROM ferrari_confronto WHERE file_id = ferrari_file.id ORDER BY id DESC LIMIT 1) lc ON lc.id = d.confronto_id), 0)::int AS n_decisioni
    FROM ferrari_file
    WHERE TRUE
      ${f.stato ? db`AND stato = ${f.stato}` : db``}
      ${f.esito ? db`AND esito = ${f.esito}` : db``}
      ${f.modello ? db`AND modello = ${f.modello.toUpperCase()}` : db``}
      ${f.dal ? db`AND caricato_at >= ${f.dal}::date` : db``}
      ${f.al ? db`AND caricato_at < (${f.al}::date + 1)` : db``}
      ${f.codice ? db`AND EXISTS (SELECT 1 FROM jsonb_array_elements(canonico->'opzioni') o WHERE o->>'codice' = ${f.codice.toUpperCase()})` : db``}
      ${q ? db`AND (filename ILIKE ${'%' + q + '%'} OR commessa ILIKE ${'%' + q + '%'} OR matricola ILIKE ${'%' + q + '%'}
                    OR modello ILIKE ${'%' + q + '%'} OR versione ILIKE ${'%' + q + '%'} OR paese ILIKE ${'%' + q + '%'})` : db``}
    ORDER BY caricato_at DESC, id DESC
    LIMIT ${limite} OFFSET ${offset}`;
  const [tot] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ferrari_file
    WHERE TRUE
      ${f.stato ? db`AND stato = ${f.stato}` : db``}
      ${f.esito ? db`AND esito = ${f.esito}` : db``}
      ${f.modello ? db`AND modello = ${f.modello.toUpperCase()}` : db``}
      ${f.dal ? db`AND caricato_at >= ${f.dal}::date` : db``}
      ${f.al ? db`AND caricato_at < (${f.al}::date + 1)` : db``}
      ${f.codice ? db`AND EXISTS (SELECT 1 FROM jsonb_array_elements(canonico->'opzioni') o WHERE o->>'codice' = ${f.codice.toUpperCase()})` : db``}
      ${q ? db`AND (filename ILIKE ${'%' + q + '%'} OR commessa ILIKE ${'%' + q + '%'} OR matricola ILIKE ${'%' + q + '%'}
                    OR modello ILIKE ${'%' + q + '%'} OR versione ILIKE ${'%' + q + '%'} OR paese ILIKE ${'%' + q + '%'})` : db``}`;
  return { totale: tot!.n, righe: rows };
}

export async function riepilogo() {
  const stati = await db<{ stato: string; n: number }[]>`SELECT stato, count(*)::int AS n FROM ferrari_file GROUP BY stato`;
  const [prop] = await db<{ codici: number; componenti: number }[]>`
    SELECT (SELECT count(*) FROM ferrari_codice WHERE stato = 'proposta')::int AS codici,
           (SELECT count(*) FROM ferrari_componente WHERE stato = 'proposta')::int AS componenti`;
  const ore = Number((await getConfig('ia_attesa_ore')) ?? 48);
  const [scadute] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ferrari_file
    WHERE stato = 'IN_ATTESA_IA' AND inviato_ia_at IS NOT NULL AND inviato_ia_at < now() - make_interval(hours => ${ore})`;
  const k = await getConfig('conoscenza_versione');
  return {
    stati: Object.fromEntries(stati.map(s => [s.stato, s.n])),
    proposte: prop,
    ia_in_ritardo: scadute!.n,
    conoscenza_versione: Number(k ?? 0),
  };
}

export async function dettaglioFile(id: number) {
  const [f] = await db`
    SELECT id, filename, sha256, size_bytes, stato, ia_stato, esito, campione, commessa, modello, versione, mercato_codice, paese,
           matricola, canonico, quarantena_motivo, sostituito_da, dati_validati, rev, caricato_da, caricato_at, inviato_ia_at,
           chiuso_da, chiuso_at,
           (SELECT array_agg(id) FROM ferrari_file x WHERE x.sostituito_da = ferrari_file.id) AS sostituisce
    FROM ferrari_file WHERE id = ${id}`;
  if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
  const [vm] = await db`SELECT id, risultato, versione_conoscenza, creata_at FROM ferrari_analisi WHERE file_id = ${id} AND fonte = 'vm' ORDER BY id DESC LIMIT 1`;
  const [ia] = await db`SELECT id, risultato, versione_conoscenza, bundle_id, creata_at FROM ferrari_analisi WHERE file_id = ${id} AND fonte = 'ia' ORDER BY id DESC LIMIT 1`;
  const [conf] = await db`SELECT id, esito, risultato, analisi_vm_id, analisi_ia_id, creato_at FROM ferrari_confronto WHERE file_id = ${id} ORDER BY id DESC LIMIT 1`;
  const decisioni = conf
    ? await db`SELECT id, item_key, decisione, valore_dopo, motivo, proposta_id, username, creata_at FROM ferrari_decisione WHERE confronto_id = ${conf.id} ORDER BY id`
    : [];
  // Per mostrare il confronto il testo della VM che corrisponde al confronto, non per forza l'ultimo
  const [vmConfronto] = conf ? await db`SELECT risultato FROM ferrari_analisi WHERE id = ${conf.analisi_vm_id}` : [];
  const storico = await db`
    SELECT id, ts, username, azione, dettagli FROM ferrari_audit WHERE entita = 'file' AND entita_id = ${String(id)} ORDER BY id`;
  const confronti = await db`SELECT id, esito, creato_at FROM ferrari_confronto WHERE file_id = ${id} ORDER BY id DESC`;
  return { file: f, vm: vm ?? null, vm_confronto: vmConfronto?.risultato ?? null, ia: ia ?? null, confronto: conf ?? null, confronti, decisioni, storico };
}

export async function scaricaOriginale(id: number) {
  const [f] = await db<{ filename: string; original: Buffer }[]>`SELECT filename, original FROM ferrari_file WHERE id = ${id}`;
  if (!f) throw new HTTPException(404, { message: 'Scheda non trovata' });
  return f;
}

export async function listaConoscenza(stato?: string) {
  const codici = await db`
    SELECT id, codice, modello, significato, categoria, stato, proposto_da, proposto_at, deciso_da, deciso_at, motivo, file_origine_id, versione_in
    FROM ferrari_codice ${stato ? db`WHERE stato = ${stato}` : db``} ORDER BY (stato = 'proposta') DESC, id DESC LIMIT 1000`;
  const componenti = await db`
    SELECT id, pattern, tipo, valore, modello, esempio_testo, stato, proposto_da, proposto_at, deciso_da, deciso_at, motivo, file_origine_id, versione_in
    FROM ferrari_componente ${stato ? db`WHERE stato = ${stato}` : db``} ORDER BY (stato = 'proposta') DESC, id DESC LIMIT 1000`;
  return { codici, componenti, versione: Number((await getConfig('conoscenza_versione')) ?? 0) };
}

export async function listaBundle() {
  const rows = await db`
    SELECT bundle_id, tipo, direzione, batch_id, in_reply_to, stato, motivo, file_ids, sha256, creato_da, creato_at,
           (contenuto IS NOT NULL) AS scaricabile
    FROM ferrari_bundle ORDER BY creato_at DESC LIMIT 200`;
  const rifiutati = await db`SELECT id, filename, sha256, motivo, utente, creato_at FROM ferrari_bundle_rifiutato ORDER BY id DESC LIMIT 50`;
  return { bundle: rows, rifiutati };
}

export async function scaricaBundle(bundleId: string) {
  const [b] = await db<{ tipo: string; contenuto: Buffer | null }[]>`SELECT tipo, contenuto FROM ferrari_bundle WHERE bundle_id = ${bundleId}`;
  if (!b || !b.contenuto) throw new HTTPException(404, { message: 'Pacchetto non disponibile' });
  return { filename: `FERRARI_${b.tipo}_${bundleId}.zip`, contenuto: b.contenuto };
}

/** Ricerca trasversale per la pagina di consulta. */
export async function cerca(q: string) {
  const like = `%${q.trim()}%`;
  if (q.trim().length < 2) throw new HTTPException(400, { message: 'Scrivere almeno 2 caratteri' });
  const [file, codici, componenti, decisioni, storico] = await Promise.all([
    db`SELECT id, filename, stato, esito, commessa, modello, caricato_at FROM ferrari_file
       WHERE filename ILIKE ${like} OR commessa ILIKE ${like} OR matricola ILIKE ${like} OR modello ILIKE ${like}
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(canonico->'opzioni') o
                     WHERE o->>'codice' ILIKE ${like} OR o->>'valore' ILIKE ${like} OR o->>'descrizione' ILIKE ${like}
                        OR o->>'nota' ILIKE ${like} OR (o->'blocchi_testo')::text ILIKE ${like})
       ORDER BY caricato_at DESC LIMIT 50`,
    db`SELECT id, codice, modello, significato, stato FROM ferrari_codice WHERE codice ILIKE ${like} OR significato ILIKE ${like} ORDER BY id DESC LIMIT 50`,
    db`SELECT id, pattern, tipo, valore, modello, stato FROM ferrari_componente WHERE pattern ILIKE ${like} OR valore ILIKE ${like} ORDER BY id DESC LIMIT 50`,
    db`SELECT d.id, d.file_id, d.item_key, d.decisione, d.motivo, d.username, d.creata_at FROM ferrari_decisione d
       WHERE d.motivo ILIKE ${like} OR d.valore_dopo::text ILIKE ${like} OR d.username ILIKE ${like} ORDER BY d.id DESC LIMIT 50`,
    db`SELECT id, ts, username, azione, entita, entita_id FROM ferrari_audit
       WHERE azione ILIKE ${like} OR username ILIKE ${like} OR dettagli::text ILIKE ${like} ORDER BY id DESC LIMIT 50`,
  ]);
  return { file, codici, componenti, decisioni, storico };
}

export async function listaAudit(limite = 200, entita?: string, entitaId?: string) {
  return db`
    SELECT id, ts, username, azione, entita, entita_id, dettagli, hash
    FROM ferrari_audit
    WHERE TRUE ${entita ? db`AND entita = ${entita}` : db``} ${entitaId ? db`AND entita_id = ${entitaId}` : db``}
    ORDER BY id DESC LIMIT ${Math.min(limite, 1000)}`;
}

export async function configCorrente() {
  const rows = await db<{ key: string; value: string }[]>`
    SELECT key, value FROM ferrari_config WHERE key <> 'bundle_secret' ORDER BY key`;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function aggiornaConfig(user: Utente, cambi: Partial<{ sampling_pct: number; four_eyes: boolean; ia_attesa_ore: number }>) {
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    if (cambi.sampling_pct !== undefined) await setConfig('sampling_pct', String(cambi.sampling_pct), tx);
    if (cambi.four_eyes !== undefined) await setConfig('four_eyes', String(cambi.four_eyes), tx);
    if (cambi.ia_attesa_ore !== undefined) await setConfig('ia_attesa_ore', String(cambi.ia_attesa_ore), tx);
    await audit(tx, user, 'config.aggiornata', 'config', null, cambi);
  });
}

export async function mostraSegreto(user: Utente): Promise<string> {
  const s = await getSecret();
  await db.begin(async raw => audit(raw as unknown as Tx, user, 'config.segreto.visualizzato', 'config', null, null));
  return s;
}

export function logErrore(msg: string, err: unknown) {
  logger.error({ err }, msg);
}

export type { ItemConfronto };

export function normalizzaSigla(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

export const TUTTI = '*';

/**
 * Tabella commesse: per un modello, colonne = le sigle che «vanno», una riga per commessa.
 * `nuove` = sigle trovate nelle schede e non ancora decise: la pagina chiede se vanno (per il modello o per tutti).
 * Esclude le schede sostituite, rifiutate e in quarantena.
 */
/** Riassunti dei testi lunghi arrivati dalla PC IA, per commessa (si usano solo se il testo e' ancora lo stesso). */
export async function caricaDettagli(commesse: string[]): Promise<DettagliPerCommessa> {
  const dettagli: DettagliPerCommessa = new Map();
  if (commesse.length === 0) return dettagli;
  const righe = await db<{ commessa: string; codice: string; chiave: string; dettaglio: string; stato: string }[]>`
    SELECT commessa, codice, chiave, dettaglio, stato FROM ferrari_dettaglio WHERE commessa IN ${db(commesse)}`;
  for (const r of righe) {
    if (!dettagli.has(r.commessa)) dettagli.set(r.commessa, new Map());
    dettagli.get(r.commessa)!.set(r.chiave, { dettaglio: r.dettaglio, stato: r.stato });
  }
  return dettagli;
}

export async function matrice(modello?: string, q?: string, conRighe = true) {
  const modelli = await db<{ modello: string; schede: number }[]>`
    SELECT modello, count(*)::int AS schede FROM ferrari_file
    WHERE stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND modello IS NOT NULL
    GROUP BY modello ORDER BY max(caricato_at) DESC`;
  const scelto = (modello?.trim().toUpperCase() || modelli[0]?.modello) ?? '';
  const proposte = await proposteSigle();
  if (!scelto) return { modelli, modello: '', termini: [] as string[], nuove: [], sigle: [], righe: [], proposte };

  // Decisione del modello prevale su quella per tutti
  const rows = await db<{ modello: string; codice: string; va: boolean; ordine: string; sub: boolean; alias: string | null; nosigla: boolean; auto: boolean; padre: string | null }[]>`
    SELECT modello, codice, va, ordine, sub, alias, nosigla, auto, padre FROM ferrari_sigla WHERE modello IN (${TUTTI}, ${scelto}) ORDER BY ordine`;
  const decisioni = new Map<string, { va: boolean; ordine: number; ambito: 'tutti' | 'modello'; sub: boolean; alias: string | null; nosigla: boolean; auto: boolean; padre: string | null }>();
  for (const m of [TUTTI, scelto]) {
    for (const r of rows.filter(x => x.modello === m)) {
      decisioni.set(r.codice, { va: r.va, ordine: Number(r.ordine), ambito: m === TUTTI ? 'tutti' : 'modello', sub: r.sub, alias: r.alias, nosigla: r.nosigla, auto: r.auto, padre: r.padre });
    }
  }
  const ordinate = [...decisioni.entries()].sort((a, b) => a[1].ordine - b[1].ordine);
  // un alias non e' una colonna ne' una sotto-sigla: e' solo «questo codice e' un errore di quell'altro»
  const termini = ordinate.filter(([, d]) => d.va && !d.sub && !d.alias).map(([c]) => c);
  const subOk = new Set(ordinate.filter(([, d]) => d.va && d.sub && !d.alias).map(([c]) => c));
  const subPadre = new Map(ordinate.filter(([, d]) => d.va && d.sub && !d.alias && d.padre).map(([c, d]) => [c, d.padre!] as [string, string]));
  const ctx: CtxSigle = {
    alias: new Map(ordinate.filter(([, d]) => d.alias).map(([c, d]) => [c, d.alias!] as [string, string])),
    decisi: new Set(decisioni.keys()),
  };
  const noti = ordinate.filter(([, d]) => d.va && !d.alias).map(([c]) => c);   // codici «giusti» a cui assomigliare

  const tutte = await db<{ id: number; stato: string; canonico: Canonico }[]>`
    SELECT id, stato, canonico FROM ferrari_file
    WHERE modello = ${scelto} AND stato NOT IN ('SOSTITUITO', 'QUARANTENA', 'RIFIUTATO') AND canonico IS NOT NULL
    ORDER BY caricato_at DESC, id DESC LIMIT 1000`;
  const nomi = new Map<string, string>();
  for (const s of tutte) for (const o of s.canonico.opzioni) if (!nomi.has(o.codice)) nomi.set(o.codice, o.descrizione);
  const cerca = q?.trim();
  const mostrate = (cerca ? tutte.filter(s => (s.canonico.header.commessa ?? '').includes(cerca)) : tutte).slice(0, 500);
  const commesse = mostrate.map(s => s.canonico.header.commessa ?? '').filter(Boolean);
  const dettagli = conRighe ? await caricaDettagli(commesse) : new Map() as DettagliPerCommessa;
  return {
    modelli, modello: scelto, termini,
    nuove: nuoveSigle(tutte, new Set(decisioni.keys()), noti),
    sigle: ordinate.map(([codice, d]) => ({ codice, nome: nomi.get(codice) ?? '(parola cercata)', va: d.va, ambito: d.ambito, sub: d.sub, alias: d.alias, nosigla: d.nosigla, padre: d.padre, auto: d.auto })),
    etichette: Object.fromEntries(termini.filter(t => nomi.has(t)).map(t => [t, nomi.get(t)!])),
    righe: conRighe ? costruisciMatrice(mostrate, termini, dettagli, subOk, ctx, subPadre) : [],
    proposte,
  };
}

/** La sigla (o parola) va in tabella oppure no, per il modello o per tutti i modelli. */
export async function decidiSigla(user: Utente, modello: string, codice: string, va: boolean, tutti: boolean, sub = false, alias: string | null = null,
  extra: { nosigla?: boolean; padre?: string | null; auto?: boolean } = {}) {
  const c = normalizzaSigla(codice);
  const al = alias ? normalizzaSigla(alias) : null;
  const m = tutti ? TUTTI : modello.trim().toUpperCase();
  if (!m || !c || c.length > 60) throw new HTTPException(400, { message: 'Indicare il modello e la sigla o parola (max 60 caratteri)' });
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    await tx`
      INSERT INTO ferrari_sigla (modello, codice, va, sub, alias, nosigla, padre, auto, creato_da)
      VALUES (${m}, ${c}, ${va && !extra.nosigla}, ${sub}, ${al}, ${extra.nosigla === true}, ${sub && extra.padre ? normalizzaSigla(extra.padre) : null}, ${extra.auto === true}, ${user.username})
      ON CONFLICT (modello, codice) DO UPDATE SET va = EXCLUDED.va, sub = EXCLUDED.sub, alias = EXCLUDED.alias, nosigla = EXCLUDED.nosigla,
                                                  padre = EXCLUDED.padre, auto = EXCLUDED.auto`;
    await tx`DELETE FROM ferrari_sigla_proposta WHERE modello = ${m} AND codice = ${c}`;   // decisa: la proposta e' superata
    await audit(tx, user, va ? 'sigla.va' : 'sigla.non_va', 'sigla', `${m}/${c}`, null);
  });
  return c;
}

/** Cancella la decisione: la sigla torna «da decidere». */
export async function togliDecisione(user: Utente, modello: string, codice: string, tutti: boolean) {
  const m = tutti ? TUTTI : modello.trim().toUpperCase();
  const c = normalizzaSigla(codice);
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const r = await tx`DELETE FROM ferrari_sigla WHERE modello = ${m} AND codice = ${c}`;
    if (r.count) await audit(tx, user, 'sigla.da_decidere', 'sigla', `${m}/${c}`, null);
    return r.count;
  });
}

/** Segna «non va» (per il modello) tutte le sigle ancora da decidere. */
export async function tutteNo(user: Utente, modello: string) {
  const m = await matrice(modello);
  if (!m.modello || m.nuove.length === 0) return 0;
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    for (const n of m.nuove) {
      await tx`INSERT INTO ferrari_sigla (modello, codice, va, sub, creato_da) VALUES (${m.modello}, ${n.codice}, FALSE, ${n.sub === true}, ${user.username})
               ON CONFLICT (modello, codice) DO NOTHING`;
    }
    await audit(tx, user, 'sigla.tutte_non_va', 'sigla', m.modello, { quante: m.nuove.length });
  });
  return m.nuove.length;
}

// ─── Sincronizzazione delle sigle con la PC IA ────────────────────────────────

/** Pacchetto firmato con tutte le decisioni sulle sigle: la PC IA le riceve come proposte. */
export async function esportaSigle(user: Utente) {
  const secret = await getSecret();
  const voci = await db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null }[]>`SELECT modello, codice, va, sub, alias FROM ferrari_sigla ORDER BY ordine`;
  const nomi = new Map<string, string>();
  const schede = await db<{ canonico: Canonico }[]>`SELECT canonico FROM ferrari_file WHERE canonico IS NOT NULL`;
  for (const s of schede) for (const o of s.canonico.opzioni) if (!nomi.has(o.codice)) nomi.set(o.codice, o.descrizione);
  const componenti = await esportaComponenti(db);
  const { zip, manifest } = buildSigle({
    secret, componenti, voci: voci.map(v => ({ modello: v.modello, codice: v.codice, va: v.va, sub: v.sub, alias: v.alias, nome: nomi.get(v.codice) ?? '(parola cercata)' })),
  });
  await db.begin(async raw => audit(raw as unknown as Tx, user, 'sigle.esportate', 'sigle', manifest.bundle_id, { voci: voci.length }));
  return { zip, filename: `FERRARI_sigle_vm_${manifest.bundle_id}.zip`, voci: voci.length };
}

/** Legge le decisioni della PC IA e le trasforma in PROPOSTE (le nuove e quelle in conflitto con le nostre). */
export async function importaSigle(user: Utente, filename: string, buf: Buffer) {
  const secret = await getSecret();
  let voci;
  let dettagli: VoceDettaglio[] = [];
  let componenti: VoceComponente[] = [];
  let da = 'ia';
  let pacchettoAt = new Date();
  try {
    const letto = leggiBundle(buf, secret, 'sigle');
    da = letto.manifest.producer;
    const dataPacchetto = new Date(letto.manifest.created_at);
    if (!Number.isNaN(dataPacchetto.getTime())) pacchettoAt = dataPacchetto;
    voci = leggiSigle(letto.files.get('sigle.json') ?? Buffer.alloc(0));
    dettagli = leggiDettagli(letto.files.get('sigle.json') ?? Buffer.alloc(0));
    componenti = leggiComponenti(letto.files.get('sigle.json') ?? Buffer.alloc(0));
  } catch (e) {
    if (e instanceof BundleError) return rifiutaBundle(user, filename, sha256(buf), e.message);
    throw e;
  }
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    // stesso ordine in ogni importazione: due importazioni insieme non si bloccano a vicenda
    await tx`SELECT pg_advisory_xact_lock(hashtext('ferrari:sigle'))`;
    let nuove = 0, conflitti = 0, uguali = 0;
    for (const v of [...voci].sort((x, y) => (x.modello + x.codice).localeCompare(y.modello + y.codice))) {
      const sub = v.sub === true;
      const alias = v.alias ?? null;
      const [locale] = await tx<{ va: boolean; sub: boolean; alias: string | null }[]>`SELECT va, sub, alias FROM ferrari_sigla WHERE modello = ${v.modello} AND codice = ${v.codice}`;
      if (locale && locale.va === v.va && locale.sub === sub && (locale.alias ?? null) === alias) {
        await tx`DELETE FROM ferrari_sigla_proposta WHERE modello = ${v.modello} AND codice = ${v.codice}`;
        uguali++;
        continue;
      }
      await tx`
        INSERT INTO ferrari_sigla_proposta (modello, codice, va, sub, alias, nome, conflitto, da) VALUES (${v.modello}, ${v.codice}, ${v.va}, ${sub}, ${alias}, ${v.nome}, ${!!locale}, ${da})
        ON CONFLICT (modello, codice) DO UPDATE SET va = EXCLUDED.va, sub = EXCLUDED.sub, alias = EXCLUDED.alias, nome = EXCLUDED.nome, conflitto = EXCLUDED.conflitto, da = EXCLUDED.da, creata_at = now()`;
      if (locale) conflitti++; else nuove++;
    }
    const comp = await importaComponenti(tx, componenti, da);
    let applicati = 0;
    for (const d of dettagli) {
      const r = await tx`
        INSERT INTO ferrari_dettaglio (commessa, codice, chiave, dettaglio, manuale, stato, da, pacchetto_at)
        VALUES (${d.commessa}, ${d.codice}, ${d.chiave}, ${d.dettaglio}, ${d.manuale}, ${d.stato}, ${da}, ${pacchettoAt})
        ON CONFLICT (commessa, chiave) DO UPDATE SET codice = EXCLUDED.codice, dettaglio = EXCLUDED.dettaglio,
          manuale = EXCLUDED.manuale, stato = EXCLUDED.stato, da = EXCLUDED.da, pacchetto_at = EXCLUDED.pacchetto_at, aggiornato_at = now()
        WHERE ferrari_dettaglio.pacchetto_at <= EXCLUDED.pacchetto_at`;
      applicati += r.count;
    }
    await audit(tx, user, 'sigle.importate', 'sigle', null, { filename, nuove, conflitti, uguali, dettagli: applicati, componenti: comp.nuove + comp.conflitti });
    return { nuove, conflitti, uguali, dettagli: applicati, componenti: comp.nuove + comp.conflitti };
  });
}

export async function proposteSigle() {
  return db<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null; nome: string | null; conflitto: boolean; da: string | null }[]>`
    SELECT modello, codice, va, sub, alias, nome, conflitto, da FROM ferrari_sigla_proposta ORDER BY creata_at, modello, codice`;
}

/** Accetta (diventa una decisione locale) o rifiuta una proposta; senza modello/codice tratta tutte. */
export async function risolviProposte(user: Utente, accetta: boolean, modello?: string, codice?: string) {
  return db.begin(async raw => {
    const tx = raw as unknown as Tx;
    const m = modello?.trim().toUpperCase();
    const c = codice?.trim().toUpperCase();
    const righe = await tx<{ modello: string; codice: string; va: boolean; sub: boolean; alias: string | null }[]>`
      SELECT modello, codice, va, sub, alias FROM ferrari_sigla_proposta WHERE TRUE
        ${m && c ? tx`AND modello = ${m} AND codice = ${c}` : tx``} FOR UPDATE`;
    for (const r of righe) {
      if (accetta) {
        await tx`
          INSERT INTO ferrari_sigla (modello, codice, va, sub, alias, creato_da) VALUES (${r.modello}, ${r.codice}, ${r.va}, ${r.sub}, ${r.alias}, ${user.username})
          ON CONFLICT (modello, codice) DO UPDATE SET va = EXCLUDED.va, sub = EXCLUDED.sub, alias = EXCLUDED.alias`;
      }
      await tx`DELETE FROM ferrari_sigla_proposta WHERE modello = ${r.modello} AND codice = ${r.codice}`;
      await audit(tx, user, accetta ? 'sigle.proposta_accettata' : 'sigle.proposta_rifiutata', 'sigla', `${r.modello}/${r.codice}`, { va: r.va });
    }
    return righe.length;
  });
}
