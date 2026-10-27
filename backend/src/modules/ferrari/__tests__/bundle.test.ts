import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import {
  buildBundle, buildToAi, buildKnowledge, leggiBundle, leggiRisultatoIa, stableStringify, firma, BundleError,
} from '../bundle.js';
import { parseScheda } from '../parser.js';
import { schedaSemplice, toXlsBuffer } from './fixtures.js';

const SECRET = 'segreto-di-prova';
const ZIP_UNO = () => buildBundle({ tipo: 'to-ai', producer: 'vm', secret: SECRET, knowledgeVersion: 3,
  files: { 'normalized/f1.json': '{"a":1}', 'knowledge/dictionary.json': '{"versione":3}' } });

/** Rifà lo zip cambiando i file ma lasciando il manifest com'era. */
function manomesso(buf: Buffer, cambi: Record<string, Buffer | string | null>): Buffer {
  const z = new PizZip(buf);
  for (const [n, c] of Object.entries(cambi)) { if (c === null) z.remove(n); else z.file(n, c); }
  return z.generate({ type: 'nodebuffer' }) as Buffer;
}

describe('stableStringify / firma', () => {
  it('ordina le chiavi e non mette spazi', () => {
    expect(stableStringify({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}');
  });
  it('ignora i campi undefined', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it('la firma dipende dal segreto e dal contenuto', () => {
    const m = { a: 1 };
    expect(firma(m, 's1')).not.toBe(firma(m, 's2'));
    expect(firma(m, 's1')).not.toBe(firma({ a: 2 }, 's1'));
    expect(firma(m, 's1')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildBundle / leggiBundle', () => {
  it('andata e ritorno', () => {
    const { zip, manifest } = ZIP_UNO();
    const r = leggiBundle(zip, SECRET, 'to-ai');
    expect(r.manifest.bundle_id).toBe(manifest.bundle_id);
    expect(r.files.get('normalized/f1.json')!.toString()).toBe('{"a":1}');
    expect(r.manifest.knowledge_version).toBe(3);
  });

  it('segreto diverso → rifiutato', () => {
    expect(() => leggiBundle(ZIP_UNO().zip, 'altro', 'to-ai')).toThrow(/Firma non valida/);
  });

  it('tipo di pacchetto sbagliato → rifiutato', () => {
    expect(() => leggiBundle(ZIP_UNO().zip, SECRET, 'from-ai')).toThrow(/Tipo di pacchetto errato/);
  });

  it('file modificato dentro lo zip → rifiutato (hash)', () => {
    expect(() => leggiBundle(manomesso(ZIP_UNO().zip, { 'normalized/f1.json': '{"a":2}' }), SECRET, 'to-ai'))
      .toThrow(/Hash o dimensione errati/);
  });

  it('manifest modificato → rifiutato (firma)', () => {
    const z = new PizZip(ZIP_UNO().zip);
    const m = JSON.parse(z.file('manifest.json')!.asText());
    m.knowledge_version = 99;
    const buf = manomesso(ZIP_UNO().zip, { 'manifest.json': JSON.stringify(m) });
    const z2 = new PizZip(buf);
    z2.file('manifest.json', JSON.stringify({ ...m }));
    expect(() => leggiBundle(z2.generate({ type: 'nodebuffer' }) as Buffer, SECRET, 'to-ai')).toThrow(/Firma non valida/);
  });

  it('file non dichiarato nel manifest → rifiutato', () => {
    expect(() => leggiBundle(manomesso(ZIP_UNO().zip, { 'extra.txt': 'ciao' }), SECRET, 'to-ai')).toThrow(/non dichiarato/);
  });

  it('file dichiarato ma mancante → rifiutato', () => {
    expect(() => leggiBundle(manomesso(ZIP_UNO().zip, { 'normalized/f1.json': null }), SECRET, 'to-ai')).toThrow(/mancante/);
  });

  it('non è uno zip / zip vuoto / senza manifest', () => {
    expect(() => leggiBundle(Buffer.from('boh'), SECRET, 'to-ai')).toThrow(BundleError);
    expect(() => leggiBundle(Buffer.alloc(0), SECRET, 'to-ai')).toThrow(BundleError);
    const z = new PizZip(); z.file('a.txt', 'x');
    expect(() => leggiBundle(z.generate({ type: 'nodebuffer' }) as Buffer, SECRET, 'to-ai')).toThrow(/manifest.json mancante/);
  });

  it('percorsi pericolosi nel manifest → rifiutato (anche se firmati)', () => {
    const { zip } = buildBundle({ tipo: 'to-ai', producer: 'vm', secret: SECRET, knowledgeVersion: 0, files: { '../evil.json': '{}' } });
    expect(() => leggiBundle(zip, SECRET, 'to-ai')).toThrow(/manifest non valido/);
  });

  it('senza segreto non si costruisce né si legge', () => {
    expect(() => buildBundle({ tipo: 'to-ai', producer: 'vm', secret: '', knowledgeVersion: 0, files: {} })).toThrow(/Segreto/);
    expect(() => leggiBundle(ZIP_UNO().zip, '', 'to-ai')).toThrow(/Segreto/);
  });
});

describe('buildToAi / buildKnowledge', () => {
  const c = parseScheda(toXlsBuffer(schedaSemplice()), 'a.xls');
  const k = { versione: 7, codici: [{ codice: 'CEL2', modello: null, significato: 'x', categoria: null }], componenti: [] };

  it('il to-ai contiene le schede senza celle grezze e la conoscenza corrente', () => {
    const { zip, manifest } = buildToAi({ secret: SECRET, schede: [{ dbId: 12, canonico: c }], conoscenza: k, esempi: [] });
    const r = leggiBundle(zip, SECRET, 'to-ai');
    expect(manifest.knowledge_version).toBe(7);
    const scheda = JSON.parse(r.files.get('normalized/f12.json')!.toString());
    expect(scheda.celle).toBeUndefined();
    expect(scheda.opzioni).toHaveLength(7);
    expect(JSON.parse(r.files.get('knowledge/dictionary.json')!.toString()).versione).toBe(7);
  });

  it('il pacchetto conoscenza si legge come tipo knowledge', () => {
    const { zip } = buildKnowledge({ secret: SECRET, conoscenza: k, esempi: [
      { testo: 'BLU PROVA', pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null }] });
    const r = leggiBundle(zip, SECRET, 'knowledge');
    expect(r.files.get('knowledge/examples.jsonl')!.toString().trim().split('\n')).toHaveLength(1);
  });
});

describe('leggiRisultatoIa', () => {
  const base = {
    schema_version: 1, file_id: 'f1', source_sha256: 'a'.repeat(64), modello: { valore: 'F999XX' }, mercato: null,
    opzioni: [{ riga: 8, codice: 'PNT1', componenti: [{ tipo: 'colore', valore: 'BLU', frammento: 'BLU' }] }],
    run: { ollama_model: 'm', prompt_version: 'p', knowledge_version: 1, seconds: 1.5 },
  };
  const buf = (o: unknown) => Buffer.from(JSON.stringify(o));

  it('accetta un risultato valido, normalizza i tipi in maiuscolo e riempie i default', () => {
    const r = leggiRisultatoIa(buf(base));
    expect(r.opzioni[0]!.componenti[0]!.tipo).toBe('COLORE');
    expect(r.opzioni[0]!.sconosciuti).toEqual([]);
    expect(r.incoerenze_generali).toEqual([]);
  });
  it('rifiuta JSON rotto, schema errato e campi fuori misura', () => {
    expect(() => leggiRisultatoIa(Buffer.from('{'))).toThrow(/JSON non valido/);
    expect(() => leggiRisultatoIa(buf({ ...base, schema_version: 2 }))).toThrow(/non valido/);
    expect(() => leggiRisultatoIa(buf({ ...base, source_sha256: 'zz' }))).toThrow(/non valido/);
    expect(() => leggiRisultatoIa(buf({ ...base, opzioni: [{ riga: 0, codice: 'X' }] }))).toThrow(/non valido/);
  });
});
