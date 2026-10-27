// Prova di integrazione con un PostgreSQL vero (migrazioni applicate). Si salta se manca la variabile:
//   FERRARI_TEST_DATABASE_URL=postgres://utente@localhost:5432/lrc_test npx vitest run service.integration
// ATTENZIONE: svuota le tabelle ferrari_* del database indicato. Mai su produzione.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import PizZip from 'pizzip';
import { buildBundle } from '../bundle.js';
import { chiaveTesto } from '../matrice.js';
import { analizzaVm } from '../analyzer.js';
import type { Canonico } from '../types.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';
import { iaPerfetta } from './testutil.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;
const ids = (rows: unknown[]) => (rows as { id: number }[]).map(r => r.id);

describe.skipIf(!URL)('Schede Ferrari — integrazione con database', () => {
  let svc: typeof import('../service.js');
  let db: typeof import('../../../db/client.js').db;
  const op = { id: 1, username: 'operatore' };
  const sup = { id: 2, username: 'supervisore' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    svc = await import('../service.js');
    db = (await import('../../../db/client.js')).db;
  });

  afterAll(async () => { await db?.end(); });

  beforeEach(async () => {
    await db`TRUNCATE ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_bundle, ferrari_bundle_rifiutato,
             ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    await db`UPDATE ferrari_config SET value = '100' WHERE key = 'sampling_pct'`;
    await db`UPDATE ferrari_config SET value = 'true' WHERE key = 'four_eyes'`;
    await db`UPDATE ferrari_config SET value = '0' WHERE key = 'conoscenza_versione'`;
  });

  const righeComplete = () => schedaSemplice().filter(r => !String(r[0]).startsWith('BOLN'));
  const xls = (rows: ReturnType<typeof schedaSemplice>) => toXlsBuffer(rows);

  /** Simula la PC IA: legge il to-ai, produce un from-ai firmato con risposta "perfetta". */
  async function rispostaIa(toAi: Buffer, opts: { secret?: string; inReplyTo?: string; batchId?: string; mutate?: (r: ReturnType<typeof iaPerfetta>) => void } = {}) {
    const secret = opts.secret ?? await svc.getSecret();
    const z = new PizZip(toAi);
    const man = JSON.parse(z.file('manifest.json')!.asText());
    const k = JSON.parse(z.file('knowledge/dictionary.json')!.asText());
    const files: Record<string, string> = {};
    for (const f of man.files as { path: string }[]) {
      const m = /^normalized\/(f\d+)\.json$/.exec(f.path);
      if (!m) continue;
      const canonico = JSON.parse(z.file(f.path)!.asText()) as Canonico;
      const vm = analizzaVm(canonico, k);
      const ia = iaPerfetta(vm, { fileId: m[1], sha256: canonico.source.sha256, knowledge: k.versione });
      opts.mutate?.(ia);
      files[`results/${m[1]}.json`] = JSON.stringify(ia);
    }
    return buildBundle({
      tipo: 'from-ai', producer: 'ai', secret, files, knowledgeVersion: k.versione,
      inReplyTo: opts.inReplyTo ?? man.bundle_id, batchId: opts.batchId ?? man.batch_id,
    }).zip;
  }

  it('caricamento: salva l\'originale, analizza con la VM e mette la scheda in attesa della IA', async () => {
    const buf = xls(righeComplete());
    const r = await svc.caricaScheda(op, 'a.xls', buf);
    expect(r).toMatchObject({ stato: 'IN_ATTESA_IA', duplicato: false });
    const d = await svc.dettaglioFile(r.id);
    expect(d.file.modello).toBe('F999XX');
    expect(d.file.commessa).toBe('100001');
    expect(d.vm).not.toBeNull();
    const orig = await svc.scaricaOriginale(r.id);
    expect(Buffer.compare(orig.original, buf)).toBe(0);
  });

  it('lo stesso file due volte è un duplicato e non crea nulla', async () => {
    const buf = xls(righeComplete());
    const a = await svc.caricaScheda(op, 'a.xls', buf);
    const b = await svc.caricaScheda(op, 'altro-nome.xls', buf);
    expect(b).toMatchObject({ id: a.id, duplicato: true });
    const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM ferrari_file`;
    expect(n).toBe(1);
  });

  it('un file illeggibile finisce in quarantena', async () => {
    const r = await svc.caricaScheda(op, 'rotto.xls', Buffer.from('non è un excel'));
    expect(r.stato).toBe('QUARANTENA');
    expect(r.motivo).toMatch(/Excel/);
  });

  it('una nuova versione della stessa commessa sostituisce la precedente', async () => {
    const a = await svc.caricaScheda(op, 'v1.xls', xls(righeComplete()));
    const rows2 = righeComplete();
    rows2.push(['CEXD', 'ESTRATTORE', 'SI']);
    const b = await svc.caricaScheda(op, 'v2.xls', xls(rows2));
    expect(b.sostituisce).toEqual([a.id]);
    expect((await svc.dettaglioFile(a.id)).file.stato).toBe('SOSTITUITO');
    expect((await svc.dettaglioFile(a.id)).file.sostituito_da).toBe(b.id);
  });

  it('stessa commessa ma variante diversa: non si sostituisce, si segnala', async () => {
    const a = await svc.caricaScheda(op, 'v1.xls', xls(righeComplete()));
    const altra = toXlsBuffer([...schedaSemplice({ variante: 555 }), ['CXXX', 'Altro', 'SI']]);
    const b = await svc.caricaScheda(op, 'altra.xls', altra);
    expect(b.sostituisce).toEqual([]);
    expect(b.stessa_commessa).toEqual([a.id]);
    expect((await svc.dettaglioFile(a.id)).file.stato).toBe('IN_ATTESA_IA');
  });

  it('rimandare alla IA: la scheda torna in attesa e le decisioni si riportano alla nuova risposta', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    await svc.importaRisultatoIa(sup, 'x.zip', await rispostaIa(to.zip));
    let d = await svc.dettaglioFile(id);
    const cod = d.confronto!.risultato.items.find((i: { tipo: string }) => i.tipo === 'codice_ignoto');
    await svc.registraDecisione(op, id, { rev: d.file.rev, item_key: cod.key, decisione: 'ignora' });

    await svc.reinviaAllaIa(op, id);
    expect((await svc.dettaglioFile(id)).file.stato).toBe('IN_ATTESA_IA');
    const to2 = await svc.creaPacchettoToAi(op);
    expect(to2.schede).toBe(1);
    await svc.importaRisultatoIa(sup, 'y.zip', await rispostaIa(to2.zip));
    d = await svc.dettaglioFile(id);
    expect(d.file.stato).toBe('IN_REVISIONE');
    expect((d.decisioni as unknown as { item_key: string }[]).some(x => x.item_key === cod.key)).toBe(true);
  });

  it('flusso completo: IA → revisione → proposte approvate con doppia firma → validazione', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    expect(to.schede).toBe(1);
    expect((await svc.dettaglioFile(id)).file.inviato_ia_at).not.toBeNull();

    // La PC IA risponde
    const imp = await svc.importaRisultatoIa(sup, 'from-ai.zip', await rispostaIa(to.zip));
    expect(imp.report).toEqual([{ file_id: `f${id}`, id, esito: 'AMBRA', stato: 'IN_REVISIONE' }]);

    // Senza conoscenza approvata ogni codice e ogni parola è ignota
    let d = await svc.dettaglioFile(id);
    const items = d.confronto!.risultato.items;
    expect(items.some((i: { tipo: string }) => i.tipo === 'codice_ignoto')).toBe(true);

    // L'operatore propone i codici (ambito TUTTI) e le parole
    const codici = items.filter((i: { tipo: string }) => i.tipo === 'codice_ignoto');
    let rev = d.file.rev;
    for (const it of codici) {
      const r = await svc.registraDecisione(op, id, {
        rev, item_key: it.key, decisione: 'correggi', valore_dopo: { significato: `significato ${it.codice}` },
        proposta: { tipo: 'codice', ambito: 'TUTTI', codice: it.codice, significato: `significato ${it.codice}` },
      });
      rev = r.rev;
    }
    const desc = items.filter((i: { tipo: string }) => i.tipo === 'sconosciuto_vm');
    for (const it of desc) {
      const parole: string[] = it.vm.residuo;
      const r = await svc.registraDecisione(op, id, {
        rev, item_key: it.key, decisione: 'correggi', valore_dopo: { tipo: 'COLORE', valore: parole[0], frammento: parole[0] },
        proposta: { tipo: 'componente', ambito: 'MODELLO', pattern: parole.join(' '), comp_tipo: 'NEUTRO', esempio_testo: parole.join(' ') },
      });
      rev = r.rev;
    }

    // Chi ha proposto non può approvare
    const prop = await svc.listaConoscenza('proposta');
    await expect(svc.decidiConoscenza(op, 'codice', ids(prop.codici), 'approva', null))
      .rejects.toMatchObject({ status: 403 });

    // Il supervisore approva
    const ap = await svc.decidiConoscenza(sup, 'codice', ids(prop.codici), 'approva', null);
    expect(ap.versione).toBe(1);
    const ap2 = await svc.decidiConoscenza(sup, 'componente', ids(prop.componenti), 'approva', null);
    expect(ap2.versione).toBe(2);

    // Nuova analisi con la conoscenza aggiornata: la IA era alla versione 0, la VM alla 2.
    // La differenza di versione è solo un'informazione: il contenuto coincide, quindi non resta nulla da rivedere.
    const rian = await svc.rianalizza(sup, id);
    expect(rian).toMatchObject({ esito: 'VERDE', stato: 'IN_REVISIONE' });   // campione al 100 %: serve comunque una conferma
    d = await svc.dettaglioFile(id);
    expect(d.confronto!.risultato.items).toEqual([]);
    expect(d.confronto!.risultato.versioni).toEqual({ vm: 2, ia: 0 });

    d = await svc.dettaglioFile(id);
    expect(d.file.campione).toBe(true);
    const ok = await svc.validaScheda(op, id, d.file.rev);
    expect(ok.stato).toBe('VALIDATO');
    d = await svc.dettaglioFile(id);
    expect(d.file.dati_validati.validazione).toBe('umana');
    expect(d.file.dati_validati.opzioni).toHaveLength(6);

    const verifica = await svc.verificaCatenaAudit();
    expect(verifica.ok).toBe(true);
    expect(verifica.righe).toBeGreaterThan(10);
  });

  it('con campionamento 0 % una scheda VERDE si accetta in automatico', async () => {
    // conoscenza minima: tutti i codici e le parole della scheda
    const base = righeComplete();
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(base));
    const d0 = await svc.dettaglioFile(id);
    const vm = d0.vm!.risultato;
    for (const o of vm.opzioni) {
      await svc.proponiConoscenzaDiretta(op, { tipo: 'codice', ambito: 'TUTTI', codice: o.codice, significato: o.descrizione });
      for (const u of o.unita) for (const r of u.residuo) {
        await svc.proponiConoscenzaDiretta(op, { tipo: 'componente', ambito: 'TUTTI', pattern: r.testo, comp_tipo: 'NEUTRO' });
      }
    }
    const prop = await svc.listaConoscenza('proposta');
    await svc.decidiConoscenza(sup, 'codice', ids(prop.codici), 'approva', null);
    await svc.decidiConoscenza(sup, 'componente', ids(prop.componenti), 'approva', null);
    await svc.aggiornaConfig(sup, { sampling_pct: 0 });

    const to = await svc.creaPacchettoToAi(op);
    const imp = await svc.importaRisultatoIa(sup, 'x.zip', await rispostaIa(to.zip));
    expect(imp.report[0]).toMatchObject({ esito: 'VERDE', stato: 'ACCETTATO_AUTO' });
    const d = await svc.dettaglioFile(id);
    expect(d.file.dati_validati.validazione).toBe('automatica');
  });

  it('lo stesso pacchetto della IA non si importa due volte', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    const risposta = await rispostaIa(to.zip);
    await svc.importaRisultatoIa(sup, 'x.zip', risposta);
    await expect(svc.importaRisultatoIa(sup, 'x.zip', risposta)).rejects.toMatchObject({ status: 400 });
    const l = await svc.listaBundle();
    expect(l.rifiutati[0].motivo).toMatch(/già importato/);
  });

  it('pacchetto firmato con un altro segreto → rifiutato e registrato', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    await expect(svc.importaRisultatoIa(sup, 'x.zip', await rispostaIa(to.zip, { secret: 'segreto-sbagliato' })))
      .rejects.toMatchObject({ status: 400 });
    expect((await svc.listaBundle()).rifiutati[0].motivo).toMatch(/Firma non valida/);
    expect((await svc.dettaglioFile(1)).file.stato).toBe('IN_ATTESA_IA');
  });

  it('risposta a un invio sconosciuto → rifiutata', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    const z = await rispostaIa(to.zip, { inReplyTo: '11111111-1111-4111-8111-111111111111' });
    await expect(svc.importaRisultatoIa(sup, 'x.zip', z)).rejects.toMatchObject({ status: 400 });
  });

  it('risultato riferito a un altro file (hash diverso) → scartato per quella scheda', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const to = await svc.creaPacchettoToAi(op);
    const z = await rispostaIa(to.zip, { mutate: r => { r.source_sha256 = 'a'.repeat(64); } });
    const imp = await svc.importaRisultatoIa(sup, 'x.zip', z);
    expect(imp.report[0]!.errore).toMatch(/hash/);
    expect((await svc.dettaglioFile(1)).file.stato).toBe('IN_ATTESA_IA');
  });

  it('schede non rientrate nella risposta risultano "mancanti"', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await svc.caricaScheda(op, 'b.xls', xls(schedaPersonalizzata({ commessa: 100002 })));
    const to = await svc.creaPacchettoToAi(op);
    const z = new PizZip(await rispostaIa(to.zip));
    // la IA ha risposto solo per la prima scheda: ricostruiamo il pacchetto
    const files: Record<string, string> = {};
    const man = JSON.parse(z.file('manifest.json')!.asText());
    const f1 = man.files.find((f: { path: string }) => f.path === 'results/f1.json');
    files['results/f1.json'] = z.file(f1.path)!.asText();
    const parziale = buildBundle({ tipo: 'from-ai', producer: 'ai', secret: await svc.getSecret(), files,
      knowledgeVersion: 0, inReplyTo: man.in_reply_to, batchId: man.batch_id }).zip;
    const imp = await svc.importaRisultatoIa(sup, 'p.zip', parziale);
    expect(imp.mancanti).toEqual([2]);
  });

  it('revisione senza IA: sempre ROSSO, richiede motivazione, mai automatica', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const r = await svc.revisioneSenzaIa(op, id);
    expect(r).toMatchObject({ esito: 'ROSSO', stato: 'IN_REVISIONE' });
    const d = await svc.dettaglioFile(id);
    expect(d.file.ia_stato).toBe('assente');
    const it = d.confronto!.risultato.items.find((i: { tipo: string }) => i.tipo === 'ia_assente');
    await expect(svc.registraDecisione(op, id, { rev: d.file.rev, item_key: it.key, decisione: 'conferma_vm' }))
      .rejects.toMatchObject({ status: 400 });
    await svc.registraDecisione(op, id, { rev: d.file.rev, item_key: it.key, decisione: 'conferma_vm', motivo: 'IA non disponibile' });
  });

  it('una rianalisi non fa perdere le decisioni già prese sugli stessi elementi', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await svc.revisioneSenzaIa(op, id);
    let d = await svc.dettaglioFile(id);
    const it = d.confronto!.risultato.items.find((i: { tipo: string }) => i.tipo === 'ia_assente');
    await svc.registraDecisione(op, id, { rev: d.file.rev, item_key: it.key, decisione: 'conferma_vm', motivo: 'IA spenta' });
    const primo = d.confronto!.id;

    await svc.rianalizza(sup, id);
    d = await svc.dettaglioFile(id);
    expect(d.confronto!.id).toBeGreaterThan(primo);
    const riportata = (d.decisioni as unknown as { item_key: string }[]).find(x => x.item_key === it.key);
    expect(riportata).toMatchObject({ decisione: 'conferma_vm', motivo: 'IA spenta', username: 'operatore' });
    // Solo gli item che esistono ancora nel nuovo confronto ricevono la decisione
    expect(d.decisioni.length).toBe(1);
  });

  it('blocco ottimistico: una decisione con "rev" vecchio viene rifiutata', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await svc.revisioneSenzaIa(op, id);
    const d = await svc.dettaglioFile(id);
    const it = d.confronto!.risultato.items.find((i: { tipo: string }) => i.tipo === 'ia_assente');
    await svc.registraDecisione(op, id, { rev: d.file.rev, item_key: it.key, decisione: 'conferma_vm', motivo: 'ok' });
    await expect(svc.registraDecisione(sup, id, { rev: d.file.rev, item_key: it.key, decisione: 'conferma_vm', motivo: 'ok' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('non si può validare con elementi ancora aperti', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await svc.revisioneSenzaIa(op, id);
    const d = await svc.dettaglioFile(id);
    await expect(svc.validaScheda(op, id, d.file.rev)).rejects.toMatchObject({ status: 409 });
  });

  it('i riferimenti alle immagini accettano solo "verificato_immagini"', async () => {
    const { id } = await svc.caricaScheda(op, 'p.xls', xls(schedaPersonalizzata()));
    await svc.revisioneSenzaIa(op, id);
    const d = await svc.dettaglioFile(id);
    const img = d.confronto!.risultato.items.find((i: { tipo: string }) => i.tipo === 'immagini');
    await expect(svc.registraDecisione(op, id, { rev: d.file.rev, item_key: img.key, decisione: 'ignora' }))
      .rejects.toMatchObject({ status: 400 });
    await svc.registraDecisione(op, id, { rev: d.file.rev, item_key: img.key, decisione: 'verificato_immagini' });
  });

  it('rifiuto: serve il motivo e la scheda si chiude', async () => {
    const { id } = await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    const rev = (await svc.dettaglioFile(id)).file.rev;
    await expect(svc.rifiutaScheda(op, id, rev, '  ')).rejects.toMatchObject({ status: 400 });
    expect((await svc.rifiutaScheda(op, id, rev, 'Ferrari ha mandato il file sbagliato')).stato).toBe('RIFIUTATO');
    await expect(svc.rifiutaScheda(op, id, rev + 1, 'di nuovo')).rejects.toMatchObject({ status: 409 });
  });

  it('storico: sola aggiunta (UPDATE/DELETE bloccati dal database) e catena valida', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await expect(db`UPDATE ferrari_audit SET azione = 'x'`).rejects.toThrow(/sola aggiunta/);
    await expect(db`DELETE FROM ferrari_audit`).rejects.toThrow(/sola aggiunta/);
    await expect(db`DELETE FROM ferrari_file`).rejects.toThrow(/sola aggiunta/);
    await expect(db`UPDATE ferrari_file SET sha256 = ${'b'.repeat(64)}`).rejects.toThrow(/immutabili/);
    expect((await svc.verificaCatenaAudit()).ok).toBe(true);
  });

  it('la catena di audit si accorge di una manomissione diretta nel database', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await db`ALTER TABLE ferrari_audit DISABLE TRIGGER trg_ferrari_audit_append`;
    try {
      await db`UPDATE ferrari_audit SET username = 'qualcun altro' WHERE id = 1`;
      expect((await svc.verificaCatenaAudit()).ok).toBe(false);
    } finally {
      await db`ALTER TABLE ferrari_audit ENABLE TRIGGER trg_ferrari_audit_append`;
    }
  });

  it('tabella commesse: all\'inizio chiede, poi per modello o per tutti, valore trovato, ricerca', async () => {
    const bic2 = ['BIC2            ', 'CARROZZERIA BICOLORE          ', 'NERO DS 1250                  '];
    await svc.caricaScheda(op, 'a.xls', toXlsBuffer([...schedaSemplice(), bic2]));
    await svc.caricaScheda(op, 'b.xls', toXlsBuffer([...schedaPersonalizzata({ commessa: 100002 }), bic2]));
    await svc.caricaScheda(op, 'c.xls', toXlsBuffer([...schedaSemplice({ commessa: 100003, modello: 'F888YY' }), bic2]));

    let m = await svc.matrice();
    expect(m.modelli.map((x: { modello: string }) => x.modello).sort()).toEqual(['F888YY', 'F999XX']);
    m = await svc.matrice('F999XX');
    expect(m.termini).toEqual([]);                                             // niente colonne finché non si decide
    const bic = m.nuove.find((n: { codice: string }) => n.codice === 'BIC2')!;
    expect(bic).toMatchObject({ nome: 'CARROZZERIA BICOLORE', esempio: 'NERO DS 1250' });

    await svc.decidiSigla(op, 'f999xx', ' bic2 ', true, false);               // sì, solo per F999XX
    await svc.decidiSigla(op, '', 'CEL2', true, true);                         // sì, per tutti i modelli
    await svc.decidiSigla(op, 'F999XX', 'EXTC', false, false);                 // no, per F999XX
    await svc.decidiSigla(op, 'F999XX', 'llog', true, false);
    await expect(svc.decidiSigla(op, 'F999XX', '   ', true, false)).rejects.toMatchObject({ status: 400 });
    await expect(svc.decidiSigla(op, '', 'X', true, false)).rejects.toMatchObject({ status: 400 });

    m = await svc.matrice('F999XX');
    expect(m.termini).toEqual(['BIC2', 'CEL2', 'LLOG']);
    const nuove = m.nuove.map((n: { codice: string }) => n.codice);
    expect(nuove).not.toContain('BIC2');
    expect(nuove).not.toContain('EXTC');                                       // «non va»: non si chiede più
    expect(m.righe.map((r: { commessa: string }) => r.commessa).sort()).toEqual(['100001', '100002']);
    const r2 = m.righe.find((r: { commessa: string }) => r.commessa === '100002')!;
    expect(r2.celle).toEqual({ BIC2: 'NERO DS 1250', CEL2: 'Sì', LLOG: 'Sì — SCUDETTO LASERIZZATO COME DA IMMAGINE.' });
    expect((await svc.matrice('F999XX', '100002')).righe).toHaveLength(1);

    const altro = await svc.matrice('F888YY');
    expect(altro.termini).toEqual(['CEL2']);                                   // quella per tutti vale anche qui
    expect(altro.nuove.map((n: { codice: string }) => n.codice)).toContain('BIC2');   // per F888YY è ancora da decidere

    await svc.decidiSigla(op, 'F999XX', 'CEL2', false, false);                 // il modello prevale su «tutti»
    expect((await svc.matrice('F999XX')).termini).toEqual(['BIC2', 'LLOG']);
    expect((await svc.matrice('F888YY')).termini).toEqual(['CEL2']);

    expect(await svc.togliDecisione(op, 'F999XX', 'bic2', false)).toBe(1);     // torna «da decidere»
    expect((await svc.matrice('F999XX')).nuove.map((n: { codice: string }) => n.codice)).toContain('BIC2');

    const n = await svc.tutteNo(op, 'F888YY');
    expect(n).toBeGreaterThan(0);
    expect((await svc.matrice('F888YY')).nuove).toEqual([]);
    expect((await svc.verificaCatenaAudit()).ok).toBe(true);
  });

  it('sigle: la VM esporta, l\'altro programma propone, una persona accetta o rifiuta', async () => {
    await svc.decidiSigla(op, 'F999XX', 'BIC2', true, false);
    await svc.decidiSigla(op, '', 'CEL2', true, true);
    const { zip, voci } = await svc.esportaSigle(op);
    expect(voci).toBe(2);

    // «L'altro programma» = lo stesso database senza le decisioni: tutto diventa proposta
    await db`TRUNCATE ferrari_sigla`;
    expect(await svc.importaSigle(sup, 'sigle.zip', zip)).toEqual({ nuove: 2, conflitti: 0, uguali: 0, dettagli: 0 });
    expect((await svc.matrice()).termini).toEqual([]);                          // non si applica da solo
    expect((await svc.proposteSigle()).map((p: { codice: string }) => p.codice).sort()).toEqual(['BIC2', 'CEL2']);

    await svc.decidiSigla(op, 'F999XX', 'BIC2', false, false);                  // decisione locale opposta
    expect(await svc.importaSigle(sup, 'sigle.zip', zip)).toEqual({ nuove: 1, conflitti: 1, uguali: 0, dettagli: 0 });
    const conf = (await svc.proposteSigle()).find((p: { codice: string }) => p.codice === 'BIC2')!;
    expect(conf.conflitto).toBe(true);

    expect(await svc.risolviProposte(sup, true, 'F999XX', 'BIC2')).toBe(1);
    expect(await svc.risolviProposte(sup, false, '*', 'CEL2')).toBe(1);        // rifiutata
    expect((await svc.proposteSigle())).toHaveLength(0);
    const rows = await db<{ modello: string; codice: string; va: boolean }[]>`SELECT modello, codice, va FROM ferrari_sigla`;
    expect(rows).toEqual([{ modello: 'F999XX', codice: 'BIC2', va: true }]);

    await svc.importaSigle(sup, 'sigle.zip', zip);
    expect(await svc.risolviProposte(sup, true)).toBe(1);                       // «accetta tutte»
    expect((await svc.verificaCatenaAudit()).ok).toBe(true);
  });

  it('dettagli: il riassunto della PC IA arriva nel pacchetto delle sigle e si vede in cella solo se il testo e\' lo stesso', async () => {
    await svc.caricaScheda(op, 'p.xls', xls(schedaPersonalizzata({ commessa: 100077, modello: 'F999XX' })));
    await svc.decidiSigla(op, 'F999XX', 'LLOG', true, false);
    const testo = 'SCUDETTO LASERIZZATO COME DA IMMAGINE.';
    const secret = await svc.getSecret();
    const pacchetto = (chiave: string, createdAt?: string) => buildBundle({
      tipo: 'sigle', producer: 'ai', secret, knowledgeVersion: 0, createdAt,
      files: { 'sigle.json': JSON.stringify({ sigle: [], dettagli: [
        { commessa: '100077', codice: 'LLOG', chiave, dettaglio: 'Scudetto laserizzato (scritto a mano)', manuale: true },
        { commessa: '100077', codice: 'LLOG', chiave: 'non-valida', dettaglio: 'x' },
      ] }) },
    }).zip;
    expect((await svc.importaSigle(sup, 's.zip', pacchetto(chiaveTesto(testo))))).toMatchObject({ dettagli: 1 });
    const cella = (await svc.matrice('F999XX')).righe.find((r: { commessa: string }) => r.commessa === '100077')!.celle['LLOG'];
    expect(cella).toBe('Sì — Scudetto laserizzato (scritto a mano)');
    // testo cambiato nella scheda: il riassunto vecchio non si usa
    await svc.importaSigle(sup, 's2.zip', pacchetto(chiaveTesto('TESTO DIVERSO')));
    const cella2 = (await svc.matrice('F999XX')).righe.find((r: { commessa: string }) => r.commessa === '100077')!.celle['LLOG'];
    expect(cella2).toContain('COME DA IMMAGINE');
    // un pacchetto piu' vecchio non sovrascrive uno piu' nuovo
    await svc.importaSigle(sup, 's3.zip', pacchetto(chiaveTesto(testo), '2020-01-01T00:00:00.000Z'));
    const cella3 = (await svc.matrice('F999XX')).righe.find((r: { commessa: string }) => r.commessa === '100077')!.celle['LLOG'];
    expect(cella3).toContain('COME DA IMMAGINE');
  });

  it('sigle: pacchetto con firma sbagliata o di un altro tipo si rifiuta', async () => {
    const { zip } = buildBundle({ tipo: 'sigle', producer: 'ai', secret: 'segreto-sbagliato', knowledgeVersion: 0,
      files: { 'sigle.json': '{"sigle":[]}' } });
    await expect(svc.importaSigle(sup, 'x.zip', zip)).rejects.toMatchObject({ status: 400 });
    expect((await svc.listaBundle()).rifiutati[0].motivo).toMatch(/Firma non valida/);
  });

  it('ricerca e filtri', async () => {
    await svc.caricaScheda(op, 'a.xls', xls(righeComplete()));
    await svc.caricaScheda(op, 'b.xls', xls(schedaPersonalizzata({ commessa: 100002, modello: 'F888YY' })));
    expect((await svc.listaFile({ modello: 'F888YY' })).totale).toBe(1);
    expect((await svc.listaFile({ codice: 'DEDI' })).totale).toBe(1);
    expect((await svc.listaFile({ q: '100001' })).righe[0]!.commessa).toBe('100001');
    const c = await svc.cerca('TAILOR');
    expect(c.file.length).toBe(1);
    expect((await svc.riepilogo()).stati).toMatchObject({ IN_ATTESA_IA: 2 });
  });
});
