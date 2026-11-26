import { describe, it, expect } from 'vitest';
import { trackedPass } from '../tracked-pass.js';
import { getAllStats } from '../../../lib/sync-stats.js';

describe('trackedPass', () => {
  it('passata riuscita: stato ok e righe sostituite registrate', async () => {
    const n = await trackedPass('t_ok', async () => 7, { swallow: true });
    expect(n).toBe(7);
    const s = getAllStats()['t_ok'];
    expect(s.status).toBe('ok');
    expect(s.lastRowCount).toBe(7);
    expect(s.lastError).toBeNull();
  });

  it('errore con swallow: non si propaga (gli eventi nuovi proseguono), ma è registrato', async () => {
    const visti: unknown[] = [];
    const n = await trackedPass('t_swallow', async () => { throw new Error('WebThron occupato'); },
      { swallow: true, onError: e => visti.push(e) });
    expect(n).toBeNull();
    expect(visti).toHaveLength(1);
    const s = getAllStats()['t_swallow'];
    expect(s.status).toBe('error');
    expect(s.lastError).toBe('WebThron occupato');
    expect(s.consecutiveErrors).toBe(1);
  });

  it('errori di fila si contano; un successo li azzera', async () => {
    const fail = () => trackedPass('t_streak', async () => { throw new Error('x'); }, { swallow: true });
    await fail(); await fail();
    expect(getAllStats()['t_streak'].consecutiveErrors).toBe(2);
    await trackedPass('t_streak', async () => 0, { swallow: true });
    expect(getAllStats()['t_streak'].consecutiveErrors).toBe(0);
    expect(getAllStats()['t_streak'].status).toBe('ok');
  });

  it('errore senza swallow: registrato e rilanciato (carica notturna)', async () => {
    await expect(trackedPass('t_throw', async () => { throw new Error('boom'); }, { swallow: false }))
      .rejects.toThrow('boom');
    expect(getAllStats()['t_throw'].status).toBe('error');
  });
});
