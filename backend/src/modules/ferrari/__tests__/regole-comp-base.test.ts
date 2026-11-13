import { describe, expect, it } from 'vitest';
import { applicaRegole, fattiDaScheda, RegolaCompSchema, sigleCitate, type RegolaComp } from '../regole-comp-base.js';
import type { Canonico, Opzione } from '../types.js';

const opz = (codice: string, valore = 'SI', testi: string[] = [], descrizione = `DESCRIZIONE ${codice}`): Opzione => ({
  riga: 1, sezione: null, codice, descrizione, valore, nota: '', blocchi_testo: testi.map((testo, n) => ({ n, righe: [n], testo })),
});
const scheda = (opzioni: Opzione[], modello = 'F171VS'): Canonico => ({
  schema_version: 1, source: { filename: 'x', sha256: 'x', format: 'xlsx', sheet: 'x' },
  header: { commessa: '300001', variante: { codice: null, revisione: null, data: null },
    tipo_matricola: { raw: null, modello, versione: null, mercato_codice: null, mercato_sigla: null, matricola: null, progressivo: null },
    destinazione: { paese: 'CINA', codice_mercato: null, raw_mrkt: null }, telaio: null },
  opzioni, anomalie: [], celle: [],
});
let n = 0;
const regola = (r: Partial<RegolaComp> & Pick<RegolaComp, 'azioni'>): RegolaComp =>
  ({ id: ++n, nome: `regola ${n}`, attiva: true, modello: '*', logica: 'tutte', condizioni: [], eccezioni: [], ferma: false, ...r });
const fisso = (componente: string, testo: string) => ({ componente, valore: { tipo: 'fisso' as const, testo } });
const sig = (componente: string, s: string) => ({ componente, valore: { tipo: 'sigla' as const, sigla: s } });
const testi = (r: ReturnType<typeof applicaRegole>, comp: string) => (r.celle[comp] ?? []).map(v => v.testo);

