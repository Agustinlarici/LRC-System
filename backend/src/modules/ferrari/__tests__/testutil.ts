import type { AnalisiIa, AnalisiVm } from '../types.js';

/** IA "perfetta": ripete esattamente i componenti trovati dalla VM. */
export function iaPerfetta(vm: AnalisiVm, opts: { fileId?: string; sha256?: string; knowledge?: number } = {}): AnalisiIa {
  return {
    schema_version: 1, file_id: opts.fileId ?? 'f1', source_sha256: opts.sha256 ?? 'x'.repeat(64),
    modello: { valore: vm.header.tipo_matricola.modello! },
    mercato: vm.header.tipo_matricola.mercato_codice ? { valore: vm.header.tipo_matricola.mercato_codice } : null,
    opzioni: vm.opzioni.map(o => ({
      riga: o.riga, codice: o.codice,
      componenti: o.unita.flatMap(u => u.componenti.map(c => ({ tipo: c.tipo, valore: c.valore, frammento: c.frammento }))),
      sconosciuti: [], ambigui: [], incoerenze: [],
    })),
    incoerenze_generali: [],
    run: { ollama_model: 'test', prompt_version: 'p1', knowledge_version: opts.knowledge ?? vm.versione_conoscenza, seconds: 1 },
  };
}
