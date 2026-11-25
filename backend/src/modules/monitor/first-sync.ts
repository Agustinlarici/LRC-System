/**
 * Carica dello storico: legge da WebThron gli ultimi N giorni (default 180) e li scrive in
 * webthron_events_history, con tutti i campi (anche versione, operatore, colore, protocollo cesta).
 *
 * Una settimana alla volta, dalla più recente alla più vecchia (i dati recenti servono prima), con
 * una pausa tra una settimana e l'altra. Ogni settimana è letta a rebanadine corte di 4 ore e passa
 * dalla guardia (webthron-guard.ts): una query alla volta, limite di tempo sul server, interruttore
 * di sicurezza. Raggruppare per settimana non cambia le query a WebThron: cambia solo i blocchi di scrittura
 * e le pause.
 * Gira in background e si può fermare. Usa gli stessi dati della sync: fasi, modelli e componenti
 * configurati in Andon, Buffer e nelle liste iKnow.
 */

import { logger } from '../../lib/logger.js';
import { isIKnowEnabled, type IKnowQueryFlag } from '../../lib/system-flags.js';
import { startRun, endRun, failRun } from '../../lib/sync-stats.js';
import { loadRangeIntoHistory, sostituisciModificateDal } from './pg-webthron-sync.js';
import { getWebthronGuardState } from './mysql-client.js';
import { retryWaitMs } from './webthron-guard.js';
import { daysToReread, weeksOf } from './webthron-time.js';

export interface FirstSyncStatus {
  running:   boolean;
  cancelled: boolean;
  from:      string | null;   // giorno più vecchio
  to:        string | null;   // giorno più recente (ieri)
  total:     number;          // settimane da leggere
  done:      number;          // settimane finite
  current:   string;          // settimana in corso (da → a)
  rows:      number;          // eventi letti finora
  errors:    string[];
}

const IDLE: FirstSyncStatus = {
  running: false, cancelled: false, from: null, to: null, total: 0, done: 0, current: '', rows: 0, errors: [],
};

let status: FirstSyncStatus = { ...IDLE };
let cancelRequested = false;
let currentRun: Promise<void> | null = null;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Tentativi per settimana prima di darla per fallita. */
const MAX_TRIES = 3;

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

export function getFirstSyncStatus(): FirstSyncStatus {
  return status;
}

/** Chiede di fermarsi dopo il giorno in corso. Ritorna false se non c'è nulla in corso. */
export function cancelFirstSync(): boolean {
  if (!status.running) return false;
  cancelRequested = true;
  return true;
}

/** Si risolve quando la carica in corso finisce (subito se non ce n'è). Non lancia mai errori. */
export async function waitForFirstSync(): Promise<void> {
  await currentRun;
}

/**
 * Avvia la carica in background. Lancia un errore se ce n'è già una in corso.
 * Legge `days` giorni che finiscono oggi (oggi parziale compreso), a settimane.
 * `flag` è il toggle che deve restare acceso mentre gira: «Backfill manuali» per pulsante e modi
 * full/mista, «Rilettura notturna» per le letture programmate delle 01:00.
 */
export function startFirstSync(
  { days, pauseSec, flag = 'iknow_backfill_enabled' }: { days: number; pauseSec: number; flag?: IKnowQueryFlag },
): FirstSyncStatus {
  if (status.running) throw new Error('Carica iniziale già in corso');

  const list = weeksOf(daysToReread(todayRome(), days, true));
  cancelRequested = false;
  status = {
    ...IDLE, running: true, total: list.length,
    from: list[list.length - 1]?.from ?? null, to: list[0]?.to ?? null,
  };
  startRun('first_sync');
  currentRun = run(list, pauseSec, flag);
  return status;
}

async function run(list: Array<{ from: string; to: string }>, pauseSec: number, flag: IKnowQueryFlag): Promise<void> {
  try {
    for (const week of list) {
      if (cancelRequested) { status.cancelled = true; break; }
      // Se si spegne il toggle mentre gira, si ferma subito
      if (!(await isIKnowEnabled(flag))) {
        status.errors.push('Interrotta: il toggle di iKnow necessario è stato disattivato');
        break;
      }

      const label = `${week.from} → ${week.to}`;
      status.current = label;
      // Una settimana che fallisce (query lenta, interruttore aperto) si riprova dopo aver lasciato
      // riposare WebThron: non si salta, altrimenti restano buchi nello storico. L'upsert è idempotente.
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        if (cancelRequested) break;
        try {
          status.rows += await loadRangeIntoHistory(week.from, week.to);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[FirstSync] ${label} (tentativo ${attempt}/${MAX_TRIES}): ${msg}`);
          if (attempt === MAX_TRIES) { status.errors.push(`${label}: ${msg}`); break; }
          const { open, openUntil } = getWebthronGuardState();
          await sleep(retryWaitMs(open, openUntil, Date.now()));
        }
      }
      status.done++;
      logger.info(`[FirstSync] ${label} (${status.done}/${status.total} settimane) — ${status.rows} eventi finora`);

      if (status.done < status.total) await sleep(pauseSec * 1000);
    }

    // Ultima passata: le schede già lette ma modificate dopo (lastup) sostituiscono la loro riga
    const dal = list[list.length - 1]?.from;
    if (dal && !cancelRequested && !status.cancelled && (await isIKnowEnabled(flag))) {
      status.current = 'schede modificate (lastup)';
      try {
        await sleep(pauseSec * 1000);
        await sostituisciModificateDal(dal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[FirstSync] Passata lastup: ${msg}`);
        status.errors.push(`lastup: ${msg}`);
      }
    }
  } finally {
    status.running = false;
    status.current = '';
    if (status.errors.length > 0 && status.errors.length >= status.done && status.done > 0) {
      failRun('first_sync', new Error(status.errors[status.errors.length - 1]));
    } else {
      endRun('first_sync', status.rows);
    }
    logger.info(`[FirstSync] Terminata — ${status.done}/${status.total} settimane, ${status.rows} eventi, ${status.errors.length} errori`);
  }
}
