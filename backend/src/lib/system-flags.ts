/**
 * System flags — iKnow (WebThron) connection toggles.
 * Persisted in PostgreSQL system_config table.
 * In-memory cache refreshed on every read (low frequency).
 *
 * `iknow_enabled` è l'interruttore generale; ogni altra chiave accende/spegne una
 * singola query (o gruppo di query) verso iKnow. Le chiavi mancanti valgono `true`.
 */

import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client.js';

/** Interruttori per singola query verso iKnow. */
export const IKNOW_QUERY_FLAGS = [
  'iknow_andon_enabled',     // sync incrementale Andon/Monitor, ogni 10 minuti
  'iknow_nightly_enabled',   // rilettura notturna degli ultimi 2 giorni, 23:30 e 01:00
  'iknow_lookup_enabled',    // aggiornamento fasi e combos, 02:00 (+ manuale e all'avvio)
  'iknow_buffer_enabled',    // ricalcolo Buffer, ogni 30 min (legge dallo storico locale)
  'iknow_bucci_enabled',     // lookup seriali/commesse nella Spedizione Bucci
  'iknow_backfill_enabled',  // backfill manuali (heatmap, lead time, patch commessa)
  'iknow_bom_enabled',       // copia notturna dei BOM (04:15); spento finché non lo si accende
] as const;

export type IKnowQueryFlag = (typeof IKNOW_QUERY_FLAGS)[number];

/**
 * Interruttori delle sincronizzazioni verso iKnow. Bucci ha una connessione tutta sua e, finché
 * le sincronizzazioni sono spente, è l'unica che deve funzionare: attivarne una la chiude.
 */
export const IKNOW_SYNC_FLAGS = [
  'iknow_andon_enabled',
  'iknow_nightly_enabled',
  'iknow_lookup_enabled',
  'iknow_buffer_enabled',
  'iknow_backfill_enabled',
] as const;

/**
 * Se la modifica accende una sincronizzazione, spegne anche Bucci (a meno che la stessa modifica
 * non lo accenda esplicitamente). Riaccendere Bucci dopo resta possibile a mano.
 */
export function closeBucciWhenSyncOpens<T extends Partial<IKnowFlags>>(partial: T): T {
  const opensSync = IKNOW_SYNC_FLAGS.some(k => partial[k] === true);
  if (!opensSync || partial.iknow_bucci_enabled === true) return partial;
  return { ...partial, iknow_bucci_enabled: false };
}

export type IKnowFlags = { iknow_enabled: boolean } & Record<IKnowQueryFlag, boolean>;

const ALL_KEYS = ['iknow_enabled', ...IKNOW_QUERY_FLAGS] as const;

const DEFAULTS = {
  ...(Object.fromEntries(ALL_KEYS.map(k => [k, true])) as IKnowFlags),
  iknow_bom_enabled: false,   // funzione nuova: si accende a mano dopo il primo controllo
} satisfies IKnowFlags;

/** Lanciata quando si tenta di interrogare iKnow con l'interruttore (generale o della query) spento. */
export class IKnowDisabledError extends HTTPException {
  constructor() {
    super(503, { message: "Connessione iKnow disabilitata dall'amministratore" });
  }
}

// In-memory cache — refreshed at most once per minute
let cached: IKnowFlags | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

export async function getIKnowFlags(): Promise<IKnowFlags> {
  if (cached && Date.now() - cacheTs < CACHE_TTL_MS) return cached;
  try {
    const rows = await db`
      SELECT key, value FROM system_config
      WHERE key IN ${db([...ALL_KEYS])}
    `;
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.key as string] = r.value === 'true';
    cached = Object.fromEntries(ALL_KEYS.map(k => [k, map[k] ?? DEFAULTS[k]])) as IKnowFlags;
    cacheTs = Date.now();
    return cached;
  } catch {
    // If DB unavailable, return cached or defaults
    return cached ?? DEFAULTS;
  }
}

export async function setIKnowFlags(partial: Partial<IKnowFlags>): Promise<IKnowFlags> {
  for (const [key, val] of Object.entries(closeBucciWhenSyncOpens(partial))) {
    await db`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (${key}, ${String(val)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
  cached = null; // invalidate cache
  return getIKnowFlags();
}

/** Shorthand — returns true only if BOTH master and the specific flag are on */
export async function isIKnowEnabled(flag: IKnowQueryFlag): Promise<boolean> {
  const f = await getIKnowFlags();
  return f.iknow_enabled && f[flag];
}

/** Per le rotte e i job on-demand: lancia 503 se la query è spenta (generale o singola). */
export async function assertIKnowEnabled(flag: IKnowQueryFlag): Promise<void> {
  if (!(await isIKnowEnabled(flag))) throw new IKnowDisabledError();
}
