// Alimentatore dalla COPIA del DB di iKnow (webthron_events_history) — provvisorio, finché non arriva la
// chiamata API. Ogni minuto guarda gli eventi recenti di delibera con esito "accettato" e, se la fase è nel
// catalogo (es. DELIBERA FINALE → stazione "Delibera finale"), crea l'ordine di foto con registerEvent.
// Senza cursore: guarda una finestra recente e l'idempotenza evita i doppioni (così commessa/esito che
// arrivano in ritardo nella copia vengono presi al giro dopo). Legge solo il Postgres locale, mai iKnow.
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { isIKnowEnabled } from '../../lib/system-flags.js';
import { activePhaseRules, eventRef, matchPhase, registerEvent } from './events.js';

export const FEED_BATCH = 500;
export const lastRun: { at: Date | null; created: number; error: string | null } = { at: null, created: 0, error: null };

export async function runPhotoFeed(): Promise<number> {
  const [cfg] = await db`SELECT enabled, esiti_ok, enabled_since FROM photo_feed_config WHERE id = 1`;
  if (!cfg?.enabled || !cfg.enabled_since || !(cfg.esiti_ok as string[]).length) return 0;
  // Interruttore generale di iKnow: spento (es. ambiente di sviluppo) → nessun ordine, nessuna camera.
  if (!(await isIKnowEnabled('iknow_andon_enabled'))) return 0;

  try {
    const rules = await activePhaseRules();
    if (rules.length === 0) return 0;
    const rows = await db`
      SELECT fase, componente, cod_seriale, commessa, versione, data_inserimento
      FROM webthron_events_history
      WHERE data_cache >= CURRENT_DATE - 1
        AND data_inserimento > ${cfg.enabled_since}
        AND esito_delibera = ANY(${cfg.esiti_ok as string[]})
        AND commessa IS NOT NULL AND commessa <> '' AND cod_seriale IS NOT NULL AND componente IS NOT NULL
      ORDER BY data_inserimento
      LIMIT ${FEED_BATCH}
    `;
    const items = rows.flatMap(r => {
      const phase = matchPhase(rules, r.fase as string);
      if (!phase) return [];
      return [{ phase, e: {
        seriale: r.cod_seriale as string, commessa: (r.commessa as string).trim(), fase: r.fase as string,
        componente: r.componente as string, versione: (r.versione as string | null) ?? null, eventAt: r.data_inserimento as Date,
      } }];
    });
    if (items.length === 0) { Object.assign(lastRun, { at: new Date(), created: 0, error: null }); return 0; }
    const refs = items.map(i => eventRef(i.e, i.phase));
    const seen = new Set((await db`SELECT external_ref FROM photo_jobs WHERE external_ref IN ${db(refs)}`).map(r => r.external_ref as string));
    let created = 0;
    for (const [i, it] of items.entries()) {
      if (seen.has(refs[i])) continue;
      if ((await registerEvent(it.e, it.phase, true, 'iknow_db', 'iKnow (copia DB)')).result === 'created') created++;
    }
    if (created > 0) logger.info({ created }, '[PhotoFeed] ordini di foto creati dalla copia di iKnow');
    Object.assign(lastRun, { at: new Date(), created, error: null });
    return created;
  } catch (e) {
    lastRun.error = e instanceof Error ? e.message : String(e);
    logger.error({ err: e }, '[PhotoFeed] errore');
    return 0;
  }
}
