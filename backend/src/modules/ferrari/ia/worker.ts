// Ciclo che fa girare il servizio IA ogni pochi secondi. Con l'interruttore spento ogni giro costa pochi controlli sul database.

import { logger } from '../../../lib/logger.js';
import { servizioIa } from './servizio.js';

export const INTERVALLO_GIRO_MS = 5_000;
let timer: NodeJS.Timeout | null = null;

export function avviaCodaIa(): void {
  if (timer) return;
  timer = setInterval(() => { servizioIa().tick().catch(e => logger.error(`[ferrari-ia] giro fallito: ${(e as Error).message}`)); }, INTERVALLO_GIRO_MS);
  timer.unref();                                  // non tiene vivo il processo da solo
  logger.info('[ferrari-ia] ciclo avviato (con l\'interruttore spento non fa niente)');
}

export function fermaCodaIa(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
