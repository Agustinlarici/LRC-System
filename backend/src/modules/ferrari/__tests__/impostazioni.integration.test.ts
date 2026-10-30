// Impostazioni: stato delle sigle per modello e modifiche in blocco. Serve FERRARI_TEST_DATABASE_URL (vedi service.integration).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Impostazioni — sigle e componenti', () => {
  let svc: typeof import('../service.js');
  let imp: typeof import('../impostazioni.js');
  let comp: typeof import('../componenti.js');
  let db: typeof import('../../../db/client.js').db;
  const op = { id: 1, username: 'operatore' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    svc = await import('../service.js');
    imp = await import('../impostazioni.js');
    comp = await import('../componenti.js');
    db = (await import('../../../db/client.js')).db;
  });
  afterAll(async () => { await db?.end(); });

  beforeEach(async () => {
    await db`TRUNCATE ferrari_comp_proposta, ferrari_comp_termine, ferrari_comp, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    await svc.caricaScheda(op, 'a.xls', toXlsBuffer(schedaSemplice()));
    await svc.caricaScheda(op, 'b.xls', toXlsBuffer(schedaPersonalizzata({ commessa: 100002, modello: 'F888YY' } as never)));
  });

  const stato = async (codice: string, modello: string) =>
    (await imp.configurazioneSigle()).sigle.find(s => s.codice === codice)?.stati[modello]?.stato;

  it('una sigla trovata e mai decisa e\' da decidere; si decide per un solo modello', async () => {
    const c = await imp.configurazioneSigle();
    expect(c.modelli.length).toBeGreaterThan(0);
    const m = c.modelli[0]!.modello;
    const s = c.sigle.find(x => x.stati[m]?.stato === 'da_decidere')!;
    expect(s).toBeTruthy();
    await imp.impostaSigla(op, s.codice, 'colonna', [m]);
    expect(await stato(s.codice, m)).toBe('colonna');
    expect((await svc.matrice(m)).termini).toContain(s.codice);
  });

  it('«tutti i modelli» sostituisce le scelte per modello; «reset» la riporta da decidere', async () => {
    const m = (await imp.configurazioneSigle()).modelli[0]!.modello;
    const codice = (await imp.configurazioneSigle()).sigle.find(x => x.stati[m]?.stato === 'da_decidere')!.codice;
    await imp.impostaSigla(op, codice, 'no', [m]);
    await imp.impostaSigla(op, codice, 'colonna', '*');
    expect(await stato(codice, m)).toBe('colonna');
    await imp.impostaSigla(op, codice, 'reset', '*');
    expect(await stato(codice, m)).toBe('da_decidere');
  });

  it('sotto-sigla e alias; l\'alias senza codice si rifiuta', async () => {
    const m = (await imp.configurazioneSigle()).modelli[0]!.modello;
    await imp.impostaSigla(op, 'TLM13', 'sub', [m]);
    expect(await stato('TLM13', m)).toBe('sub');
    await imp.impostaSigla(op, 'TLM15', 'alias', [m], 'TLM13');
    expect(await stato('TLM15', m)).toBe('alias');
    await expect(imp.impostaSigla(op, 'TLM15', 'alias', [m])).rejects.toThrow();
  });

  it('decide in blocco le sigle da decidere di un modello', async () => {
    const m = (await imp.configurazioneSigle()).modelli[0]!.modello;
    const n = (await imp.configurazioneSigle()).da_decidere[m]!;
    expect(n).toBeGreaterThan(0);
    expect(await imp.decidiTutteDaDecidere(op, m, 'no')).toBe(n);
    expect((await imp.configurazioneSigle()).da_decidere[m]).toBe(0);
  });

  it('applica un componente ad altri modelli', async () => {
    const modelli = (await imp.configurazioneSigle()).modelli.map(x => x.modello);
    await comp.salvaComponente(op, modelli[0]!, 'Spoiler', ['AAAA', 'ala']);
    expect(await imp.applicaComponente(op, modelli[0]!, 'spoiler', modelli)).toBe(modelli.length - 1);
    if (modelli[1]) expect((await comp.elencoComponenti(modelli[1])).componenti[0]).toMatchObject({ nome: 'Spoiler', termini: ['AAAA', 'ALA'] });
    await expect(imp.applicaComponente(op, modelli[0]!, 'Non c\'e\'', modelli)).rejects.toThrow();
  });
});
