/**
 * Esegue una passata opzionale (es. schede modificate, lastup) registrandola in sync-stats, così in
 * Sistema → Aggiornamenti si vede se funziona: stato, righe sostituite, ultimo errore, errori di fila.
 *
 * `swallow: true` — l'errore è registrato e ingoiato (ritorna null): la passata è un extra e non deve
 *                   fermare il lavoro principale (gli eventi nuovi dell'incrementale devono entrare comunque).
 * `swallow: false` — l'errore è registrato e rilanciato (la carica notturna lo mette nei suoi errori).
 */

import { startRun, endRun, failRun } from '../../lib/sync-stats.js';

export async function trackedPass(
  job:  string,
  fn:   () => Promise<number>,
  opts: { swallow: boolean; onError?: (err: unknown) => void },
): Promise<number | null> {
  startRun(job);
  try {
    const n = await fn();
    endRun(job, n);
    return n;
  } catch (err) {
    failRun(job, err);
    if (!opts.swallow) throw err;
    opts.onError?.(err);
    return null;
  }
}
