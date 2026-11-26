// Un evento "delibera accettata" di iKnow diventa un ordine di foto. Un'unica funzione per le due vie
// (chiamata API e copia del DB), così passare dall'una all'altra non cambia nulla e non crea doppioni.
import { db } from '../../db/client.js';
import { normalizePhase, sha256Hex } from './helpers.js';

export type IknowEvent = {
  seriale: string; commessa: string; fase: string; componente: string; versione: string | null; eventAt: Date;
};
export type PhaseRule = { key: string; iknow_fase: string | null };

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Fase del catalogo per un nome di iKnow: prima il nome esatto indicato, poi il codice normalizzato. */
export function matchPhase(rules: PhaseRule[], fase: string): string | null {
  const exact = rules.find(r => r.iknow_fase && same(r.iknow_fase, fase));
  if (exact) return exact.key;
  const norm = normalizePhase(fase);
  return norm && rules.some(r => r.key === norm) ? norm : null;
}

export async function activePhaseRules(): Promise<PhaseRule[]> {
  return (await db`SELECT key, iknow_fase FROM photo_phases WHERE active`) as unknown as PhaseRule[];
}

/** Chiave di idempotenza: non include la versione (può arrivare dopo nella copia) né l'origine. */
export function eventRef(e: Pick<IknowEvent, 'seriale' | 'commessa' | 'componente' | 'eventAt'>, phase: string): string {
  return sha256Hex([e.seriale, e.commessa, phase, e.componente, Math.floor(e.eventAt.getTime() / 1000)].join('|'));
}

export type RegisterResult = { result: 'created' | 'duplicate' | 'phase_unknown'; jobId?: number };

export async function registerEvent(
  e: IknowEvent, phase: string, known: boolean, source: 'iknow' | 'iknow_db', createdBy: string,
): Promise<RegisterResult> {
  const [job] = await db`
    INSERT INTO photo_jobs (commessa, phase, source, external_ref, seriale, componente, versione, event_at,
                            status, error, finished_at, created_by)
    VALUES (${e.commessa}, ${phase}, ${source}, ${eventRef(e, phase)}, ${e.seriale}, ${e.componente}, ${e.versione}, ${e.eventAt},
            ${known ? 'pending' : 'cancelled'},
            ${known ? null : `Fase '${phase}' non configurata: creala e premi Riprova`},
            ${known ? null : new Date()}, ${createdBy})
    ON CONFLICT DO NOTHING   -- stessa chiamata riprovata, o ordine già aperto per lo stesso seriale+componente
    RETURNING id::int AS id
  `;
  if (!job) return { result: 'duplicate' };
  return { result: known ? 'created' : 'phase_unknown', jobId: job.id };
}
