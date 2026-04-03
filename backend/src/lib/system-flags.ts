/**
 * System flags — iKnow (WebThron) connection toggles.
 * Persisted in PostgreSQL system_config table.
 * In-memory cache refreshed on every read (low frequency).
 */

import { db } from '../db/client.js';

export interface IKnowFlags {
  iknow_enabled:        boolean;
  iknow_andon_enabled:  boolean;
  iknow_buffer_enabled: boolean;
}

const DEFAULTS: IKnowFlags = {
  iknow_enabled:        true,
  iknow_andon_enabled:  true,
  iknow_buffer_enabled: true,
};

// In-memory cache — refreshed at most once per minute
let cached: IKnowFlags | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

export async function getIKnowFlags(): Promise<IKnowFlags> {
  if (cached && Date.now() - cacheTs < CACHE_TTL_MS) return cached;
  try {
    const rows = await db`
      SELECT key, value FROM system_config
      WHERE key IN ('iknow_enabled','iknow_andon_enabled','iknow_buffer_enabled')
    `;
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.key as string] = r.value === 'true';
    cached = {
      iknow_enabled:        map['iknow_enabled']        ?? DEFAULTS.iknow_enabled,
      iknow_andon_enabled:  map['iknow_andon_enabled']  ?? DEFAULTS.iknow_andon_enabled,
      iknow_buffer_enabled: map['iknow_buffer_enabled'] ?? DEFAULTS.iknow_buffer_enabled,
    };
    cacheTs = Date.now();
    return cached;
  } catch {
    // If DB unavailable, return cached or defaults
    return cached ?? DEFAULTS;
  }
}

export async function setIKnowFlags(partial: Partial<IKnowFlags>): Promise<IKnowFlags> {
  for (const [key, val] of Object.entries(partial)) {
    await db`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (${key}, ${String(val)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
  cached = null; // invalidate cache
  return getIKnowFlags();
}

/** Shorthand — returns false only if BOTH master and specific flag are false */
export async function isIKnowEnabled(flag: 'iknow_andon_enabled' | 'iknow_buffer_enabled'): Promise<boolean> {
  const f = await getIKnowFlags();
  return f.iknow_enabled && f[flag];
}
