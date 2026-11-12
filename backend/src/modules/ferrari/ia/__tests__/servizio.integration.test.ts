// Servizio IA contro un PostgreSQL vero e una PC IA finta (HTTP vero). Serve FERRARI_TEST_DATABASE_URL (vedi service.integration).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schedaPersonalizzata, toXlsBuffer } from '../../__tests__/fixtures.js';
import { avviaFakePcIa, type FakePcIa } from './fake-pc-ia.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Collegamento con la PC IA — servizio', () => {
  let svc: typeof import('../../service.js');
  let mod: typeof import('../servizio.js');
  let cfgMod: typeof import('../config.js');
  let parser: typeof import('../../parser.js');
  let matrice: typeof import('../../matrice.js');
  let ClienteIa: typeof import('../client.js').ClienteIa;
  let db: typeof import('../../../../db/client.js').db;
  const op = { id: 1, username: 'operatore' };
  let ia: FakePcIa | null = null;
  let ora = new Date('2026-11-05T10:00:00Z');
  const avanza = (min: number) => { ora = new Date(ora.getTime() + min * 60_000); };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    svc = await import('../../service.js');
    mod = await import('../servizio.js');
    cfgMod = await import('../config.js');
    parser = await import('../../parser.js');
    matrice = await import('../../matrice.js');
    ClienteIa = (await import('../client.js')).ClienteIa;
    db = (await import('../../../../db/client.js')).db;
  });
  afterAll(async () => { await db?.end(); });

  beforeEach(async () => {
    await db`TRUNCATE ferrari_ia_job, ferrari_ia_passo, ferrari_ia_risultato, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    await db`DELETE FROM ferrari_config WHERE key IN ('ia_attiva', 'ia_url', 'ia_max_tentativi', 'ia_timeout_s')`;
    ora = new Date('2026-11-05T10:00:00Z');
  });
  afterEach(async () => { await ia?.chiudi(); ia = null; });

  /** La IA «legge» la scheda come la VM e riassume i testi lunghi: il caso normale. */
  const comeLaVm = (modifica?: (l: { codice: string; valore: string }[]) => void) => (file: Buffer) => {
    const c = parser.parseScheda(file, 'x.xls');
    const lettura = c.opzioni.map(o => ({ riga: o.riga, codice: o.codice, descrizione: `RISCRITTA ${o.descrizione}`, valore: o.valore, nota: o.nota, testi: o.blocchi_testo.map(b => b.testo) }));
    modifica?.(lettura);
    return {
      commessa: c.header.commessa, modello: c.header.tipo_matricola.modello, lettura,
      dettagli: c.opzioni.filter(o => o.blocchi_testo.length).map(o => ({ codice: o.codice, chiave: matrice.chiaveTesto(matrice.testoLibero(o)), dettaglio: `RIASSUNTO ${o.codice}`, stato: 'ok' as const })),
      avvisi: [], metriche: { secondi: 1, chiamate: 2, versione_prompt: '3', modello: 'gemma4:e2b' },
    };
  };

  async function nuovo(opzioni: Parameters<typeof avviaFakePcIa>[0] extends infer P ? Partial<P> : never = {}) {
    ia = await avviaFakePcIa({ secret: await svc.getSecret(), risultato: comeLaVm(), ...opzioni });
    await cfgMod.salvaConfigIa(op, { url: ia.url, attiva: true });
    return new mod.ServizioIa({
      creaCliente: (cfg, secret) => new ClienteIa({ url: cfg.url, secret, timeoutMs: 2000, timeoutConnessioneMs: 500 }),
      adesso: () => ora, rand: () => 0.5, leggiSnapshot: (await import('../snapshot.js')).leggiSnapshotDaDb,
    });
  }
  const carica = async (commessa: number) => (await svc.caricaScheda(op, `${commessa}.xls`, toXlsBuffer(schedaPersonalizzata({ commessa })))).id;
  const job = async (id: string) => (await db<{ stato: string; passo: string; tentativi: number; errore: string | null; prossimo_tentativo_at: Date | null }[]>`
    SELECT stato, passo, tentativi, errore, prossimo_tentativo_at FROM ferrari_ia_job WHERE id = ${id}`)[0]!;
  const passi = async (id: string) => (await db<{ passo: string; stato: string }[]>`SELECT passo, stato FROM ferrari_ia_passo WHERE job_id = ${id} ORDER BY id`).map(p => `${p.passo}:${p.stato}`);

  it('con l\'interruttore spento non fa niente', async () => {
    const s = new mod.ServizioIa({ creaCliente: () => { throw new Error('non deve crearlo'); }, adesso: () => ora, rand: () => 0.5, leggiSnapshot: async () => { throw new Error('no'); } });
    const id = await carica(1);
    expect(await s.accodaFile(op, id)).toBeNull();
    expect(await s.tick()).toMatchObject({ saltato: 'spenta' });
    expect(await db`SELECT 1 FROM ferrari_ia_job`).toHaveLength(0);
    const riga = (await s.elenco()).find(r => r.file_id === id)!;                       // la scheda c'e' lo stesso, con le tappe IA saltate
    expect(riga.tappe.map(t => `${t.passo}:${t.stato}`).join(' ')).toBe('ricevuta:fatto letta:fatto inviata:saltato analisi:saltato confronto:saltato pronta:fatto');
  });

  it('percorso normale: in coda → inviato → in analisi → fatto, con le sigle mandate una volta sola', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 3 });
    const f = await carica(1);
    const j = (await s.accodaFile(op, f))!;
    expect(await s.accodaFile(op, f)).toBeNull();                                       // uno solo attivo per scheda
    expect(await s.tick()).toMatchObject({ inviati: 1 });
    expect((await job(j)).stato).toBe('inviato');
    expect(ia!.sigleNote.size).toBe(1);
    await s.tick();
    expect(await job(j)).toMatchObject({ stato: 'in_analisi', passo: 'analisi' });
    const riga = (await s.elenco()).find(r => r.file_id === f)!;
    expect(riga.tappe[3]).toMatchObject({ stato: 'in_corso', dettaglio: 'Lettura 1/3' });
    expect(await s.tick()).toMatchObject({ seguiti: 1 });
    expect(await s.tick()).toMatchObject({ completati: 1 });
    expect(await job(j)).toMatchObject({ stato: 'fatto', passo: 'pronta' });
    expect(await passi(j)).toEqual(['ricevuta:ok', 'letta:ok', 'inviata:in_corso', 'inviata:ok', 'analisi:in_corso', 'analisi:ok', 'confronto:ok', 'pronta:ok']);
    expect(ia!.richieste.filter(r => r.metodo === 'PUT')).toHaveLength(1);
    const [r] = await db<{ esito: string }[]>`SELECT esito FROM ferrari_ia_risultato WHERE job_id = ${j}`;
    expect(r!.esito).toBe('uguale');
    const dettagli = await db<{ codice: string; da: string; dettaglio: string }[]>`SELECT codice, da, dettaglio FROM ferrari_dettaglio ORDER BY codice`;
    expect(dettagli.length).toBeGreaterThan(0);
    expect(dettagli.every(d => d.da === 'ia' && d.dettaglio.startsWith('RIASSUNTO'))).toBe(true);
    expect((await s.elenco()).find(x => x.file_id === f)!.tappe.every(t => t.stato === 'fatto')).toBe(true);
    expect(await s.tick()).toMatchObject({ inviati: 0, seguiti: 0 });                   // niente piu' da fare
  });

  it('gli avvisi della IA (es. un codice scritto male nel testo) si conservano, si contano nell\'elenco e si leggono nel dettaglio', async () => {
    const avvisi = [{ codice: 'LI5X', riga: 8, motivo: 'Nel testo c\'e\' TLM5: forse e\' la sigla TML05' }, { codice: 'CEL2', motivo: 'altro avviso' }];
    const s = await nuovo({ risultato: (file: Buffer) => ({ ...comeLaVm()(file), avvisi }) });
    const f = await carica(1);
    const j = (await s.accodaFile(op, f))!;
    expect((await s.elenco()).find(r => r.file_id === f)!.n_avvisi).toBe(0);          // prima del risultato non ce ne sono
    for (let i = 0; i < 8 && (await job(j)).stato !== 'fatto'; i++) await s.tick();
    expect((await job(j)).stato).toBe('fatto');
    expect((await s.elenco()).find(r => r.file_id === f)!.n_avvisi).toBe(2);
    const d = await s.dettaglioJob(j);
    expect((d.risultato as unknown as { avvisi: typeof avvisi }).avvisi).toEqual(avvisi);
  });

  it('un valore diverso nella lettura della IA diventa una discrepanza (ambra); la scheda e\' comunque pronta', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 1, risultato: comeLaVm(l => { l.find(x => x.codice === 'DEDI')!.valore = 'NO'; }) });
    const f = await carica(2);
    const j = (await s.accodaFile(op, f))!;
    await s.tick(); await s.tick();
    expect((await job(j)).stato).toBe('fatto');
    const [r] = await db<{ esito: string; discrepanze: { codice: string; tipo: string }[] }[]>`SELECT esito, discrepanze FROM ferrari_ia_risultato WHERE job_id = ${j}`;
    expect(r!.esito).toBe('discrepanze');
    expect(r!.discrepanze).toEqual([expect.objectContaining({ codice: 'DEDI', tipo: 'valore_diverso' })]);
    const tappe = (await s.elenco()).find(x => x.file_id === f)!.tappe;
    expect(tappe[4]).toMatchObject({ stato: 'attenzione' });
    expect(tappe[5]).toMatchObject({ stato: 'fatto' });
    expect(await passi(j)).toContain('confronto:attenzione');
  });

  it('un riassunto scritto da una persona non si sovrascrive; quelli di testi che la scheda non ha si ignorano', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 1, risultato: (file, meta) => {
      const r = comeLaVm()(file);
      return { ...r, dettagli: [...r.dettagli, { codice: 'ZZZZ', chiave: 'f'.repeat(40), dettaglio: 'DI UN TESTO CHE NON C\'E\'', stato: 'ok' as const }], commessa: meta.commessa };
    } });
    const f = await carica(3);
    const comm = (await db<{ commessa: string }[]>`SELECT commessa FROM ferrari_file WHERE id = ${f}`)[0]!.commessa;
    const c = parser.parseScheda(toXlsBuffer(schedaPersonalizzata({ commessa: 3 })), 'x.xls');
    const o = c.opzioni.find(x => x.blocchi_testo.length)!;
    const chiave = matrice.chiaveTesto(matrice.testoLibero(o));
    await db`INSERT INTO ferrari_dettaglio (commessa, codice, chiave, dettaglio, manuale, stato, da) VALUES (${comm}, ${o.codice}, ${chiave}, 'MIA RISPOSTA', TRUE, 'rivisto', 'persona')`;
    await s.accodaFile(op, f); await s.tick(); await s.tick();
    const righe = await db<{ chiave: string; dettaglio: string }[]>`SELECT chiave, dettaglio FROM ferrari_dettaglio`;
    expect(righe.find(x => x.chiave === chiave)!.dettaglio).toBe('MIA RISPOSTA');
    expect(righe.some(x => x.chiave === 'f'.repeat(40))).toBe(false);
  });

  it('PC IA spenta: attesa crescente, poi corto circuito; riaccesa riparte da sola', async () => {
    const s = await nuovo();
    const f = await carica(4);
    const j = (await s.accodaFile(op, f))!;
    await ia!.chiudi(); ia = null;
    await s.tick();
    expect(await job(j)).toMatchObject({ stato: 'attesa_ia', tentativi: 1 });
    expect((await job(j)).prossimo_tentativo_at!.getTime()).toBe(ora.getTime() + 60_000);   // 1 minuto (rand = 0.5: nessuno scarto)
    expect((await job(j)).errore).toMatch(/raggiungibile/);
    expect(await s.tick()).toMatchObject({ inviati: 0 });                                      // non e' ancora l'ora
    avanza(1.1); await s.tick();                                                                 // 2° errore
    avanza(2.1); await s.tick();                                                                 // 3° errore → corto circuito
    expect(s.connessione.stato).toBe('non_raggiungibile');
    expect((await job(j)).tentativi).toBe(3);
    avanza(5.1);
    const ancora = await s.tick();
    expect(ancora.saltato).toBe('non_raggiungibile');                                           // non insiste: controlla solo /salute

    // si accende un'altra PC IA (altro indirizzo, senza le sigle): al primo controllo riuscito riparte
    ia = await avviaFakePcIa({ secret: await svc.getSecret(), risultato: comeLaVm(), passiPrimaDelFinire: 1 });
    await cfgMod.salvaConfigIa(op, { url: ia.url });
    avanza(2);
    await s.tick();                                                                               // salute ok → riprende gli scaduti
    expect(s.connessione.stato).toBe('ok');
    await s.tick();
    expect((await job(j)).stato).toBe('fatto');
  });

  it('troppi tentativi: errore definitivo; «Riprova» lo rimette in coda', async () => {
    const s = await nuovo();
    await cfgMod.salvaConfigIa(op, { maxTentativi: 2 });
    const f = await carica(5);
    const j = (await s.accodaFile(op, f))!;
    await ia!.chiudi(); ia = null;
    await s.tick(); avanza(1.1); await s.tick();
    expect(await job(j)).toMatchObject({ stato: 'errore', tentativi: 2 });
    const t = (await s.elenco()).find(x => x.file_id === f)!.tappe;
    expect(t[2]).toMatchObject({ stato: 'errore' });
    expect(t[5]).toMatchObject({ stato: 'attenzione', dettaglio: 'Usabile senza IA' });
    await s.riprova(op, j);
    expect(await job(j)).toMatchObject({ stato: 'in_coda', tentativi: 0 });
    await expect(s.riprova(op, j)).rejects.toThrow(/solo un lavoro in errore/);
  });

  it('segreto sbagliato (401): errore subito, senza tentativi inutili', async () => {
    const s = await nuovo({ secret: 'un-altro-segreto' });
    const j = (await s.accodaFile(op, await carica(6)))!;
    await s.tick();
    expect(await job(j)).toMatchObject({ stato: 'errore', tentativi: 1 });
    expect((await job(j)).errore).toMatch(/Firma rifiutata/);
    expect(s.connessione.stato).not.toBe('non_raggiungibile');                                  // la PC risponde: non e' un problema di rete
  });

  it('la PC IA e\' stata riavviata e non ricorda il lavoro: si reinvia senza contare un tentativo', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 3 });
    const j = (await s.accodaFile(op, await carica(7)))!;
    await s.tick();
    expect((await job(j)).stato).toBe('inviato');
    await ia!.chiudi();
    ia = await avviaFakePcIa({ secret: await svc.getSecret(), risultato: comeLaVm(), passiPrimaDelFinire: 1 });
    await cfgMod.salvaConfigIa(op, { url: ia.url });
    await s.tick();                                                                               // 404 sul lavoro → torna in coda
    expect(await job(j)).toMatchObject({ stato: 'in_coda', tentativi: 0 });
    await s.tick();                                                                               // reinvio (sigle nuove incluse)
    await s.tick();
    expect((await job(j)).stato).toBe('fatto');
  });

  it('sigle sconosciute alla PC IA (409): si rimandano e si va avanti senza errore', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 1 });
    const j = (await s.accodaFile(op, await carica(8)))!;
    await s.tick();                                                                               // prima sincronizzazione ok
    await db`UPDATE ferrari_ia_job SET stato = 'in_coda', id_remoto = NULL WHERE id = ${j}`;
    ia!.sigleNote.clear();                                                                       // la PC IA «dimentica» le sigle
    await s.tick();
    expect(await job(j)).toMatchObject({ stato: 'inviato', tentativi: 0 });
    expect(ia!.sigleNote.size).toBe(1);
  });

  it('annullare: da in coda a annullato; non si puo\' annullare uno finito', async () => {
    const s = await nuovo();
    const j = (await s.accodaFile(op, await carica(9)))!;
    await s.annulla(op, j);
    expect((await job(j)).stato).toBe('annullato');
    await expect(s.annulla(op, j)).rejects.toThrow(/non si puo/);
    expect(await s.tick()).toMatchObject({ inviati: 0 });
    expect((await s.accodaFile(op, (await db<{ file_id: number }[]>`SELECT file_id FROM ferrari_ia_job WHERE id = ${j}`)[0]!.file_id))).not.toBeNull();   // dopo annullato se ne puo' fare un altro
  });

  it('due giri insieme: il secondo aspetta (mai invii doppi)', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 1 });
    await s.accodaFile(op, await carica(10));
    const [a, b] = await Promise.all([s.tick(), s.tick()]);
    expect([a.saltato, b.saltato].filter(x => x === 'occupato')).toHaveLength(1);
    expect(ia!.richieste.filter(r => r.metodo === 'POST' && r.percorso === '/v1/analisi')).toHaveLength(1);
  });

  it('non manda piu\' di tre lavori alla volta', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 99 });
    for (const n of [11, 12, 13, 14, 15]) await s.accodaFile(op, await carica(n));
    await s.tick();
    expect(await s.contatori()).toEqual({ inviato: 3, in_coda: 2 });
  });

  it('accodaMancanti: mette in coda le schede senza analisi riuscita', async () => {
    const s = await nuovo({ passiPrimaDelFinire: 1 });
    await carica(16); await carica(17);
    expect(await s.accodaMancanti(op)).toBe(2);
    expect(await s.accodaMancanti(op)).toBe(0);                                                  // gia' in coda
  });

  it('configurazione: spenta di default, validazioni', async () => {
    expect(await cfgMod.leggiConfigIa()).toEqual({ attiva: false, url: '', maxTentativi: 6, timeoutS: 30 });
    await expect(cfgMod.salvaConfigIa(op, { attiva: true })).rejects.toThrow(/indirizzo/);
    await expect(cfgMod.salvaConfigIa(op, { url: 'ftp://x' })).rejects.toThrow(/http/);
    await expect(cfgMod.salvaConfigIa(op, { url: 'http://utente:pw@host' })).rejects.toThrow(/utente/);
    await expect(cfgMod.salvaConfigIa(op, { url: 'http://host?x=1' })).rejects.toThrow(/parametri/);
    await expect(cfgMod.salvaConfigIa(op, { maxTentativi: 0 })).rejects.toThrow();
    await expect(cfgMod.salvaConfigIa(op, { timeoutS: 1 })).rejects.toThrow();
    expect(await cfgMod.salvaConfigIa(op, { url: ' http://192.168.1.50:5000/ ', attiva: true, maxTentativi: 3 })).toMatchObject({ url: 'http://192.168.1.50:5000', attiva: true, maxTentativi: 3 });
    expect(cfgMod.validaUrlIa('')).toBe('');
  });

  it('prova della connessione: ok con la salute, o il motivo dell\'errore', async () => {
    const s = await nuovo();
    expect(await s.prova()).toMatchObject({ ok: true, salute: { modello: 'gemma4:e2b' } });
    await ia!.chiudi(); ia = null;
    expect(await s.prova()).toMatchObject({ ok: false });
  });

  it('sincronizza le sigle: le manda subito (anche due volte di fila) o dice il motivo dell\'errore', async () => {
    const s = await nuovo();
    expect(await s.sincronizzaSigle()).toMatchObject({ ok: true, versione: expect.any(String) });
    expect(await s.sincronizzaSigle()).toMatchObject({ ok: true });
    expect(ia!.richieste.filter(r => r.metodo === 'PUT')).toHaveLength(2);
    await ia!.chiudi(); ia = null;
    expect(await s.sincronizzaSigle()).toMatchObject({ ok: false });
  });
});
