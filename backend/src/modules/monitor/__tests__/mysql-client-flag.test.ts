import { describe, it, expect, vi } from 'vitest';

const flags = { iknow_enabled: false };
vi.mock('../../../lib/system-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/system-flags.js')>()),
  getIKnowFlags: async () => flags,
}));

import { getWebthronPool, IKnowDisabledError } from '../mysql-client.js';

describe('getWebthronPool con iKnow disabilitato', () => {
  it('rifiuta execute, query e getConnection senza aprire connessioni', async () => {
    const pool = getWebthronPool();
    await expect(pool.execute('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(pool.query('SELECT 1')).rejects.toBeInstanceOf(IKnowDisabledError);
    await expect(pool.getConnection()).rejects.toBeInstanceOf(IKnowDisabledError);
    await pool.end();
  });
});
