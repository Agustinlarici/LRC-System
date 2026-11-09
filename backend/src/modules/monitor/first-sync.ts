/**
 * Carica iniziale dello storico: legge da WebThron gli ultimi N giorni (default 90) e li scrive in
 * webthron_events_history, con tutti i campi (anche versione, operatore, colore, protocollo cesta).
 *
 * Un giorno alla volta, dal più recente al più vecchio (i dati di oggi servono prima), con una pausa
 * tra un giorno e l'altro. Ogni giorno è già letto a rebanadine corte e passa dalla guardia
 * (webthron-guard.ts): una query alla volta, limite di tempo sul server, interruttore di sicurezza.
 * Gira in background e si può fermare. Usa gli stessi dati della sync: fasi, modelli e componenti
 * configurati in Andon, Buffer e nelle liste iKnow.
 */

import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';
import { startRun, endRun, failRun } from '../../lib/sync-stats.js';
import { loadDayIntoHistory } from './pg-webthron-sync.js';
import { getWebthronGuardState } from './mysql-client.js';
import { retryWaitMs } from './webthron-guard.js';
import { pastDays } from './webthron-time.js';

export interface FirstSyncStatus {
  running:   boolean;
  cancelled: boolean;
  from:      string | null;   // giorno più vecchio
  to:        string | null;   // giorno più recente (ieri)
  total:     number;
  done:      number;
  current:   string;
  rows:      number;          // eventi letti finora
  errors:    string[];
}

const IDLE: FirstSyncStatus = {
  running: false, cancelled: false, from: null, to: null, total: 0, done: 0, current: '', rows: 0, errors: [],
};

let status: FirstSyncStatus = { ...IDLE };
let cancelRequested = false;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Tentativi per giorno prima di darlo per fallito. */
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

/** Avvia la carica in background. Lancia un errore se ce n'è già una in corso. */
export function startFirstSync({ days, pauseSec }: { days: number; pauseSec: number }): FirstSyncStatus {
  if (status.running) throw new Error('Carica iniziale già in corso');

  const list = pastDays(todayRome(), days);
  cancelRequested = false;
  status = {
    ...IDLE, running: true, total: list.length,
    from: list[list.length - 1] ?? null, to: list[0] ?? null,
  };
  startRun('first_sync');
  void run(list, pauseSec);
  return status;
}

async function run(list: string[], pauseSec: number): Promise<void> {
  try {
    for (const day of list) {
      if (cancelRequested) { status.cancelled = true; break; }
      // Se si spegne il toggle mentre gira, si ferma subito
      if (!(await isIKnowEnabled('iknow_backfill_enabled'))) {
        status.errors.push('Interrotta: il toggle «Backfill manuali» è stato disattivato');
        break;
      }

      status.current = day;
      // Un giorno che fallisce (query lenta, interruttore aperto) si riprova dopo aver lasciato
      // riposare WebThron: non si salta, altrimenti restano buchi nello storico.
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        if (cancelRequested) break;
        try {
          status.rows += await loadDayIntoHistory(day);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[FirstSync] ${day} (tentativo ${attempt}/${MAX_TRIES}): ${msg}`);
          if (attempt === MAX_TRIES) { status.errors.push(`${day}: ${msg}`); break; }
          const { open, openUntil } = getWebthronGuardState();
          await sleep(retryWaitMs(open, openUntil, Date.now()));
        }
      }
      status.done++;
      logger.info(`[FirstSync] ${day} (${status.done}/${status.total}) — ${status.rows} eventi finora`);

      if (status.done < status.total) await sleep(pauseSec * 1000);
    }
  } finally {
    status.running = false;
    status.current = '';
    if (status.errors.length > 0 && status.errors.length >= status.done && status.done > 0) {
      failRun('first_sync', new Error(status.errors[status.errors.length - 1]));
    } else {
      endRun('first_sync', status.rows);
    }
    logger.info(`[FirstSync] Terminata — ${status.done}/${status.total} giorni, ${status.rows} eventi, ${status.errors.length} errori`);
  }
}
