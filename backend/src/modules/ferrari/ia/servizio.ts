// Orchestratore del collegamento con la PC IA: coda dei lavori, invio, avanzamento, risultato, tentativi e corto circuito.
// Principi: la scheda e' usabile senza la IA (la IA arricchisce dopo); ogni passaggio e' registrato; nessun lavoro si perde
// (lo stato sta nel database); un solo giro alla volta; con l'interruttore spento non fa niente.

import { HTTPException } from 'hono/http-exception';
import { db } from '../../../db/client.js';
import { logger } from '../../../lib/logger.js';
import { audit, getSecret, type Utente } from '../service.js';
import { chiaveTesto, testoLibero } from '../matrice.js';
import type { Canonico } from '../types.js';
import { prossimoTentativo } from './backoff.js';
import { ClienteIa, ErroreContratto, ErroreIa, ErroreRete } from './client.js';
import { confrontaPerCodice, type Discrepanza } from './confronto.js';
import { leggiConfigIa, type ConfigIa } from './config.js';
import type { Avvio, MetaAnalisi, Risultato, Salute, SnapshotSigle, StatoAnalisi } from './contratto.js';
import { assertPassaggio, STATI_ATTIVI, tappe, type PassoUtente, type StatoJob, type Tappa } from './macchina.js';
import { leggiSnapshotDaDb } from './snapshot.js';

type Tx = typeof db;

export const SOGLIA_FALLITI = 3;               // errori di rete di fila prima di fermare gli invii
export const INTERVALLO_PROVA_MS = 60_000;     // con la PC IA «non raggiungibile» si controlla /salute ogni minuto
export const MAX_IN_VOLO = 3;                  // lavori mandati alla PC IA e non ancora finiti

export interface ClienteIaLike {
  salute(): Promise<Salute>;
  inviaSigle(s: SnapshotSigle): Promise<string>;
  avviaAnalisi(file: Buffer, nomeFile: string, meta: MetaAnalisi): Promise<Avvio>;
  stato(id: string): Promise<StatoAnalisi>;
  annulla(id: string): Promise<void>;
}

export interface Dipendenze {
  creaCliente: (cfg: ConfigIa, secret: string) => ClienteIaLike;
  adesso: () => Date;
  rand: () => number;
  leggiSnapshot: () => Promise<SnapshotSigle>;
}

export const dipendenzeReali = (): Dipendenze => ({
  creaCliente: (cfg, secret) => new ClienteIa({ url: cfg.url, secret, timeoutMs: cfg.timeoutS * 1000 }),
  adesso: () => new Date(),
  rand: Math.random,
  leggiSnapshot: leggiSnapshotDaDb,
});

interface Job {
  id: string; file_id: number; sha256: string; richiesta_id: string; id_remoto: string | null; stato: StatoJob; passo: PassoUtente;
  avanzamento: { fatti?: number; totale?: number; etichetta?: string }; tentativi: number; prossimo_tentativo_at: Date | null;
  errore: string | null; versione_sigle: string | null;
}

export type StatoConnessione = 'sconosciuta' | 'ok' | 'non_raggiungibile';
export interface Connessione { stato: StatoConnessione; falliti: number; ultimoControllo: Date | null; errore: string | null; salute: Salute | null; prossimaProva: Date | null }
export interface RiepilogoTick { saltato?: 'occupato' | 'spenta' | 'non_raggiungibile'; inviati: number; seguiti: number; completati: number; falliti: number }

const COLONNE_JOB = db`id::text AS id, file_id, sha256, richiesta_id, id_remoto, stato, passo, avanzamento, tentativi, prossimo_tentativo_at, errore, versione_sigle`;

/** Codici di errore dell'analisi remota che non cambiano riprovando (il file non e' una scheda). */
const ERRORI_REMOTI_DEFINITIVI = new Set(['non_e_una_scheda']);

export class ServizioIa {
  private inTick = false;
  private clienteCache: { chiave: string; cliente: ClienteIaLike } | null = null;
  private sigleInviate: string | null = null;
  readonly connessione: Connessione = { stato: 'sconosciuta', falliti: 0, ultimoControllo: null, errore: null, salute: null, prossimaProva: null };

