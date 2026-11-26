import { describe, expect, it } from 'vitest';
import { AvvioSchema, ErroreSchema, MetaAnalisiSchema, RisultatoSchema, SaluteSchema, SnapshotSigleSchema, StatoAnalisiSchema } from '../contratto.js';
import { errore, risultato, salute, SHA, snapshot, statoFatto, statoInAnalisi, UUID, VERSIONE } from './fixtures-ia-v1.js';

describe('contratto v1', () => {
  it('gli esempi canonici sono validi', () => {
    expect(SaluteSchema.parse(salute)).toEqual(salute);
    expect(SnapshotSigleSchema.parse(snapshot)).toEqual(snapshot);
    expect(RisultatoSchema.parse(risultato)).toEqual(risultato);
    expect(StatoAnalisiSchema.parse(statoInAnalisi).avanzamento).toEqual({ fatti: 1, totale: 3, etichetta: 'Riassunti' });
    expect(StatoAnalisiSchema.parse(statoFatto).risultato?.lettura).toHaveLength(2);
    expect(ErroreSchema.parse(errore).errore.codice).toBe('sigle_obsolete');
    expect(AvvioSchema.parse({ schema: 1, id: 'x', stato: 'in_coda' }).stato).toBe('in_coda');
    expect(MetaAnalisiSchema.parse({ sha256: SHA, richiesta_id: UUID, versione_sigle: VERSIONE, commessa: null, modello: null })).toBeTruthy();
  });
  it('rifiuta versione di schema diversa, stato sconosciuto, hash corto e UUID falso', () => {
    expect(() => SaluteSchema.parse({ ...salute, schema: 2 })).toThrow();
    expect(() => StatoAnalisiSchema.parse({ ...statoInAnalisi, stato: 'boh' })).toThrow();
    expect(() => MetaAnalisiSchema.parse({ sha256: 'corto', richiesta_id: UUID, versione_sigle: VERSIONE, commessa: null, modello: null })).toThrow();
    expect(() => MetaAnalisiSchema.parse({ sha256: SHA, richiesta_id: 'non-uuid', versione_sigle: VERSIONE, commessa: null, modello: null })).toThrow();
  });
  it('la nota e gli avvisi hanno un valore di default', () => {
    const r = RisultatoSchema.parse({ ...risultato, avvisi: undefined, lettura: [{ riga: null, codice: 'A', descrizione: 'd', valore: 'SI', testi: [] }] });
    expect(r.avvisi).toEqual([]);
    expect(r.lettura[0]!.nota).toBe('');
  });
});
