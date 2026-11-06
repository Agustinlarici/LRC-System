import { HTTPException } from 'hono/http-exception';

/**
 * Guardia per le query verso WebThron (MariaDB, tabelle MyISAM: ogni SELECT prende un lock
 * di tabella e una query lenta fa aspettare le scritture di iKnow).
 *
 *  - una query alla volta, con una pausa minima tra l'una e l'altra
 *  - coda limitata: oltre il limite si rifiuta subito invece di accumulare richieste
 *  - interruttore di sicurezza: dopo N query lente/scadute di fila WebThron resta a riposo
 *    per un po' (le richieste vengono rifiutate senza toccare la rete)
 */

export class WebthronBusyError extends HTTPException {
  constructor(message: string) {
    super(503, { message });
  }
}

export interface GuardOptions {
  /** Pausa minima tra la fine di una query e l'inizio della successiva. */
  minGapMs:     number;
  /** Oltre questa durata la query conta come "lenta". */
  slowMs:       number;
  /** Query lente/scadute consecutive che fanno scattare l'interruttore. */
  strikesToOpen: number;
  /** Per quanto tempo l'interruttore resta aperto. */
  cooldownMs:   number;
  /** Richieste in attesa oltre le quali si rifiuta. */
  maxQueue:     number;
  now?:   () => number;
  sleep?: (ms: number) => Promise<void>;
  onOpen?:  (cooldownMs: number, reason: string) => void;
  onClose?: () => void;
}

export interface GuardState {
  open:       boolean;
  openUntil:  number | null;
  strikes:    number;
  pending:    number;
}

/** Errore di timeout lato server (max_statement_time di MariaDB) o lato client (mysql2). */
export function isTimeoutError(err: unknown): boolean {
  const e = err as { errno?: number; code?: string } | null;
  if (!e) return false;
  return e.errno === 1969 || e.code === 'ER_STATEMENT_TIMEOUT' || e.code === 'PROTOCOL_SEQUENCE_TIMEOUT';
}

/**
 * Esegue `fn`; se dopo `afterMs` è ancora in corso chiama `onStuck` (che deve tagliare la query sul
 * server con KILL QUERY). Rete di sicurezza indipendente da `max_statement_time`: il timeout lato
 * client da solo non ferma la query su WebThron, e su MyISAM una query appesa blocca le scritture.
 */
export async function runWithReaper<T>(
  fn: () => Promise<T>,
  afterMs: number,
  onStuck: () => void | Promise<void>,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
): Promise<T> {
  const timer = timers.set(() => { void Promise.resolve(onStuck()).catch(() => {}); }, afterMs);
  try {
    return await fn();
  } finally {
    timers.clear(timer);
  }
}

export function createGuard(opts: GuardOptions) {
  const now   = opts.now   ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  let chain: Promise<void> = Promise.resolve();
  let pending   = 0;
  let lastEnd   = 0;
  let strikes   = 0;
  let openUntil = 0;
  let wasOpen   = false;

  function isOpen(): boolean {
    const open = now() < openUntil;
    if (wasOpen && !open) { wasOpen = false; opts.onClose?.(); }
    return open;
  }

  function busyMessage(): string {
    const secs = Math.max(1, Math.ceil((openUntil - now()) / 1000));
    return `iKnow in pausa di sicurezza (query lente): riprova tra ${secs} s`;
  }

  function record(durationMs: number, timedOut: boolean): void {
    if (timedOut || durationMs > opts.slowMs) {
      strikes++;
      if (strikes >= opts.strikesToOpen) {
        openUntil = now() + opts.cooldownMs;
        wasOpen   = true;
        strikes   = 0;
        opts.onOpen?.(opts.cooldownMs, timedOut ? 'timeout' : `query da ${durationMs} ms`);
      }
    } else {
      strikes = 0;
    }
  }

  /**
   * Esegue `fn` rispettando coda, pausa e interruttore.
   * `bypass` serve agli strumenti di emergenza (SHOW PROCESSLIST, KILL): non fanno coda e
   * funzionano anche con l'interruttore aperto.
   */
  async function run<T>(fn: () => Promise<T>, { bypass = false }: { bypass?: boolean } = {}): Promise<T> {
    if (bypass) return fn();
    if (isOpen()) throw new WebthronBusyError(busyMessage());
    if (pending >= opts.maxQueue) throw new WebthronBusyError('Troppe richieste in coda verso iKnow: riprova tra poco');

    pending++;
    const prev = chain;
    let release!: () => void;
    chain = new Promise<void>(resolve => { release = resolve; });
    try {
      await prev;
      if (isOpen()) throw new WebthronBusyError(busyMessage());
      const wait = lastEnd + opts.minGapMs - now();
      if (wait > 0) await sleep(wait);

      const t0 = now();
      try {
        const result = await fn();
        record(now() - t0, false);
        return result;
      } catch (err) {
        record(now() - t0, isTimeoutError(err));
        throw err;
      }
    } finally {
      lastEnd = now();
      pending--;
      release();
    }
  }

  function getState(): GuardState {
    const open = isOpen();
    return { open, openUntil: open ? openUntil : null, strikes, pending };
  }

  return { run, getState };
}
