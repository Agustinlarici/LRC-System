// Compatibilità con la parte Python (STR-LocalAI/web/ferrari): pacchetti prodotti dall'altra parte devono
// verificarsi qui, e il risultato della IA deve essere interpretabile dal confronto.
// I file in fixtures/ si rigenerano con gen-fixtures.ts + la CLI Python (vedi docs/FERRARI-FLUSSO.md).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analizzaVm } from '../analyzer.js';
import { leggiBundle, leggiRisultatoIa, leggiSigle } from '../bundle.js';
import { confronta } from '../compare.js';
import type { Canonico, Conoscenza } from '../types.js';

const SECRET = 'segreto-di-prova';
const leggi = (n: string) => readFileSync(join(__dirname, 'fixtures', n));

describe('interoperabilità TypeScript ↔ Python', () => {
  const toAi = leggiBundle(leggi('to-ai-ts.zip'), SECRET, 'to-ai');
  const fromAi = leggiBundle(leggi('from-ai-python.zip'), SECRET, 'from-ai');
  const k = JSON.parse(toAi.files.get('knowledge/dictionary.json')!.toString()) as Conoscenza;

  it('il pacchetto della IA (firmato da Python) si verifica con la firma di TypeScript', () => {
    expect(fromAi.manifest.producer).toBe('ai');
    expect(fromAi.manifest.in_reply_to).toBe(toAi.manifest.bundle_id);
    expect(fromAi.manifest.batch_id).toBe(toAi.manifest.batch_id);
  });

  it('un segreto diverso lo rifiuta', () => {
    expect(() => leggiBundle(leggi('from-ai-python.zip'), 'altro', 'from-ai')).toThrow(/Firma non valida/);
  });

  it('ogni risultato rispetta lo schema e si riferisce alla scheda giusta', () => {
    for (const [path, buf] of fromAi.files) {
      const id = /^results\/(f\d+)\.json$/.exec(path)![1]!;
      const ia = leggiRisultatoIa(buf);
      const canonico = JSON.parse(toAi.files.get(`normalized/${id}.json`)!.toString()) as Canonico;
      expect(ia.file_id).toBe(id);
      expect(ia.source_sha256).toBe(canonico.source.sha256);
      expect(ia.run.knowledge_version).toBe(k.versione);
    }
  });

  it('la VM verifica tutte le evidenze citate dalla IA (nessun frammento non trovato)', () => {
    for (const [path, buf] of fromAi.files) {
      const id = /^results\/(f\d+)\.json$/.exec(path)![1]!;
      const ia = leggiRisultatoIa(buf);
      const canonico = JSON.parse(toAi.files.get(`normalized/${id}.json`)!.toString()) as Canonico;
      const r = confronta(analizzaVm(canonico, k), ia);
      expect(r.items.filter(i => i.tipo === 'evidenza_non_valida'), `scheda ${id}`).toEqual([]);
      expect(r.items.filter(i => i.tipo === 'modello_diverso' || i.tipo === 'modello_non_identificato')).toEqual([]);
      expect(r.header.find(h => h.campo === 'modello')?.stato).toBe('uguale');
    }
  });

  it('i componenti trovati da VM e IA sullo stesso testo coincidono (FILO, LATO, immagini…)', () => {
    const id = 'f2';
    const ia = leggiRisultatoIa(fromAi.files.get(`results/${id}.json`)!);
    const canonico = JSON.parse(toAi.files.get(`normalized/${id}.json`)!.toString()) as Canonico;
    const r = confronta(analizzaVm(canonico, k), ia);
    // L'IA di prova riconosce FILO, LATO, BLU PROVA, immagini e segnaposto ma NON codici vernice né ULTRASUEDE:
    // quelle differenze sono corrette ("solo la VM"); tutto il resto deve coincidere esattamente.
    expect(r.items.filter(i => i.tipo === 'valore_diverso' || i.tipo === 'componente_solo_ia')).toEqual([]);
    const soloVm = r.items.filter(i => i.tipo === 'componente_solo_vm').map(i => (i.vm as { tipo: string }).tipo).sort();
    expect(soloVm).toEqual(['CODICE_VERNICE', 'MATERIALE']);
    expect(r.items.some(i => i.tipo === 'immagini')).toBe(true);
    expect(r.items.some(i => i.tipo === 'placeholder')).toBe(true);
  });

  it('il pacchetto delle sigle esportato da Python si legge qui', () => {
    const r = leggiBundle(leggi('sigle-python.zip'), SECRET, 'sigle');
    expect(r.manifest.producer).toBe('ai');
    expect(leggiSigle(r.files.get('sigle.json')!)).toEqual([
      { modello: 'F999XX', codice: 'BIC2', va: true, sub: false, alias: null, nome: '(parola cercata)' },      // senza schede caricate non ha il nome
      { modello: '*', codice: 'CEL2', va: true, sub: false, alias: null, nome: '(parola cercata)' },
      { modello: 'F999XX', codice: 'CAVALLINO', va: false, sub: false, alias: null, nome: '(parola cercata)' },
    ]);
  });
});
