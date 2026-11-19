// Fatturazione: sincronizzazione da BC (simulato) verso fatt_riga, con PostgreSQL vero.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

vi.mock('../../edi/dynamics-client.js', () => ({
  getShipments: vi.fn(async () => [
    { shipment_id: 'D1', shipment_date: '2026-01-10', customer_account: 'C1', line_count: 2 },
    { shipment_id: 'D2', shipment_date: '2026-01-11', customer_account: 'C1', line_count: 1 },
  ]),
}));
vi.mock('../bc.js', () => ({
  getRigheDespachi: vi.fn(async (ids: string[]) => ids.flatMap(id => [
    { shipment_id: id, line_no: 1, article_code: 'ART1', quantity: 2, order_no: 'O1', descrizione: 'PPE1 ROSSO' },
    ...(id === 'D1' ? [{ shipment_id: id, line_no: 2, article_code: 'ART2', quantity: 1, order_no: 'O1', descrizione: '' }] : []),
  ])),
}));

describe.skipIf(!URL)('Fatturazione — sincronizzazione', () => {
  let db: typeof import('../../../db/client.js').db;
  let sync: typeof import('../sync.js');
  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    db = (await import('../../../db/client.js')).db;
    sync = await import('../sync.js');
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE fatt_riga`;
    await db`DELETE FROM fatt_conto`; await db`INSERT INTO fatt_conto (conto) VALUES ('C1')`;
    await db`UPDATE fatt_sync_stato SET ultima_sync = NULL, in_corso_da = NULL, errore = NULL`;
  });

  it('copia le righe, è ripetibile e aggiorna lo stato', async () => {
    expect(await sync.sincronizza()).toBe(3);
    expect(await sync.sincronizza()).toBe(3);                                     // niente duplicati
    expect((await db<{ n: string }[]>`SELECT count(*)::text n FROM fatt_riga`)[0]!.n).toBe('3');
    const [st] = await db<{ ultima_sync: Date | null; in_corso_da: Date | null; errore: string | null }[]>`SELECT * FROM fatt_sync_stato`;
    expect(st!.ultima_sync).not.toBeNull();
    expect(st!.in_corso_da).toBeNull();
  });

  it('una sola sincronizzazione alla volta', async () => {
    await db`UPDATE fatt_sync_stato SET in_corso_da = now()`;
    expect(await sync.sincronizza()).toBe(-1);
    await db`UPDATE fatt_sync_stato SET in_corso_da = now() - interval '2 hours'`;   // bloccata da troppo: si riparte
    expect(await sync.sincronizza()).toBe(3);
  });
});