describe('regole dei componenti', () => {
  it('«se dice AS06 aggiungi in paraurti e minigonne»', () => {
    const r = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS06' }], azioni: [sig('Paraurti', 'AS06'), sig('Minigonne', 'AS06')] });
    const ris = applicaRegole([r], fattiDaScheda(scheda([opz('AS06', 'SI', [], 'LIVREA SU PARAURTI ANTERIORE')])));
    expect(testi(ris, 'Paraurti')).toEqual(['AS06']);
    expect(testi(ris, 'Minigonne')).toEqual(['AS06']);
    expect(ris.celle['Paraurti']![0]!.descrizione).toBe('LIVREA SU PARAURTI ANTERIORE');
    expect(ris.regole[0]!.esito).toBe('scattata');
    expect(testi(applicaRegole([r], fattiDaScheda(scheda([opz('AS07')]))), 'Paraurti')).toEqual([]);          // senza AS06 non scatta
  });

  it('«se dice AS06 e AS07 aggiungi in paraurti AS06»: la regola specifica con «ferma» evita la generica', () => {
    const specifica = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS06' }, { tipo: 'presente', sigla: 'AS07' }], azioni: [sig('Paraurti', 'AS06')], ferma: true });
    const generica = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS06' }], azioni: [sig('Paraurti', 'AS06'), sig('Minigonne', 'AS06')] });
    const entrambe = fattiDaScheda(scheda([opz('AS06'), opz('AS07')]));
    const ris = applicaRegole([specifica, generica], entrambe);
    expect(testi(ris, 'Paraurti')).toEqual(['AS06']);
    expect(testi(ris, 'Minigonne')).toEqual([]);                                  // fermata
    expect(ris.regole.map(x => x.esito)).toEqual(['scattata', 'fermata']);
    // solo AS06: la specifica non scatta e vale la generica
    const sola = applicaRegole([specifica, generica], fattiDaScheda(scheda([opz('AS06')])));
    expect(testi(sola, 'Minigonne')).toEqual(['AS06']);
    expect(sola.regole.map(x => x.esito)).toEqual(['non_scattata', 'scattata']);
  });

  it('senza «ferma» i valori si sommano senza ripetersi, ricordando quali regole li hanno prodotti', () => {
    const a = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS06' }], azioni: [sig('Paraurti', 'AS06')] });
    const b = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS07' }], azioni: [sig('Paraurti', 'AS06'), fisso('Paraurti', 'EXTRA')] });
    const ris = applicaRegole([a, b], fattiDaScheda(scheda([opz('AS06'), opz('AS07')])));
    expect(testi(ris, 'Paraurti')).toEqual(['AS06', 'EXTRA']);
    expect(ris.celle['Paraurti']![0]!.regole.map(x => x.id)).toEqual([a.id, b.id]);
  });

  it('«se non c\'e\' EXAB aggiungi EXAT in paraurti»', () => {
    const r = regola({ condizioni: [{ tipo: 'assente', sigla: 'EXAB' }], azioni: [fisso('Paraurti', 'EXAT')] });
    expect(testi(applicaRegole([r], fattiDaScheda(scheda([opz('AS06')]))), 'Paraurti')).toEqual(['EXAT']);
    expect(testi(applicaRegole([r], fattiDaScheda(scheda([opz('EXAB')]))), 'Paraurti')).toEqual([]);
  });

  it('valore, testo, «qualsiasi», eccezioni, disattivata e modello', () => {
    const f = fattiDaScheda(scheda([opz('MRKT', 'CINA'), opz('LIVR', 'SI', ['LIVREA ISO TML9 SU SPECCHI']), opz('AS060')]));
    const val = regola({ condizioni: [{ tipo: 'valore', sigla: 'MRKT', testo: 'cina' }], azioni: [fisso('Mercato', 'Cina')] });
    const txt = regola({ condizioni: [{ tipo: 'testo', sigla: 'LIVR', testo: 'SPECCHI' }], azioni: [fisso('Specchi', 'livrea')] });
    const tutta = regola({ condizioni: [{ tipo: 'testo', testo: 'TML9' }], azioni: [fisso('Altro', 'tml')] });
    const parola = regola({ condizioni: [{ tipo: 'presente', sigla: 'AS06' }], azioni: [fisso('X', 'no')] });          // AS060 non e' AS06
    const qual = regola({ logica: 'qualsiasi', condizioni: [{ tipo: 'presente', sigla: 'ZZZZ' }, { tipo: 'presente', sigla: 'LIVR' }], azioni: [fisso('Q', 'ok')] });
    const ecc = regola({ condizioni: [{ tipo: 'presente', sigla: 'LIVR' }], eccezioni: [{ tipo: 'valore', sigla: 'MRKT', testo: 'CINA' }], azioni: [fisso('E', 'no')] });
    const off = regola({ attiva: false, condizioni: [{ tipo: 'presente', sigla: 'LIVR' }], azioni: [fisso('O', 'no')] });
    const altro = regola({ modello: 'F999XX', condizioni: [{ tipo: 'presente', sigla: 'LIVR' }], azioni: [fisso('M', 'no')] });
    const ris = applicaRegole([val, txt, tutta, parola, qual, ecc, off, altro], f);
    expect(Object.keys(ris.celle).sort()).toEqual(['Altro', 'Mercato', 'Q', 'Specchi']);
    expect(ris.regole.map(x => x.esito)).toEqual(['scattata', 'scattata', 'scattata', 'non_scattata', 'scattata', 'eccezione', 'disattivata', 'altro_modello']);
  });

  it('una sotto-sigla dentro un testo conta come presente, e un alias vale come la sigla giusta', () => {
    const ctx = { alias: new Map([['TML9', 'TML09']]), decisi: new Set(['TML9']) };
    const subOk = new Set(['TML09']);
    const f = fattiDaScheda(scheda([opz('LIVR', 'SI', ['LIVREA ISO TML9 SU SPECCHI'])]), { ctx, subOk });
    const r = regola({ condizioni: [{ tipo: 'presente', sigla: 'TML09' }], azioni: [fisso('Livrea', 'TML09')] });
    expect(testi(applicaRegole([r], f), 'Livrea')).toEqual(['TML09']);
    const senza = fattiDaScheda(scheda([opz('LIVR', 'SI', ['LIVREA ISO TML9 SU SPECCHI'])]), { subOk });   // senza alias non si assegna da sola
    expect(testi(applicaRegole([r], senza), 'Livrea')).toEqual([]);
  });

  it('azione «testo della sigla» e valore con dettaglio', () => {
    const f = fattiDaScheda(scheda([opz('LIVR', 'SI', ['GIALLO MODENA COD.VERN 205200']), opz('EXTC', 'W.B.BIANCO AVUS 100')]));
    const r = regola({ azioni: [{ componente: 'Colore', valore: { tipo: 'testo', sigla: 'LIVR' } }, sig('Esterni', 'EXTC')] });
    const ris = applicaRegole([r], f);
    expect(testi(ris, 'Colore')).toEqual(['GIALLO MODENA COD.VERN 205200']);
    expect(testi(ris, 'Esterni')).toEqual(['EXTC — W.B.BIANCO AVUS 100']);
  });

  it('le sigle citate dalle regole attive (per trovare quelle che nessuna regola considera)', () => {
    const a = regola({ condizioni: [{ tipo: 'presente', sigla: 'as06' }], eccezioni: [{ tipo: 'assente', sigla: 'EXAB' }], azioni: [sig('P', 'AS07')] });
    const b = regola({ attiva: false, condizioni: [{ tipo: 'presente', sigla: 'ZZZ1' }], azioni: [fisso('P', 'x')] });
    expect([...sigleCitate([a, b])].sort()).toEqual(['AS06', 'AS07', 'EXAB']);
  });

  it('lo schema rifiuta regole senza azioni o con dati strani', () => {
    const base = { nome: 'x', attiva: true, modello: 'f171vs', logica: 'tutte', condizioni: [], eccezioni: [], azioni: [fisso('P', 'x')], ferma: false };
    expect(RegolaCompSchema.parse(base).modello).toBe('F171VS');
    expect(RegolaCompSchema.safeParse({ ...base, azioni: [] }).success).toBe(false);
    expect(RegolaCompSchema.safeParse({ ...base, condizioni: [{ tipo: 'boh', sigla: 'A' }] }).success).toBe(false);
    expect(RegolaCompSchema.safeParse({ ...base, nome: '' }).success).toBe(false);
  });
});
