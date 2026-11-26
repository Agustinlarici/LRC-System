// Controllo con il SOP: lettura dell'Excel, regole e confronto. Funzioni pure. I tre casi sono schede vere (194983, 307227, 194070) e le loro righe del SOP.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { confrontaCella, confrontaColore, confrontaRiga, gettoni, leggiSop, REGOLE_SUGGERITE, ricava, SopError, type RigaSop } from '../sop-base.js';

const o = (codice: string, valore = 'SI') => ({ codice, valore });
const sopRiga = (commessa: string, v: Record<string, string>): RigaSop => ({ commessa, valori: v });

// Le righe delle schede reali, nell'ordine dell'Excel (solo le sigle che contano per il SOP)
const SCHEDA_194983 = [o('EXTC', 'EXTRACAMPIONARIO-NOT STANDARD'), o('PNCC', 'ROSSO IMOLA'), o('CEXD'), o('FCWS'), o('PAR2'), o('PNT5', 'NEW ARG.NURBURG PPG 26669'), o('MRKT', 'GIAPPONE')];
const SOP_194983 = sopRiga('194983', { MERCATO: 'EUROPA/GIAPPONE', COLORE: 'ROSSO IMOLA', ANT: 'PUR', 'SP. LAT.': 'FCWS', SENSORI: 'PAR2', 'TEL ANT.': '-', POST: 'PUR', SCIVOLO: 'CEXD',
  'TEL. POST': 'RACAM', 'RADAR POST': '-', 'ALI POST': 'PUR', CODINI: 'EXAT', LIVREA: 'PNT5', 'STRATI VERN.': 'PNCC', 'UBIC.': 'ZANASI' });
const SCHEDA_307227 = [o('EXTC', 'EXTRACAMPIONARIO-NOT STANDARD'), o('PNTE', 'EXTRACAMPIONARIO-NOT STANDARD'), o('CEXD'), o('FCWS'), o('PAR2'), o('BRAD'), o('FBMB'), o('AS02'), o('LIVR'), o('AS00'), o('MRKT', 'U.S.A.')];
const SOP_307227 = sopRiga('307227', { MERCATO: 'USA', COLORE: 'EXTRACAMPIONARIO', ANT: 'PUR', 'SP. LAT.': 'FCWS', SENSORI: 'PAR2', 'TEL ANT.': '-', POST: 'PUR', SCIVOLO: 'CEXD',
  'TEL. POST': 'RACAM', 'RADAR POST': 'BRAD', 'ALI POST': 'PUR', CODINI: 'EXAT', LIVREA: 'AS06/AS07', 'CAVAL.': 'FBMB', 'STRATI VERN.': 'PNTE' });
const SCHEDA_194070 = [o('EXTC', 'EXTRACAMPIONARIO-NOT STANDARD'), o('PNT1', 'EXTRACAMPIONARIO-NOT STANDARD'), o('CEXD'), o('FCWS'), o('PAR2'), o('BRAD'), o('SPCF'), o('SURR'), o('EXAB'), o('MRKT', 'CINA')];
const SOP_194070 = sopRiga('194070', { MERCATO: 'CINA', COLORE: 'EXTRACAMPIONARIO', ANT: 'PUR', 'SP. LAT.': 'FCWS', SENSORI: 'PAR2', 'TEL ANT.': 'SV', POST: 'SPCF', SCIVOLO: 'CEXD',
  'TEL. POST': 'SV', 'RADAR POST': 'BRAD', 'ALI POST': 'PUR', CODINI: 'EXAB', 'STRATI VERN.': 'PNT1' });