  constructor(private readonly d: Dipendenze = dipendenzeReali()) {}

  // ─── Accodare ─────────────────────────────────────────────────────────────

  /** Mette in coda l'analisi IA di una scheda (se l'interruttore e' acceso). Una sola attiva per scheda. Ritorna l'id o null. */
  async accodaFile(user: Utente, fileId: number): Promise<string | null> {
    const cfg = await leggiConfigIa();
    if (!cfg.attiva) return null;
    return this.inserisci(user, fileId);
  }

  private async inserisci(user: Utente, fileId: number): Promise<string | null> {
    const [f] = await db<{ sha256: string; stato: string; canonico: Canonico | null }[]>`SELECT sha256, stato, canonico FROM ferrari_file WHERE id = ${fileId}`;
    if (!f || !f.canonico || ['QUARANTENA', 'SOSTITUITO', 'RIFIUTATO'].includes(f.stato)) return null;
    return db.begin(async raw => {
      const tx = raw as unknown as Tx;
      const [j] = await tx<{ id: string }[]>`
        INSERT INTO ferrari_ia_job (file_id, sha256, creato_da) VALUES (${fileId}, ${f.sha256}, ${user.username})
        ON CONFLICT (file_id) WHERE stato IN ('in_coda', 'inviato', 'in_analisi', 'confronto', 'attesa_ia') DO NOTHING
        RETURNING id::text AS id`;
      if (!j) return null;                                           // gia' c'e' un lavoro attivo per questa scheda
      await this.passo(tx, j.id, 'ricevuta', 'ok');
      await this.passo(tx, j.id, 'letta', 'ok');
      await this.passo(tx, j.id, 'inviata', 'in_corso', 'In coda');
      await audit(tx, user, 'ia.accodata', 'file', fileId, { job: j.id });
      return j.id;
    });
  }

  /** Schede senza nessuna analisi IA riuscita: serve quando si accende l'interruttore su schede gia' caricate. Ritorna quante. */
  async accodaMancanti(user: Utente): Promise<number> {
    const cfg = await leggiConfigIa();
    if (!cfg.attiva) throw new HTTPException(409, { message: 'La IA e\' spenta' });
    const ids = await db<{ id: number }[]>`
      SELECT f.id FROM ferrari_file f
      WHERE f.canonico IS NOT NULL AND f.stato NOT IN ('QUARANTENA', 'SOSTITUITO', 'RIFIUTATO')
        AND NOT EXISTS (SELECT 1 FROM ferrari_ia_job j WHERE j.file_id = f.id AND j.stato = 'fatto')
      ORDER BY f.id LIMIT 500`;
    let n = 0;
    for (const { id } of ids) if (await this.inserisci(user, id)) n++;
    return n;
  }

  // ─── Il giro ──────────────────────────────────────────────────────────────

  /** Un giro: riprende i lavori scaduti, manda quelli in coda e segue quelli in volo. Mai due giri insieme. */
  async tick(): Promise<RiepilogoTick> {
    const r: RiepilogoTick = { inviati: 0, seguiti: 0, completati: 0, falliti: 0 };
    if (this.inTick) return { ...r, saltato: 'occupato' };
    this.inTick = true;
    try {
      const cfg = await leggiConfigIa();
      if (!cfg.attiva || !cfg.url) return { ...r, saltato: 'spenta' };
      const cliente = await this.cliente(cfg);
      if (!(await this.connessioneUtilizzabile(cliente))) return { ...r, saltato: 'non_raggiungibile' };

      await this.riprendiScaduti();
      const inVolo = await db<Job[]>`SELECT ${COLONNE_JOB} FROM ferrari_ia_job WHERE stato IN ('inviato', 'in_analisi', 'confronto') ORDER BY id`;
      const posti = Math.max(0, MAX_IN_VOLO - inVolo.length);
      const inCoda = posti ? await db<Job[]>`SELECT ${COLONNE_JOB} FROM ferrari_ia_job WHERE stato = 'in_coda' ORDER BY id LIMIT ${posti}` : [];

      for (const job of [...inVolo, ...inCoda]) {
        if (this.connessione.stato === 'non_raggiungibile') break;     // si e' fermata a meta' giro: il resto aspetta
        try {
          if (job.stato === 'in_coda') { await this.invia(cliente, job); r.inviati++; }
          else if ((await this.segui(cliente, job)) === 'completato') r.completati++; else r.seguiti++;
          this.reteOk();
        } catch (e) {
          r.falliti++;
          await this.fallimento(cfg, job, e);
        }
      }
      return r;
    } finally {
      this.inTick = false;
    }
  }

