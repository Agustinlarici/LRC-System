// Punti di aggancio verso il resto del modulo: dopo aver caricato una scheda si accoda l'analisi IA (se l'interruttore e' acceso).
// Un guasto qui non deve mai far fallire il caricamento della scheda: si registra e basta.

import { logger } from '../../../lib/logger.js';
import type { EsitoCaricamento, Utente } from '../service.js';
import { servizioIa, type EsitoRianalisi } from './servizio.js';

export async function accodaDopoCarico(user: Utente, esito: Pick<EsitoCaricamento, 'id' | 'stato' | 'duplicato'>): Promise<void> {
  if (esito.duplicato || esito.stato === 'QUARANTENA') return;
  try {
    await servizioIa().accodaFile(user, esito.id);
  } catch (e) {
    logger.warn(`[ferrari-ia] non riesco ad accodare la scheda ${esito.id}: ${(e as Error).message}`);
  }
}

/** Solo per prova: un file gia' caricato si rimanda alla IA (nuova analisi). Mai un guasto verso il chiamante. */
export async function rianalizzaDuplicato(user: Utente, id: number): Promise<EsitoRianalisi> {
  try {
    return await servizioIa().rianalizza(user, id);
  } catch (e) {
    logger.warn(`[ferrari-ia] non riesco a rianalizzare la scheda ${id}: ${(e as Error).message}`);
    return 'non_analizzabile';
  }
}