describe('confronto con le regole suggerite sulle schede vere', () => {
  it('194983 e 194070 coincidono in ogni colonna', () => {
    for (const [riga, scheda] of [[SOP_194983, SCHEDA_194983], [SOP_194070, SCHEDA_194070]] as const) {
      const r = confrontaRiga(riga, 1, scheda, REGOLE_SUGGERITE);
      expect(r.differenze, riga.commessa).toEqual([]);
      expect(r.celle.length).toBeGreaterThanOrEqual(13);
    }
  });

  it('307227: la livrea del SOP (AS06/AS07) non c\'e\' nella scheda: e\' l\'unica differenza', () => {
    const r = confrontaRiga(SOP_307227, 7, SCHEDA_307227, REGOLE_SUGGERITE);
    expect(r.differenze).toEqual([{ commessa: '307227', file_id: 7, colonna: 'LIVREA', sop: 'AS06/AS07', vm: '', tipo: 'solo_sop' }]);
  });

  it('le colonne del SOP senza regola (UBIC., NOTE...) non si controllano', () => {
    const r = confrontaRiga(SOP_194983, 1, SCHEDA_194983, REGOLE_SUGGERITE);
    expect(r.celle.map(c => c.colonna)).not.toContain('UBIC.');
  });
});

describe('ricava', () => {
  const regola = (colonna: string) => REGOLE_SUGGERITE.find(r => r.colonna === colonna)!;
  it('il valore base quando non c\'e\' scritto niente, la sigla quando c\'e\'', () => {
    expect(ricava([], regola('CODINI'))).toEqual({ valore: 'EXAT' });
    expect(ricava([o('EXAB')], regola('CODINI'))).toEqual({ valore: 'EXAB' });
    expect(ricava([], regola('ANT'))).toEqual({ valore: 'PUR' });
    expect(ricava([o('PACF')], regola('ANT'))).toEqual({ valore: 'PACF' });
  });
  it('la camera: SURR si scrive SV davanti e dietro; senza SURR davanti «-» e dietro RACAM', () => {
    expect([ricava([o('SURR')], regola('TEL ANT.')).valore, ricava([o('SURR')], regola('TEL. POST')).valore]).toEqual(['SV', 'SV']);
    expect([ricava([], regola('TEL ANT.')).valore, ricava([], regola('TEL. POST')).valore]).toEqual(['-', 'RACAM']);
  });
  it('piu\' sigle della stessa colonna si uniscono con «/», senza doppioni', () => {
    expect(ricava([o('AS06'), o('AS07'), o('AS07')], regola('LIVREA')).valore).toBe('AS06/AS07');
  });
  it('maiuscole e spazi nei codici della scheda non contano', () => {
    expect(ricava([o(' exab ')], regola('CODINI')).valore).toBe('EXAB');
  });
  it('colore: si guardano i valori delle sigle di colore presenti nella scheda, in qualsiasi posizione', () => {
    expect(ricava([o('EXTC', 'EXTRA'), o('PNCC', 'ROSSO IMOLA')], regola('COLORE'))).toEqual({ valore: 'ROSSO IMOLA', candidati: ['ROSSO IMOLA'] });
    expect(ricava([o('PNCC', 'ROSSO IMOLA'), o('CEXD'), o('EXTC', 'EXTRA')], regola('COLORE')).candidati).toEqual(['ROSSO IMOLA']);   // non dipende dalla riga sotto EXTC
    expect(ricava([o('EXTC', 'EXTRA'), o('CEXD')], regola('COLORE'))).toEqual({ valore: '', candidati: [] });                           // EXTC da solo non e' un colore
    expect(ricava([o('PNT1', ''), o('PNCC', '  ')], regola('COLORE')).candidati).toEqual([]);                                             // valori vuoti non contano
  });
  it('mercato: tradotto con la tabella; un valore senza regola si segnala', () => {
    expect(ricava([o('MRKT', 'U.S.A.')], regola('MERCATO'))).toEqual({ valore: 'USA' });
    expect(ricava([o('MRKT', 'COREA')], regola('MERCATO'))).toEqual({ valore: 'COREA', nota: 'senza_regola' });
    expect(ricava([], regola('MERCATO'))).toEqual({ valore: '' });
  });
});