  private async cliente(cfg: ConfigIa): Promise<ClienteIaLike> {
    const secret = await getSecret();
    const chiave = `${cfg.url}|${cfg.timeoutS}|${secret}`;
    if (this.clienteCache?.chiave !== chiave) {
      this.clienteCache = { chiave, cliente: this.d.creaCliente(cfg, secret) };
      this.sigleInviate = null;                                        // altro indirizzo o segreto: le sigle vanno rimandate
    }
    return this.clienteCache.cliente;
  }

  // ─── Connessione e corto circuito ─────────────────────────────────────────

  private async connessioneUtilizzabile(cliente: ClienteIaLike): Promise<boolean> {
    const c = this.connessione;
    if (c.stato !== 'non_raggiungibile') return true;
    if (c.prossimaProva && this.d.adesso() < c.prossimaProva) return false;
    try {
      this.reteOk(await cliente.salute());
      logger.info('[ferrari-ia] la PC IA e\' di nuovo raggiungibile');
      return true;
    } catch (e) {
      c.ultimoControllo = this.d.adesso();
      c.errore = (e as Error).message;
      c.prossimaProva = new Date(this.d.adesso().getTime() + INTERVALLO_PROVA_MS);
      return false;
    }
  }

  private reteOk(salute?: Salute) {
    const c = this.connessione;
    c.stato = 'ok'; c.falliti = 0; c.errore = null; c.prossimaProva = null; c.ultimoControllo = this.d.adesso();
    if (salute) c.salute = salute;
  }

  private reteKo(e: Error) {
    const c = this.connessione;
    c.falliti++; c.errore = e.message; c.ultimoControllo = this.d.adesso();
    if (c.falliti >= SOGLIA_FALLITI && c.stato !== 'non_raggiungibile') {
      c.stato = 'non_raggiungibile';
      c.prossimaProva = new Date(this.d.adesso().getTime() + INTERVALLO_PROVA_MS);
      logger.warn(`[ferrari-ia] PC IA non raggiungibile dopo ${c.falliti} errori di fila: invii fermi, riprovo ogni minuto (${e.message})`);
    }
  }

  /** Prova subito la connessione (per il pulsante «Prova» e la salute mostrata in Impostazioni). */
  async prova(): Promise<{ ok: true; salute: Salute } | { ok: false; errore: string }> {
    const cfg = await leggiConfigIa();
    if (!cfg.url) return { ok: false, errore: 'Scrivi prima l\'indirizzo della PC IA' };
    try {
      const salute = await (await this.cliente(cfg)).salute();
      this.reteOk(salute);
      return { ok: true, salute };
    } catch (e) {
      this.connessione.ultimoControllo = this.d.adesso();
      this.connessione.errore = (e as Error).message;
      return { ok: false, errore: (e as Error).message };
    }
  }

  // ─── Passi del lavoro ─────────────────────────────────────────────────────

  private async riprendiScaduti() {
    await db`
      UPDATE ferrari_ia_job SET stato = 'in_coda', aggiornato_at = now()
      WHERE stato = 'attesa_ia' AND prossimo_tentativo_at <= ${this.d.adesso()}`;
  }

  private async passo(tx: Tx, jobId: string, passo: string, stato: 'in_corso' | 'ok' | 'attenzione' | 'errore' | 'saltato', dettaglio?: string) {
    await tx`INSERT INTO ferrari_ia_passo (job_id, passo, stato, dettaglio) VALUES (${jobId}, ${passo}, ${stato}, ${dettaglio ?? null})`;
  }

