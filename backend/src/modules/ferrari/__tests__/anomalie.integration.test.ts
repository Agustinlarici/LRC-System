// Righe toccate a mano, stati nuovi delle sigle, decisioni automatiche e modelli. Serve FERRARI_TEST_DATABASE_URL (vedi service.integration).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { distanza, vicino } from '../anomalie.js';
import { testata, toXlsBuffer } from './fixtures.js';

const URL = process.env.FERRARI_TEST_DATABASE_URL;
type R = (string | number | null)[];

const BASE: R[] = [['CEXS', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI'], ['CEXD', 'ESTRATTORE POST. IN CARBONIO', 'SI'],
  ['BRAD', 'BACK RADAR', 'SI'], ['PAR2', 'SENSORI PARCHEGGIO', 'SI'], ['FCWS', 'SPOILER ANTERIORE', 'SI']];

describe('distanza e vicino', () => {
  it('Levenshtein e codice noto piu\' vicino', () => {
    expect(distanza('CEXS', 'CEXSSS')).toBe(2);
    expect(distanza('CEXS', 'CEXS')).toBe(0);
    expect(vicino('CEXSSS', new Set(['CEXS', 'BRAD']))).toBe('CEXS');
    expect(vicino('ZZZZZZ', new Set(['CEXS', 'BRAD']))).toBeNull();
  });
});

describe.skipIf(!URL)('Righe toccate, stati delle sigle, modelli', () => {
  let svc: typeof import('../service.js');
  let imp: typeof import('../impostazioni.js');
  let mod: typeof import('../modelli.js');
  let des: typeof import('../descrizioni.js');
  let db: typeof import('../../../db/client.js').db;
  const op = { id: 1, username: 'operatore' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    svc = await import('../service.js');
    imp = await import('../impostazioni.js');
    mod = await import('../modelli.js');
    des = await import('../descrizioni.js');
    db = (await import('../../../db/client.js')).db;
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db`TRUNCATE ferrari_sigla_descrizione, ferrari_modello_alias, ferrari_modello_noto, ferrari_dettaglio, ferrari_sigla_proposta, ferrari_sigla, ferrari_termine, ferrari_decisione, ferrari_confronto, ferrari_analisi, ferrari_codice, ferrari_componente, ferrari_audit, ferrari_file RESTART IDENTITY CASCADE`;
  });

  const carica = (commessa: number, righe: R[], modello = 'F999XX') =>
    svc.caricaScheda(op, `${commessa}.xls`, toXlsBuffer([...testata({ commessa, modello }), ['ALLESTIMENTO'], ['ESTERNI'], ...righe]));
  const riga = async (commessa: string, modello = 'F999XX') => (await svc.matrice(modello)).righe.find(r => r.commessa === commessa)!;
  async function conRiferimento() {                       // 4 schede buone: i codici diventano «noti» e il confronto e' possibile
    for (const [i, c] of [800001, 800011, 800012, 800013].entries()) await carica(c + i * 0, BASE);
    for (const c of ['CEXS', 'CEXD', 'BRAD', 'PAR2', 'FCWS']) await imp.impostaSigla(op, c, 'colonna', ['F999XX']);
  }
  const motivi = async (righe: R[]) => {
    await carica(800002, righe);
    return (await riga('800002')).anomalie.map(a => a.motivo).join(' | ');
  };

  it('la scheda buona non da avvisi; un codice scritto male non si perde e si corregge con «e\' CEXS»', async () => {
    await conRiferimento();
    expect((await riga('800001')).anomalie).toEqual([]);
    await carica(800002, [['CEXSSS', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI'], ...BASE.slice(1)]);
    let r = await riga('800002');
    expect(r.anomalie.map(a => [a.codice, a.suggerito])).toEqual([['CEXSSS', 'CEXS']]);
    expect(r.avvisi['CEXS']).toContain('CEXSSS');
    expect(r.celle['CEXS']).toBe('');
    await imp.impostaSigla(op, 'CEXSSS', 'alias', ['F999XX'], 'CEXS');
    r = await riga('800002');
    expect(r.anomalie).toEqual([]);
    expect(r.celle['CEXS']).toBe('Sì');
  });

  it('«non e\' una sigla» chiude l\'avviso', async () => {
    await conRiferimento();
    await carica(800002, [['CEXSSS', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI'], ...BASE.slice(1)]);
    await imp.impostaSigla(op, 'CEXSSS', 'nonsigla', ['F999XX']);
    expect((await riga('800002')).anomalie).toEqual([]);
    expect((await imp.configurazioneSigle()).sigle.find(s => s.codice === 'CEXSSS')!.stati['F999XX']!.stato).toBe('nonsigla');
    expect((await svc.matrice('F999XX')).termini).not.toContain('CEXSSS');
  });

  it('alterazioni tipiche: ognuna da un avviso', async () => {
    await conRiferimento();
    const B = BASE;
    const casi: [string, R[], string][] = [
      ['valore sospetto', [B[0]!, ['CEXD', 'ESTRATTORE POST. IN CARBONIO', 'SII'], ...B.slice(2)], 'valore sospetto'],
      ['valore diverso dal solito', [B[0]!, ['CEXD', 'ESTRATTORE POST. IN CARBONIO', 'NO'], ...B.slice(2)], 'valore diverso dal solito'],
      ['colonne scambiate', [B[0]!, ['CEXD', 'SI', 'ESTRATTORE POST. IN CARBONIO'], ...B.slice(2)], 'colonne scambiate'],
      ['riga spostata', [B[0]!, ['', 'CEXD', 'ESTRATTORE POST. IN CARBONIO', 'SI'], ...B.slice(2)], 'riga spostata'],
      ['riga spostata di due colonne', [B[0]!, ['', '', 'CEXD', 'ESTRATTORE POST. IN CARBONIO', 'SI'], ...B.slice(2)], 'riga spostata'],
      ['codice ripetuto', [...B, ['BRAD', 'BACK RADAR', 'SI']], 'codice ripetuto'],
      ['riga mancante', [B[0]!, ...B.slice(2)], 'riga mancante'],
      ['descrizione diversa', [B[0]!, ['CEXD', 'ESTRATTORE POST. IN CARBONI0', 'SI'], ...B.slice(2)], 'descrizione diversa dal solito'],
      ['descrizione di un altro codice', [['CEXS', 'ESTRATTORE POST. IN CARBONIO', 'SI'], ...B.slice(1)], 'non corrisponde al codice'],
      ['codice con spazio', [['CEX S', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI'], ...B.slice(1)], 'codice non valido'],
      ['colonna spostata', [B[0]!, ['CEXD', '', 'ESTRATTORE POST. IN CARBONIO'], ...B.slice(2)], 'colonna spostata'],
      ['valore mancante', [B[0]!, ['CEXD', 'ESTRATTORE POST. IN CARBONIO', ''], ...B.slice(2)], 'valore mancante'],
    ];
    for (const [nome, righe, atteso] of casi) {
      await db`TRUNCATE ferrari_audit`;                           // la commessa 800002 si ricarica a ogni caso
      expect(await motivi(righe), nome).toContain(atteso);
    }
  });

  it('una scheda uguale alle buone non da avvisi', async () => {
    await conRiferimento();
    expect(await motivi(BASE)).toBe('');
  });

  it('sotto-sigla legata a una voce: compare solo dentro quella voce', async () => {
    await carica(900001, [['LIVR', 'LIVREA SPECIALE', 'SI'], ['LIVR: LIVREA TLM13 SUGLI SPECCHI (VEDI IMMAGINI)'],
      ['LIV2', 'ALTRA LIVREA', 'SI'], ['LIV2: ALTRA LIVREA TLM13 SUL TETTO (VEDI IMMAGINI)']]);
    await imp.impostaSigla(op, 'LIVR', 'colonna', ['F999XX']);
    await imp.impostaSigla(op, 'LIV2', 'colonna', ['F999XX']);
    await imp.impostaSigla(op, 'TLM13', 'sub', ['F999XX']);                        // senza voce: compare in tutte e due
    let r = await riga('900001');
    expect(r.sub['LIVR']?.map(x => x.codice)).toEqual(['TLM13']);
    expect(r.sub['LIV2']?.map(x => x.codice)).toEqual(['TLM13']);
    await imp.impostaSigla(op, 'TLM13', 'sub', ['F999XX'], null, 'LIVR');          // legata a LIVR: solo li'
    const m = await svc.matrice('F999XX');
    expect(m.sigle.find(s => s.codice === 'TLM13')).toMatchObject({ sub: true, padre: 'LIVR' });
    r = m.righe.find(x => x.commessa === '900001')!;
    expect(r.sub['LIVR']?.map(x => x.codice)).toEqual(['TLM13']);
    expect(r.sub['LIV2']).toBeUndefined();
  });

  it('decisione automatica: se almeno 2 altri modelli concordano, la sigla si decide da sola (segnata auto)', async () => {
    await carica(1, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F111AA');
    await carica(2, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F222BB');
    await carica(3, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F333CC');
    await imp.impostaSigla(op, 'LIVR', 'colonna', ['F111AA']);
    expect((await imp.configurazioneSigle()).sigle.find(s => s.codice === 'LIVR')!.stati['F333CC']!.stato).toBe('da_decidere');
    await imp.impostaSigla(op, 'LIVR', 'colonna', ['F222BB']);                       // ora due modelli concordano
    const s = (await imp.configurazioneSigle()).sigle.find(x => x.codice === 'LIVR')!;
    expect(s.stati['F333CC']).toMatchObject({ stato: 'colonna', auto: true });
    await imp.impostaSigla(op, 'LIVR', 'no', ['F333CC']);                            // sempre modificabile
    expect((await imp.configurazioneSigle()).sigle.find(x => x.codice === 'LIVR')!.stati['F333CC']).toMatchObject({ stato: 'no', auto: false });
  });

  it('il parere diverso non basta per decidere da solo; il suggerimento indica cosa hanno deciso gli altri', async () => {
    await carica(1, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F111AA');
    await carica(2, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F222BB');
    await carica(3, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F333CC');
    await imp.impostaSigla(op, 'LIVR', 'colonna', ['F111AA']);
    await imp.impostaSigla(op, 'LIVR', 'no', ['F222BB']);
    const x = (await imp.configurazioneSigle()).sigle.find(s => s.codice === 'LIVR')!.stati['F333CC']!;
    expect(x.stato).toBe('da_decidere');
    expect(x.suggerimento).toContain('colonna in F111AA');
  });

  it('modelli: creare, errore di scrittura (corregge le schede e le prossime), togliere', async () => {
    await carica(1, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F171V5');
    await mod.creaModello(op, 'f171vs');
    let e = await mod.elencoModelli();
    expect(e.noti.map(x => x.modello)).toEqual(['F171VS']);
    expect(e.nuovi[0]).toMatchObject({ modello: 'F171V5', simile_a: 'F171VS' });
    expect(await mod.modelloErroreDi(op, 'F171V5', 'F171VS')).toBe(1);
    expect((await svc.matrice()).modelli.map(m => m.modello)).toEqual(['F171VS']);
    await carica(2, [['LIVR', 'LIVREA SPECIALE', 'SI']], 'F171V5');                   // la prossima si corregge da sola
    expect((await svc.matrice('F171VS')).righe.map(r => r.modello)).toEqual(['F171VS', 'F171VS']);
    e = await mod.elencoModelli();
    expect(e.alias).toEqual([{ sbagliato: 'F171V5', giusto: 'F171VS' }]);
    await mod.togliModello(op, 'F171VS');
    expect((await mod.elencoModelli()).noti).toEqual([]);
    await expect(mod.modelloErroreDi(op, 'F1', 'F1')).rejects.toThrow();
  });

  it('le colonne hanno la descrizione: etichetta «CARROZZERIA BICOLORE» per BIC2', async () => {
    await carica(1, [['BIC2', 'CARROZZERIA BICOLORE', 'NERO DS 1250']]);
    await imp.impostaSigla(op, 'BIC2', 'colonna', ['F999XX']);
    await imp.impostaSigla(op, 'PAROLA', 'colonna', ['F999XX']);                     // una parola cercata non ha descrizione
    const m = await svc.matrice('F999XX');
    expect(m.etichette).toEqual({ BIC2: 'CARROZZERIA BICOLORE' });
  });

  it('«Si» a una sigla che le schede descrivono salva la descrizione e va in colonna', async () => {
    await carica(1, [['BIC2', 'CARROZZERIA BICOLORE', 'NERO DS 1250']]);
    expect((await svc.matrice('F999XX')).etichette).toEqual({});
    await imp.impostaSigla(op, 'BIC2', 'colonna', ['F999XX']);
    expect((await svc.matrice('F999XX')).etichette).toEqual({ BIC2: 'CARROZZERIA BICOLORE' });
  });

  it('leggere un elenco: tab, punto e virgola o spazio; intestazione e righe vuote ignorate', () => {
    const r = des.leggiElenco('SIGLA\tDESCRIZIONE\nBIC2\tCARROZZERIA BICOLORE\n\nCEXS;RIVEST. SOTTOPORTA\nLIVR LIVREA SPECIALE\nbrad\nBIC2\tCARROZZERIA 2 COLORI\n');
    expect(r.voci).toEqual([
      { codice: 'BIC2', descrizione: 'CARROZZERIA 2 COLORI' }, { codice: 'CEXS', descrizione: 'RIVEST. SOTTOPORTA' },
      { codice: 'LIVR', descrizione: 'LIVREA SPECIALE' }, { codice: 'BRAD', descrizione: '' },
    ]);
  });

  it('caricamento massivo: le nuove entrano, le gia\' decise non si toccano, le descrizioni si salvano', async () => {
    await carica(1, [['BIC2', 'CARROZZERIA BICOLORE', 'NERO DS 1250'], ['CEXS', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI']]);
    await imp.impostaSigla(op, 'CEXS', 'no', ['F999XX']);
    const r = await imp.importaElenco(op, 'BIC2\nCEXS\tRIVESTIMENTO\nTLM13\tLIVREA TLM13', 'colonna', '*');
    expect(r).toMatchObject({ totale: 3, nuove: 2, gia_presenti: 1, descrizioni: 2, senza_descrizione: 1 });
    const c = await imp.configurazioneSigle();
    expect(c.sigle.find(x => x.codice === 'CEXS')!.stati['F999XX']!.stato).toBe('no');       // gia' decisa: non si tocca
    expect(c.sigle.find(x => x.codice === 'CEXS')!.descrizione).toBe('RIVESTIMENTO');         // ma la descrizione si
    expect(c.sigle.find(x => x.codice === 'TLM13')).toMatchObject({ tutti: 'colonna', descrizione: 'LIVREA TLM13' });
    await expect(imp.importaElenco(op, '  \n', 'colonna', '*')).rejects.toThrow();
  });

  it('sigla caricata senza descrizione: l\'Excel la ha, la pagina la propone; si accetta o si rifiuta', async () => {
    await carica(1, [['BIC2', 'CARROZZERIA BICOLORE', 'NERO DS 1250'], ['CEXS', 'RIVEST.SOTTOPORTA IN CARBONIO', 'SI']]);
    await imp.importaElenco(op, 'BIC2\nCEXS', 'colonna', '*');
    let c = await imp.configurazioneSigle();
    expect(c.descrizioni_da_confermare).toBe(2);
    expect(c.sigle.find(x => x.codice === 'BIC2')).toMatchObject({ descrizione: null, descrizione_proposta: 'CARROZZERIA BICOLORE' });
    expect((await svc.matrice('F999XX')).descrizioni_proposte?.map(x => x.codice).sort()).toEqual(['BIC2', 'CEXS']);
    expect((await svc.matrice('F999XX')).etichette).toEqual({});                                // finche' non si conferma non compare
    expect(await des.aggiungiDaSchede(op, ['BIC2'])).toBe(1);
    expect(await des.rifiutaDescrizioni(op, ['CEXS'])).toBe(1);
    c = await imp.configurazioneSigle();
    expect(c.descrizioni_da_confermare).toBe(0);
    expect((await svc.matrice('F999XX')).etichette).toEqual({ BIC2: 'CARROZZERIA BICOLORE' });
    await des.salvaDescrizioni(op, [{ codice: 'CEXS', descrizione: 'MIA DESCRIZIONE' }]);      // una descrizione scritta a mano vince sempre, anche dopo un «no»
    expect((await svc.matrice('F999XX')).etichette?.['CEXS']).toBe('MIA DESCRIZIONE');
  });
});
