// Ejemplos canonicos del contrato v1 (los mismos deben validarse en la PC IA). Si cambia el contrato, cambian aqui.
import type { Risultato, Salute, SnapshotSigle, StatoAnalisi } from '../contratto.js';

export const SHA = 'a'.repeat(64);
export const VERSIONE = 'b'.repeat(64);
export const UUID = '11111111-2222-4333-8444-555555555555';

export const salute: Salute = { schema: 1, versione_api: 1, ollama: true, modello: 'gemma4:e2b', in_coda: 0, in_corso: 0, versione_prompt: '3' };

export const snapshot: SnapshotSigle = {
  versione_sigle: VERSIONE, colonne: ['LIVR', 'BIC2'], sotto_sigle: [{ codice: 'TLM13', padre: 'LIVR' }],
  alias: { TLM15: 'TLM16' }, modelli: ['F999XX'], esempi: [{ voce: 'LIVREA SPECIALE', testo: 'LIVREA TLM13 SUGLI SPECCHI', dettaglio: 'TLM13 sugli specchi' }],
};

export const risultato: Risultato = {
  commessa: '100001', modello: 'F999XX',
  lettura: [
    { riga: 8, codice: 'BIC2', descrizione: 'CARROZZERIA BICOLORE', valore: 'NERO DS 1250', nota: '', testi: [] },
    { riga: 9, codice: 'LIVR', descrizione: 'LIVREA SPECIALE', valore: 'SI', nota: '', testi: ['LIVREA TLM13 SUGLI SPECCHI (VEDI IMMAGINI)'] },
  ],
  dettagli: [{ codice: 'LIVR', chiave: 'c'.repeat(40), dettaglio: 'TLM13 sugli specchi', stato: 'ok' }],
  avvisi: [],
  metriche: { secondi: 12.5, chiamate: 3, versione_prompt: '3', modello: 'gemma4:e2b' },
};

export const statoInAnalisi: StatoAnalisi = {
  schema: 1, id: 'job-1', stato: 'in_corso', passo: 'riassunti', avanzamento: { fatti: 1, totale: 3, etichetta: 'Riassunti' },
};
export const statoFatto: StatoAnalisi = { schema: 1, id: 'job-1', stato: 'fatto', passo: 'fine', avanzamento: null, risultato };
export const errore = { schema: 1, errore: { codice: 'sigle_obsolete', messaggio: 'Versione delle sigle sconosciuta' } };