  /** Cambia stato solo se il lavoro e' ancora in quello atteso (nessuno lo ha toccato nel frattempo). */
  private async muovi(tx: Tx, job: Pick<Job, 'id' | 'stato'>, a: StatoJob, campi: { passo?: PassoUtente; errore?: string | null; tentativi?: number; prossimo?: Date | null; idRemoto?: string | null } = {}): Promise<void> {
    assertPassaggio(job.stato, a);
    const r = await tx`
      UPDATE ferrari_ia_job SET stato = ${a}, aggiornato_at = now(),
        passo = COALESCE(${campi.passo ?? null}, passo),
        errore = ${campi.errore === undefined ? db`errore` : campi.errore},
        tentativi = COALESCE(${campi.tentativi ?? null}, tentativi),
        prossimo_tentativo_at = ${campi.prossimo === undefined ? db`prossimo_tentativo_at` : campi.prossimo},
        id_remoto = ${campi.idRemoto === undefined ? db`id_remoto` : campi.idRemoto},
        finito_at = CASE WHEN ${a}::text IN ('fatto', 'errore', 'annullato') THEN now() ELSE finito_at END
      WHERE id = ${job.id} AND stato = ${job.stato}`;
    if (r.count === 0) throw new Error(`Il lavoro ${job.id} non e' piu' in stato ${job.stato}`);
    job.stato = a;
  }

  private async snapshotSincronizzato(cliente: ClienteIaLike, forza = false): Promise<SnapshotSigle> {
    const snap = await this.d.leggiSnapshot();
    if (forza || this.sigleInviate !== snap.versione_sigle) {
      await cliente.inviaSigle(snap);
      this.sigleInviate = snap.versione_sigle;
    }
    return snap;
  }

