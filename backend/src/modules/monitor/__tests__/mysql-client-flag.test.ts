import { describe, it, expect, vi } from 'vitest';

const flags = { iknow_enabled: false };
vi.mock('../../../lib/system-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/system-flags.js')>()),
  getIKnowFlags: async () => flags,
}));

import { getWebthronPool, getBucciPool, closeWebthronPools, IKnowDisabledError } from '../mysql-client.js';

describe('getWebthronPool con iKnow disabilitato', () => {
  it('rifiuta execute, query e getConnection senza aprire connessioni', async () => {
    const pool = getWebthronPool();
    await expect(pool.execute('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(pool.query('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(pool.getConnection()).rejects.toBeInstanceOf(IKnowDisabledError);
    await pool.end();
  });
});

describe('getBucciPool con iKnow disabilitato', () => {
  it('è un pool separato e rifiuta anch\'esso ogni query senza aprire connessioni', async () => {
    const bucci = getBucciPool();
    expect(bucci).not.toBe(getWebthronPool());
    await expect(bucci.execute('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(bucci.query('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(bucci.getConnection()).rejects.toBeInstanceOf(IKnowDisabledError);
    await closeWebthronPools();
  });
});
