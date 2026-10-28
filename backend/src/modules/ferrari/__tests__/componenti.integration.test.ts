// Prova di integrazione con PostgreSQL vero (vedi service.integration.test.ts). Svuota le tabelle ferrari_* del database indicato.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { buildBundle } from '../bundle.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;

describe.skipIf(!URL)('Componenti per modello — integrazione con database', () => {
  let svc: typeof import('../service.js');
  let comp: typeof import('../componenti.js');
  let db: typeof import('../../../db/client.js').db;
  const op = { id: 1, username: 'operatore' };
  const sup = { id: 2, username: 'supervisore' };
  const bic2 = ['BIC2            ', 'CARROZZERIA BICOLORE          ', 'NERO DS 1250                  '];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    svc = await import('../service.js');
    comp = await import('../componenti.js');
    db = (await import('../../../db/client.js')).db;
  });
  afterAll(async () => { await db?.end(); });

  beforeEach(async () => {
    await db`TRUNCATE ferrari_comp_proposta, ferrari_comp, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione,
             ferrari_confronto, ferrari_analisi, ferrari_bundle, ferrari_bundle_rifiutato, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
    await svc.caricaScheda(op, 'a.xls', toXlsBuffer([...schedaSemplice(), bic2]));
    await svc.caricaScheda(op, 'b.xls', toXlsBuffer([...schedaPersonalizzata({ commessa: 100002 }), bic2]));
  });

  it('creare, aggiornare, rinominare, eliminare; nome unico senza guardare le maiuscole', async () => {
    const r = await comp.salvaComponente(op, 'f999xx', ' Vano  motore ', ['cel2', 'Allest.', 'cel2']);
    expect(r).toEqual({ nome: 'Vano motore', termini: ['CEL2', 'ALLEST.'] });
    await comp.salvaComponente(op, 'F999XX', 'VANO MOTORE', ['CEL2']);
    expect((await comp.elencoComponenti('F999XX')).componenti).toEqual([{ nome: 'Vano motore', termini: ['CEL2'] }]);
    await comp.salvaComponente(op, 'F999XX', 'Spoiler', ['SPOILER']);
    await comp.salvaComponente(op, 'F999XX', 'Cofano motore', ['CEL2'], 'Vano motore');
    expect((await comp.elencoComponenti('F999XX')).componenti.map(c => c.nome)).toEqual(['Cofano motore', 'Spoiler']);
    await expect(comp.salvaComponente(op, 'F999XX', 'spoiler', ['X'], 'Cofano motore')).rejects.toMatchObject({ status: 400 });
    expect(await comp.eliminaComponente(op, 'F999XX', 'SPOILER')).toBe(1);
    expect(await comp.eliminaComponente(op, 'F999XX', 'Spoiler')).toBe(0);
    await expect(comp.salvaComponente(op, '', 'x', [])).rejects.toMatchObject({ status: 400 });
    expect((await svc.verificaCatenaAudit()).ok).toBe(true);
  });

  it('per modello; si copiano da un modello all\'altro', async () => {
    await comp.salvaComponente(op, 'F999XX', 'Spoiler', ['SPOILER']);
    await comp.salvaComponente(op, 'F999XX', 'Vano motore', ['CEL2']);
    await comp.salvaComponente(op, 'F888YY', 'Spoiler', ['ALTRA']);
    expect(await comp.copiaComponenti(op, 'F999XX', 'F888YY')).toBe(1);
    const e = await db<{ nome: string; termine: string }[]>`SELECT nome, termine FROM ferrari_comp_termine WHERE modello = 'F888YY' ORDER BY nome`;
    expect(e).toEqual([{ nome: 'Spoiler', termine: 'ALTRA' }, { nome: 'Vano motore', termine: 'CEL2' }]);
    await expect(comp.copiaComponenti(op, 'F999XX', 'F999XX')).rejects.toMatchObject({ status: 400 });
  });

  it('cerca commessa + componente: una voce trovata da due termini si mostra una volta; vuoti segnalati', async () => {
    await comp.salvaComponente(op, 'F999XX', 'Vano motore', ['CEL2', 'MOTORE']);
    await comp.salvaComponente(op, 'F999XX', 'Vernice', ['PNT1', 'BIC2']);
    await comp.salvaComponente(op, 'F999XX', 'Sedili', ['SEDILI']);
    const r = await comp.cercaComponenti('F999XX', '100002');
    expect(r.risultati.map(x => x.commessa)).toEqual(['100002']);
    const per = Object.fromEntries(r.risultati[0]!.componenti.map(c => [c.nome, c]));
    expect(per['Vano motore']!.voci.map(v => v.termine)).toEqual(['CEL2']);
    expect(per['Vano motore']!.voci[0]!.voce).toBe('ALLEST.VANO MOTORE IN CARBONIO');
    const vern = Object.fromEntries(per['Vernice']!.voci.map(v => [v.termine, v.testo]));
    expect(vern['BIC2']).toBe('NERO DS 1250');
    expect(vern['PNT1']).toMatch(/^Extra campionario — VERNICIARE VETTURA/);
    expect(per['Sedili']!.vuoto).toBe(true);
    const solo = await comp.cercaComponenti('F999XX', '', 'vano MOTORE');
    expect(new Set(solo.risultati.flatMap(x => x.componenti.map(c => c.nome)))).toEqual(new Set(['Vano motore']));
    expect(new Set(solo.risultati.map(x => x.commessa))).toEqual(new Set(['100001', '100002']));
  });

  it('il riassunto della PC IA e il «da rivedere» si vedono anche nella ricerca per componente', async () => {
    await comp.salvaComponente(op, 'F999XX', 'Scudetto', ['LLOG']);
    const { chiaveTesto } = await import('../matrice.js');
    const secret = await svc.getSecret();
    const zip = (dettaglio: string, stato: string) => buildBundle({
      tipo: 'sigle', producer: 'ai', secret, knowledgeVersion: 0,
      files: { 'sigle.json': JSON.stringify({ sigle: [], dettagli: [
        { commessa: '100002', codice: 'LLOG', chiave: chiaveTesto('SCUDETTO LASERIZZATO COME DA IMMAGINE.'), dettaglio, manuale: false, stato }] }) },
    }).zip;
    const voce = async () => (await comp.cercaComponenti('F999XX', '100002', 'Scudetto')).risultati[0]!.componenti[0]!.voci[0]!;
    await svc.importaSigle(sup, 's1.zip', zip('Scudetto laserizzato', 'ok'));
    expect(await voce()).toMatchObject({ testo: 'Sì — Scudetto laserizzato', rivedere: false });
    await svc.importaSigle(sup, 's2.zip', zip('', 'rivedere'));
    expect(await voce()).toMatchObject({ rivedere: true });
  });

  it('suggerimenti: sigle del modello per codice o descrizione, piu\' la parola libera', async () => {
    const s = await comp.suggerisciTermini('F999XX', 'motore');
    expect(s).toContainEqual({ termine: 'CEL2', nome: 'ALLEST.VANO MOTORE IN CARBONIO', tipo: 'sigla' });
    expect(s.at(-1)).toMatchObject({ tipo: 'parola', termine: 'MOTORE' });
    expect(await comp.suggerisciTermini('F999XX', 'm')).toEqual([]);
  });

  it('si sincronizza come proposte: nuove o in conflitto, accettate o rifiutate da una persona', async () => {
    await comp.salvaComponente(op, 'F999XX', 'Spoiler', ['SPOILER', 'FCWS']);
    const { zip } = await svc.esportaSigle(op);
    await db`TRUNCATE ferrari_comp CASCADE`;                                  // «l'altro programma»: senza componenti
    expect((await svc.importaSigle(sup, 'sigle.zip', zip)).componenti).toBe(1);
    expect((await comp.elencoComponenti('F999XX')).componenti).toEqual([]);          // non si applica da solo
    expect((await comp.elencoComponenti('F999XX')).proposte[0]).toMatchObject({ nome: 'Spoiler', termini: ['SPOILER', 'FCWS'], conflitto: false });
    expect(await comp.risolviProposteComponenti(sup, true, 'F999XX', 'spoiler')).toBe(1);
    expect((await comp.elencoComponenti('F999XX')).componenti).toEqual([{ nome: 'Spoiler', termini: ['SPOILER', 'FCWS'] }]);
    expect((await svc.importaSigle(sup, 's.zip', zip)).componenti).toBe(0);            // uguale: niente da proporre
    await comp.salvaComponente(op, 'F999XX', 'Spoiler', ['SPOILER']);
    await svc.importaSigle(sup, 's2.zip', zip);
    const p = (await comp.elencoComponenti('F999XX')).proposte;
    expect(p).toHaveLength(1);
    expect(p[0]!.conflitto).toBe(true);
    expect(await comp.risolviProposteComponenti(sup, false)).toBe(1);                   // rifiuta tutte
    expect((await comp.elencoComponenti('F999XX')).componenti[0]!.termini).toEqual(['SPOILER']);
    expect((await svc.verificaCatenaAudit()).ok).toBe(true);
  });
});
