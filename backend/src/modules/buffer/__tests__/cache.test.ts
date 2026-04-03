import { describe, it, expect, vi } from 'vitest';
import { getBufferCache } from '../cache.js';

vi.mock('../../../db/client.js', () => ({ db: vi.fn() }));
vi.mock('../mysql-client.js', () => ({ queryBufferAll: vi.fn(async () => []) }));
vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ─── cache.ts pure-function tests ────────────────────────────────────────────
//
// The buffer cache module relies on PostgreSQL (db) and MySQL (queryBufferAll)
// at startup, so we test only the pure/synchronous API that is safe to call
// without a real database connection.

describe('getBufferCache', () => {
  it('returns null for an unknown lineaId before any refresh', () => {
    // The in-memory Map starts empty; no DB is needed for this check.
    expect(getBufferCache(99999)).toBeNull();
  });

  it('returns null for lineaId 0', () => {
    expect(getBufferCache(0)).toBeNull();
  });
});

describe('cache module exports', () => {
  it('exports the expected functions', async () => {
    // Dynamic import to verify the module shape without triggering DB connections
    const mod = await import('../cache.js');
    expect(typeof mod.getBufferCache).toBe('function');
    expect(typeof mod.refreshSingleBuffer).toBe('function');
    expect(typeof mod.startBufferCache).toBe('function');
    expect(typeof mod.bufferFullRefresh).toBe('function');
  });
});
