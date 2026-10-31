// Lettura della cartella degli Excel (senza IA). Serve un PostgreSQL con le migrazioni: FERRARI_TEST_DATABASE_URL (vedi service.integration).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Schede — lettura della cartella', () => {
  let cart: typeof import('../cartella.js');
  let db: typeof import('../../../db/client.js').db;
  let dir: string;
  const admin = { id: 1, username: 'admin' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    cart = await import('../cartella.js');
    db = (await import('../../../db/client.js')).db;
  });
  afterAll(async () => { await db?.end(); });

  beforeEach(async () => {
    await db`TRUNCATE ferrari_cartella_run, ferrari_cartella_visto, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    dir = await mkdtemp(join(tmpdir(), 'ferrari-cartella-'));
    await cart.salvaConfig(admin, { percorso: dir, auto: false, ora: 4 });
  });

  const scrivi = (nome: string, rows: ReturnType<typeof schedaSemplice>) => writeFile(join(dir, nome), toXlsBuffer(rows));

  it('legge i file nuovi, salta quelli gia\' letti e riprende quelli cambiati', async () => {
    await scrivi('a.xls', schedaSemplice());
    await scrivi('b.xlsx', schedaPersonalizzata({ commessa: 100002 }));
    await writeFile(join(dir, 'note.txt'), 'non e\' un excel');
    const r1 = await cart.leggiCartella('manuale', 'admin');
    expect(r1).toMatchObject({ trovati: 2, nuovi: 2, duplicati: 0, errori: 0, invariati: 0, errore: null });
    const [f] = await db<{ stato: string; ia_stato: string }[]>`SELECT stato, ia_stato FROM ferrari_file WHERE commessa = '100001'`;
    expect(f).toMatchObject({ stato: 'ACCETTATO_AUTO', ia_stato: 'assente' });

    const r2 = await cart.leggiCartella('auto', null);
    expect(r2).toMatchObject({ trovati: 0, invariati: 2, nuovi: 0 });

    // stesso contenuto con un altro nome: duplicato; file rotto: quarantena
    await writeFile(join(dir, 'copia.xls'), toXlsBuffer(schedaSemplice()));
    await writeFile(join(dir, 'rotto.xls'), 'non e\' una scheda');
    const r3 = await cart.leggiCartella('manuale', 'admin');
    expect(r3).toMatchObject({ trovati: 2, duplicati: 1, quarantena: 1, nuovi: 0 });
    expect((await cart.ultimeLetture()).length).toBe(3);

    // un file cambiato (data diversa) si rilegge
    await utimes(join(dir, 'a.xls'), new Date(), new Date(Date.now() + 60_000));
    expect(await cart.leggiCartella('manuale', 'admin')).toMatchObject({ trovati: 1, duplicati: 1 });
  });

  it('senza cartella configurata o con cartella inesistente da errore chiaro e non lascia la lettura bloccata', async () => {
    await cart.salvaConfig(admin, { percorso: '' });
    await expect(cart.leggiCartella('manuale', 'admin')).rejects.toThrow(/non configurata/);
    await cart.salvaConfig(admin, { percorso: join(dir, 'non-esiste') });
    const r = await cart.leggiCartella('manuale', 'admin');
    expect(r.errore).toBeTruthy();
    expect(cart.statoLettura()).toBeNull();
  });

  it('la lettura notturna parte solo se attiva e all\'ora scelta', async () => {
    await scrivi('a.xls', schedaSemplice());
    expect(await cart.letturaNotturna(4)).toBeNull();                       // spenta
    await cart.salvaConfig(admin, { auto: true, ora: 4 });
    expect(await cart.letturaNotturna(5)).toBeNull();                       // altra ora
    expect(await cart.letturaNotturna(4)).toMatchObject({ tipo: 'auto', nuovi: 1 });
  });

  it('valida percorso e ora', async () => {
    await expect(cart.salvaConfig(admin, { percorso: 'relativo/cartella' })).rejects.toThrow();
    await expect(cart.salvaConfig(admin, { percorso: '/dati/../etc' })).rejects.toThrow();
    await expect(cart.salvaConfig(admin, { ora: 25 })).rejects.toThrow();
    await expect(cart.salvaConfig(admin, { percorso: '\\\\server\\edi\\FERRARI\\schede' })).resolves.toMatchObject({ percorso: '\\\\server\\edi\\FERRARI\\schede' });
  });
});