  private async invia(cliente: ClienteIaLike, job: Job): Promise<void> {
    const [f] = await db<{ filename: string; original: Buffer; commessa: string | null; modello: string | null }[]>`
      SELECT filename, original, commessa, modello FROM ferrari_file WHERE id = ${job.file_id}`;
    if (!f) throw new ErroreContratto('Scheda non trovata');
    let snap = await this.snapshotSincronizzato(cliente);
    const meta = (versione: string): MetaAnalisi => ({ sha256: job.sha256, richiesta_id: job.richiesta_id, versione_sigle: versione, commessa: f.commessa, modello: f.modello });
    let avvio: Avvio;
    try {
      avvio = await cliente.avviaAnalisi(f.original, f.filename, meta(snap.versione_sigle));
    } catch (e) {
      if (!(e instanceof ErroreIa) || e.codice !== 'sigle_obsolete') throw e;
      snap = await this.snapshotSincronizzato(cliente, true);          // la PC IA non conosce le sigle (riavviata?): si rimandano, senza contare un tentativo
      avvio = await cliente.avviaAnalisi(f.original, f.filename, meta(snap.versione_sigle));
    }
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      await this.muovi(tx, job, 'inviato', { passo: 'analisi', idRemoto: avvio.id, errore: null, prossimo: null });
      await tx`UPDATE ferrari_ia_job SET inviato_at = now(), versione_sigle = ${snap.versione_sigle} WHERE id = ${job.id}`;
      await this.passo(tx, job.id, 'inviata', 'ok');
    });
  }

  private async segui(cliente: ClienteIaLike, job: Job): Promise<'in_corso' | 'completato'> {
    if (!job.id_remoto) { await this.rimettiInCoda(job, 'Manca il riferimento remoto: reinvio'); return 'in_corso'; }
    let s: StatoAnalisi;
    try {
      s = await cliente.stato(job.id_remoto);
    } catch (e) {
      if (e instanceof ErroreIa && e.http === 404) { await this.rimettiInCoda(job, 'La PC IA non ricorda il lavoro (riavviata?): reinvio'); return 'in_corso'; }
      throw e;
    }
    if (s.stato === 'errore') throw new ErroreIa(s.errore?.messaggio ?? 'La IA non e\' riuscita ad analizzare la scheda', 503, s.errore?.codice ?? 'analisi_fallita');
    if (s.stato === 'fatto') {
      if (!s.risultato) throw new ErroreContratto('La PC IA dice «fatto» ma non manda il risultato');
      await this.completa(job, s.risultato);
      return 'completato';
    }
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      if (job.stato === 'inviato') { await this.muovi(tx, job, 'in_analisi', { passo: 'analisi' }); await this.passo(tx, job.id, 'analisi', 'in_corso'); }
      await tx`UPDATE ferrari_ia_job SET avanzamento = ${tx.json((s.avanzamento ?? {}) as never)}, aggiornato_at = now() WHERE id = ${job.id}`;
    });
    return 'in_corso';
  }

  private async rimettiInCoda(job: Job, motivo: string) {
    // il lavoro remoto non c'e' piu': si torna a «in coda» senza contare un tentativo (non e' colpa della IA)
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      await tx`UPDATE ferrari_ia_job SET stato = 'in_coda', id_remoto = NULL, passo = 'inviata', aggiornato_at = now() WHERE id = ${job.id} AND stato = ${job.stato}`;
      await this.passo(tx, job.id, 'inviata', 'attenzione', motivo);
    });
    logger.info(`[ferrari-ia] job ${job.id}: ${motivo}`);
  }

  /** Il risultato e' arrivato: confronto per codice, riassunti nella tabella, tutto in una transazione. */
  private async completa(job: Job, ris: Risultato): Promise<void> {
    if (job.stato !== 'confronto') await db.begin(async raw => { await this.muovi(raw as unknown as Tx, job, 'confronto', { passo: 'confronto' }); });
    const [f] = await db<{ canonico: Canonico; commessa: string | null }[]>`SELECT canonico, commessa FROM ferrari_file WHERE id = ${job.file_id}`;
    if (!f) throw new ErroreContratto('Scheda non trovata');
    const snap = await this.d.leggiSnapshot();
    const interesse = new Set([...snap.colonne, ...snap.sotto_sigle.map(s => s.codice)]);
    const conf = confrontaPerCodice(f.canonico.opzioni, ris.lettura, interesse);
    // solo i riassunti di testi che la scheda ha davvero (la chiave e' l'hash del testo): il resto si ignora
    const chiaviValide = new Set(f.canonico.opzioni.filter(o => o.blocchi_testo.length > 0).map(o => chiaveTesto(testoLibero(o))));
    const dettagli = f.commessa ? ris.dettagli.filter(d => chiaviValide.has(d.chiave)) : [];
    const adesso = this.d.adesso();

    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      for (const d of dettagli) {
        // una risposta scritta da una persona (o gia' rivista) non si sovrascrive mai
        await tx`
          INSERT INTO ferrari_dettaglio (commessa, codice, chiave, dettaglio, manuale, stato, da, pacchetto_at)
          VALUES (${f.commessa!}, ${d.codice}, ${d.chiave}, ${d.dettaglio}, FALSE, ${d.stato}, 'ia', ${adesso})
          ON CONFLICT (commessa, chiave) DO UPDATE SET codice = EXCLUDED.codice, dettaglio = EXCLUDED.dettaglio, stato = EXCLUDED.stato, da = EXCLUDED.da,
            pacchetto_at = EXCLUDED.pacchetto_at, aggiornato_at = now()
          WHERE NOT ferrari_dettaglio.manuale AND ferrari_dettaglio.stato <> 'rivisto'`;
      }
      await tx`
        INSERT INTO ferrari_ia_risultato (job_id, lettura, avvisi, metriche, esito, discrepanze)
        VALUES (${job.id}, ${tx.json(ris.lettura as never)}, ${tx.json(ris.avvisi as never)}, ${tx.json(ris.metriche as never)}, ${conf.esito}, ${tx.json(conf.discrepanze as never)})
        ON CONFLICT (job_id) DO UPDATE SET lettura = EXCLUDED.lettura, avvisi = EXCLUDED.avvisi, metriche = EXCLUDED.metriche, esito = EXCLUDED.esito,
          discrepanze = EXCLUDED.discrepanze, creato_at = now()`;
      await this.muovi(tx, job, 'fatto', { passo: 'pronta', errore: null });
      await tx`UPDATE ferrari_ia_job SET avanzamento = '{}'::jsonb WHERE id = ${job.id}`;
      await this.passo(tx, job.id, 'analisi', 'ok', `${ris.lettura.length} righe lette, ${dettagli.length} riassunti`);
      const sig = conf.discrepanze.filter(x => x.peso === 'sigla').length;
      await this.passo(tx, job.id, 'confronto', sig ? 'attenzione' : 'ok', sig ? `${sig} discrepanze` : 'Uguale');
      await this.passo(tx, job.id, 'pronta', 'ok');
      await audit(tx, { id: 0, username: 'ia' }, 'ia.completata', 'file', job.file_id, { job: job.id, esito: conf.esito, discrepanze: conf.discrepanze.length });
    });
  }

  // ─── Errori e tentativi ───────────────────────────────────────────────────

  private async fallimento(cfg: ConfigIa, job: Job, e: unknown): Promise<void> {
    const messaggio = e instanceof Error ? e.message : String(e);
    const rete = e instanceof ErroreRete;
    if (rete) this.reteKo(e);
    // un errore «definitivo» non si ripete da solo: segreto sbagliato, file rifiutato, risposta fuori contratto
    const definitivo = e instanceof ErroreContratto || (e instanceof ErroreIa && (!e.ritentabile || ERRORI_REMOTI_DEFINITIVI.has(e.codice)));
    const passo: PassoUtente = job.stato === 'in_coda' ? 'inviata' : job.stato === 'confronto' ? 'confronto' : 'analisi';
    const tentativi = job.tentativi + 1;
    const finito = definitivo || tentativi >= cfg.maxTentativi;
    logger.warn(`[ferrari-ia] job ${job.id} (${passo}): ${messaggio}${finito ? ' — niente piu\' tentativi' : ''}`);
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      if (finito) {
        await this.muovi(tx, job, 'errore', { passo, errore: messaggio, tentativi, prossimo: null });
        await this.passo(tx, job.id, passo, 'errore', messaggio);
      } else {
        await this.muovi(tx, job, 'attesa_ia', { passo, errore: messaggio, tentativi, prossimo: prossimoTentativo(this.d.adesso(), tentativi, this.d.rand) });
        await this.passo(tx, job.id, passo, 'attenzione', `${messaggio} (tentativo ${tentativi}/${cfg.maxTentativi})`);
      }
    }).catch(err => logger.error(`[ferrari-ia] job ${job.id}: non riesco a registrare l'errore: ${(err as Error).message}`));
  }

  // ─── Azioni dell'utente ───────────────────────────────────────────────────

  /** «Riprova»: da errore (o attesa) torna in coda con i tentativi azzerati. */
  async riprova(user: Utente, jobId: string): Promise<void> {
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      const [j] = await tx<Pick<Job, 'id' | 'stato'>[]>`SELECT id::text AS id, stato FROM ferrari_ia_job WHERE id = ${jobId} FOR UPDATE`;
      if (!j) throw new HTTPException(404, { message: 'Lavoro non trovato' });
      if (j.stato !== 'errore' && j.stato !== 'attesa_ia') throw new HTTPException(409, { message: 'Si puo\' riprovare solo un lavoro in errore o in attesa' });
      await this.muovi(tx, j, 'in_coda', { passo: 'inviata', errore: null, tentativi: 0, prossimo: null, idRemoto: null });
      await tx`UPDATE ferrari_ia_job SET tentativi = 0, finito_at = NULL WHERE id = ${jobId}`;
      await this.passo(tx, jobId, 'inviata', 'in_corso', 'Riprovo su richiesta');
      await audit(tx, user, 'ia.riprova', 'job', jobId, null);
    });
  }

  async annulla(user: Utente, jobId: string): Promise<void> {
    const [j] = await db<Job[]>`SELECT ${COLONNE_JOB} FROM ferrari_ia_job WHERE id = ${jobId}`;
    if (!j) throw new HTTPException(404, { message: 'Lavoro non trovato' });
    if (!STATI_ATTIVI.includes(j.stato) || j.stato === 'confronto') throw new HTTPException(409, { message: 'Questo lavoro non si puo\' piu\' annullare' });
    if (j.id_remoto) {                                                // meglio dire anche alla PC IA di fermarsi (se non riesce, pazienza)
      try { await (await this.cliente(await leggiConfigIa())).annulla(j.id_remoto); } catch (e) { logger.info(`[ferrari-ia] annullo remoto non riuscito: ${(e as Error).message}`); }
    }
    await db.begin(async raw => {
      const tx = raw as unknown as Tx;
      await this.muovi(tx, j, 'annullato', { errore: null, prossimo: null });
      await this.passo(tx, j.id, 'pronta', 'saltato', 'Annullato');
      await audit(tx, user, 'ia.annullata', 'job', j.id, null);
    });
  }

  // ─── Per la pagina ────────────────────────────────────────────────────────

  async contatori(): Promise<Record<string, number>> {
    const rows = await db<{ stato: string; n: number }[]>`SELECT stato, count(*)::int AS n FROM ferrari_ia_job GROUP BY stato`;
    return Object.fromEntries(rows.map(r => [r.stato, r.n]));
  }

  /** Una riga per scheda (le ultime), con l'ultimo lavoro IA e le tappe da mostrare. Le schede senza lavoro (IA spenta) hanno le tappe IA «saltate». */
  async elenco(limite = 50) {
    const righe = await db<{
      file_id: number; filename: string; commessa: string | null; modello: string | null; caricato_at: Date;
      job_id: string | null; stato: StatoJob | null; passo: PassoUtente | null; avanzamento: Job['avanzamento'] | null; tentativi: number | null;
      prossimo_tentativo_at: Date | null; errore: string | null; esito: 'uguale' | 'discrepanze' | null;
    }[]>`
      SELECT f.id AS file_id, f.filename, f.commessa, f.modello, f.caricato_at,
             j.id::text AS job_id, j.stato, j.passo, j.avanzamento, j.tentativi, j.prossimo_tentativo_at, j.errore, r.esito
      FROM ferrari_file f
      LEFT JOIN LATERAL (SELECT * FROM ferrari_ia_job WHERE file_id = f.id ORDER BY id DESC LIMIT 1) j ON TRUE
      LEFT JOIN ferrari_ia_risultato r ON r.job_id = j.id
      WHERE f.canonico IS NOT NULL AND f.stato NOT IN ('QUARANTENA', 'SOSTITUITO', 'RIFIUTATO')
      ORDER BY f.id DESC LIMIT ${limite}`;
    return righe.map(r => ({
      file_id: r.file_id, filename: r.filename, commessa: r.commessa, modello: r.modello, caricato_at: r.caricato_at,
      job_id: r.job_id, stato: r.stato, tentativi: r.tentativi, errore: r.errore, esito: r.esito,
      prossimo_tentativo_at: r.prossimo_tentativo_at,
      tappe: tappe(r.stato && r.passo ? {
        stato: r.stato, passo: r.passo, avanzamento: r.avanzamento && r.avanzamento.totale !== undefined ? { fatti: r.avanzamento.fatti ?? 0, totale: r.avanzamento.totale, etichetta: r.avanzamento.etichetta ?? '' } : null,
        errore: r.errore, esito: r.esito,
        prossimoTentativo: r.prossimo_tentativo_at ? `alle ${r.prossimo_tentativo_at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}` : null,
      } : null) as Tappa[],
    }));
  }

  async dettaglioJob(jobId: string) {
    const [j] = await db<Job[]>`SELECT ${COLONNE_JOB} FROM ferrari_ia_job WHERE id = ${jobId}`;
    if (!j) throw new HTTPException(404, { message: 'Lavoro non trovato' });
    const passi = await db`SELECT passo, stato, dettaglio, at FROM ferrari_ia_passo WHERE job_id = ${jobId} ORDER BY id`;
    const [r] = await db<{ esito: string; discrepanze: Discrepanza[]; avvisi: unknown; metriche: unknown }[]>`SELECT esito, discrepanze, avvisi, metriche FROM ferrari_ia_risultato WHERE job_id = ${jobId}`;
    return { job: j, passi, risultato: r ?? null };
  }
}

let istanza: ServizioIa | null = null;
export const servizioIa = (): ServizioIa => (istanza ??= new ServizioIa());