describe('confrontaCella', () => {
  it('uguali: maiuscole, spazi, ordine e «-» come vuoto', () => {
    expect(gettoni('as07 / AS06')).toEqual(['AS06', 'AS07']);
    for (const [a, b] of [['4 GLOSS', '4GLOSS'], ['AS07/AS06', 'AS06/AS07'], ['-', ''], ['pur', 'PUR']] as const) expect(confrontaCella(a, b), `${a} / ${b}`).toBe('ok');
  });
  it('i tipi di differenza', () => {
    expect(confrontaCella('PUR', 'WING')).toBe('diverso');
    expect(confrontaCella('WING-CEMP', 'WING')).toBe('diverso');
    expect(confrontaCella('AS06', '')).toBe('solo_sop');
    expect(confrontaCella('', 'EXAT')).toBe('solo_vm');
    expect(confrontaCella('AS06/AS07', 'AS06')).toBe('diverso');
  });
});

describe('confrontaColore', () => {
  const EXTRA = 'EXTRACAMPIONARIO';
  it('coincide con il valore di una sigla di colore', () => {
    expect(confrontaColore('rosso  imola', ['ROSSO IMOLA'], EXTRA)).toBe('ok');
    expect(confrontaColore('NERO DS', ['ROSSO IMOLA', 'NERO DS'], EXTRA)).toBe('ok');                // basta uno
  });
  it('il SOP dice extra: basta che il valore di una sigla lo contenga', () => {
    expect(confrontaColore('EXTRACAMPIONARIO', ['EXTRACAMPIONARIO-NOT STANDARD'], EXTRA)).toBe('ok');
    expect(confrontaColore('EXTRACAMPIONARIO', ['ROSSO IMOLA'], EXTRA)).toBe('diverso');             // la scheda ha un colore di gamma: il SOP sbaglia
  });
  it('i tipi di differenza', () => {
    expect(confrontaColore('ROSSO CORSA', ['ROSSO IMOLA'], EXTRA)).toBe('diverso');
    expect(confrontaColore('ROSSO CORSA', [], EXTRA)).toBe('solo_sop');
    expect(confrontaColore('', ['ROSSO IMOLA'], EXTRA)).toBe('solo_vm');
    expect(confrontaColore('', [], EXTRA)).toBe('ok');
  });
  it('dentro una riga del SOP: un colore di gamma scritto come extra viene segnalato, e la camera mostra i valori trovati', () => {
    const r = confrontaRiga(sopRiga('1', { COLORE: 'EXTRACAMPIONARIO' }), 1, [o('EXTC', 'EXTRACAMPIONARIO-NOT STANDARD'), o('PNCC', 'ROSSO IMOLA')], REGOLE_SUGGERITE);
    expect(r.differenze).toEqual([{ commessa: '1', file_id: 1, colonna: 'COLORE', sop: 'EXTRACAMPIONARIO', vm: 'ROSSO IMOLA', tipo: 'diverso' }]);
  });
});

describe('leggiSop', () => {
  const xlsx = (righe: unknown[][]): Buffer => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Foglio1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('legge le commesse, ignora le ripetute e conta quelle con dati', () => {
    const f = leggiSop(xlsx([['COMMESSA', 'MERCATO', 'ANT', ''], [192100, '', ''], [192104, 'EUROPA', 'PUR'], [192104, 'USA', 'PACF'], ['', 'X', 'Y'], [192105, '  ', '']]));
    expect(f.colonne).toEqual(['MERCATO', 'ANT']);
    expect(f.righe.map(r => r.commessa)).toEqual(['192100', '192104', '192105']);
    expect(f.righe[1]!.valori).toEqual({ MERCATO: 'EUROPA', ANT: 'PUR' });          // vale la prima
    expect(f.conDati).toBe(1);
  });
  it('senza la colonna COMMESSA o senza righe non e\' un SOP', () => {
    expect(() => leggiSop(xlsx([['A', 'B'], [1, 2]]))).toThrow(SopError);
    expect(() => leggiSop(xlsx([['COMMESSA', 'ANT']]))).toThrow(/Nessuna commessa/);
    expect(() => leggiSop(Buffer.from('non e\' un excel'))).toThrow(SopError);
  });
});
