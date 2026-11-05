// Contratto dell'API v1 della PC IA (vedi docs/FERRARI-CONNESSIONE-IA.md §4).
// Le stesse forme sono nei file di esempio __tests__/fixtures-ia-v1.ts e nei test della PC IA: se cambia una, falliscono tutte.

import { z } from 'zod';

export const VERSIONE_API = 1;

export const PASSI_REMOTI = ['lettura', 'riassunti', 'controllo', 'fine'] as const;
export const StatoRemoto = z.enum(['in_coda', 'in_corso', 'fatto', 'errore']);
export type StatoRemoto = z.infer<typeof StatoRemoto>;

export const ErroreSchema = z.object({
  schema: z.literal(VERSIONE_API),
  errore: z.object({ codice: z.string().min(1).max(60), messaggio: z.string().max(500) }),
});
export type ErroreRemoto = z.infer<typeof ErroreSchema>['errore'];

export const SaluteSchema = z.object({
  schema: z.literal(VERSIONE_API),
  versione_api: z.number().int(),
  ollama: z.boolean(),
  modello: z.string().nullable(),
  in_coda: z.number().int().min(0),
  in_corso: z.number().int().min(0),
  versione_prompt: z.string(),
});
export type Salute = z.infer<typeof SaluteSchema>;

/** Le sigle della VM, mandate una volta sola: ogni scheda indica solo la `versione_sigle`. */
export const SnapshotSigleSchema = z.object({
  versione_sigle: z.string().length(64),
  colonne: z.array(z.string()),
  sotto_sigle: z.array(z.object({ codice: z.string(), padre: z.string().nullable() })),
  alias: z.record(z.string(), z.string()),
  modelli: z.array(z.string()),
  esempi: z.array(z.object({ voce: z.string(), testo: z.string(), dettaglio: z.string() })),
});
export type SnapshotSigle = z.infer<typeof SnapshotSigleSchema>;

export const MetaAnalisiSchema = z.object({
  sha256: z.string().length(64),
  richiesta_id: z.string().uuid(),
  versione_sigle: z.string().length(64),
  commessa: z.string().nullable(),
  modello: z.string().nullable(),
});
export type MetaAnalisi = z.infer<typeof MetaAnalisiSchema>;

export const LetturaOpzioneSchema = z.object({
  riga: z.number().int().nullable(),
  codice: z.string(),
  descrizione: z.string(),
  valore: z.string(),
  nota: z.string().default(''),
  testi: z.array(z.string()),
});
export type LetturaOpzione = z.infer<typeof LetturaOpzioneSchema>;

export const DettaglioIaSchema = z.object({
  codice: z.string(),
  chiave: z.string().min(1),
  dettaglio: z.string(),
  stato: z.enum(['ok', 'rivedere']),
  proposta: z.string().optional(),
});
export type DettaglioIa = z.infer<typeof DettaglioIaSchema>;

export const RisultatoSchema = z.object({
  commessa: z.string().nullable(),
  modello: z.string().nullable(),
  lettura: z.array(LetturaOpzioneSchema),
  dettagli: z.array(DettaglioIaSchema),
  avvisi: z.array(z.object({ codice: z.string().optional(), riga: z.number().int().optional(), motivo: z.string() })).default([]),
  metriche: z.object({
    secondi: z.number().min(0), chiamate: z.number().int().min(0), versione_prompt: z.string(), modello: z.string().nullable(),
  }),
});
export type Risultato = z.infer<typeof RisultatoSchema>;

export const AvanzamentoSchema = z.object({
  fatti: z.number().int().min(0), totale: z.number().int().min(0), etichetta: z.string().max(200),
});
export type Avanzamento = z.infer<typeof AvanzamentoSchema>;

export const StatoAnalisiSchema = z.object({
  schema: z.literal(VERSIONE_API),
  id: z.string().min(1),
  stato: StatoRemoto,
  passo: z.enum(PASSI_REMOTI),
  avanzamento: AvanzamentoSchema.nullable().default(null),
  risultato: RisultatoSchema.optional(),
  errore: ErroreSchema.shape.errore.optional(),
});
export type StatoAnalisi = z.infer<typeof StatoAnalisiSchema>;

export const AvvioSchema = z.object({ schema: z.literal(VERSIONE_API), id: z.string().min(1), stato: StatoRemoto });
export type Avvio = z.infer<typeof AvvioSchema>;

export const SigleOkSchema = z.object({ schema: z.literal(VERSIONE_API), versione_sigle: z.string().length(64) });
