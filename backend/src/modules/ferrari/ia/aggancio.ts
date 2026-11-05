// Punti di aggancio verso il resto del modulo: dopo aver caricato una scheda si accoda l'analisi IA (se l'interruttore e' acceso).
// Un guasto qui non deve mai far fallire il caricamento della scheda: si registra e basta.

import { logger } from '../../../lib/logger.js';
import type { EsitoCaricamento, Utente } from '../service.js';
import { servizioIa } from './servizio.js';

export async function accodaDopoCarico(user: Utente, esito: Pick<EsitoCaricamento, 'id' | 'stato' | 'duplicato'>): Promise<void> {
  if (esito.duplicato || esito.stato === 'QUARANTENA') return;
  try {
    await servizioIa().accodaFile(user, esito.id);
  } catch (e) {
    logger.warn(`[ferrari-ia] non riesco ad accodare la scheda ${esito.id}: ${(e as Error).message}`);
  }
}
