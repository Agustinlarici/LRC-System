import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

// Scrittura di una modifica alla scheda dipendente, con gli eventi automatici della timeline.
// La usano sia la rotta PATCH /employees/:id sia la sync automatica con Osti.

export interface UpdateActor { id: number | null; display_name: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function applyEmployeeUpdate(
  id: number,
  existing: Record<string, any>,
  updates: Record<string, any>,
  opts: { silent: boolean; actor: UpdateActor },
): Promise<void> {
  // Traccia nella timeline i cambi strutturali rilevanti prima di applicarli — con
  // nomi leggibili (non gli id grezzi) così la timeline ha senso per chi la legge.
  const events: { event_type: string; from_value: string | null; to_value: string | null }[] = [];
  if (updates.reparto_id !== undefined && updates.reparto_id !== existing.reparto_id) {
    const ids = [existing.reparto_id, updates.reparto_id].filter((v): v is number => v != null);
    const names = ids.length
      ? new Map((await db`SELECT id, name FROM hr_department WHERE id = ANY(${ids})`).map((d: any) => [d.id, d.name]))
      : new Map();
    events.push({
      event_type: 'cambio_reparto',
      from_value: existing.reparto_id != null ? names.get(existing.reparto_id) ?? null : null,
      to_value: updates.reparto_id != null ? names.get(updates.reparto_id) ?? null : null,
    });
  }
  if (updates.mansione !== undefined && updates.mansione !== existing.mansione) {
    events.push({ event_type: 'cambio_mansione', from_value: existing.mansione, to_value: updates.mansione });
  }
  if (updates.livello !== undefined && updates.livello !== existing.livello) {
    events.push({ event_type: 'cambio_livello', from_value: existing.livello, to_value: updates.livello });
  }
  if (updates.capo_id !== undefined && updates.capo_id !== existing.capo_id) {
    const ids = [existing.capo_id, updates.capo_id].filter((v): v is number => v != null);
    const names = ids.length
      ? new Map((await db`SELECT id, (nome || ' ' || cognome) AS nome FROM hr_employee WHERE id = ANY(${ids})`).map((e: any) => [e.id, e.nome]))
      : new Map();
    events.push({
      event_type: 'cambio_capo',
      from_value: existing.capo_id != null ? names.get(existing.capo_id) ?? null : null,
      to_value: updates.capo_id != null ? names.get(updates.capo_id) ?? null : null,
    });
  }
  if (updates.stato === 'cessato' && existing.stato !== 'cessato') {
    updates.data_cessazione = updates.data_cessazione || new Date().toISOString().slice(0, 10);
    events.push({ event_type: 'cessazione', from_value: existing.stato, to_value: 'cessato' });
  }
  // Riattivazione: un dipendente che torna da 'cessato' non può restare con una
  // data di cessazione appesa, altrimenti resterebbe uno stato inconsistente.
  if (updates.stato !== undefined && updates.stato !== 'cessato' && existing.stato === 'cessato'
      && !(updates.data_cessazione && updates.data_cessazione > new Date().toISOString().slice(0, 10))) {
    updates.data_cessazione = null;
  }
  // Data di cessazione già trascorsa: la persona è cessata (una data futura è solo la scadenza del contratto).
  // Vale per ogni modifica della data (scheda, sync Osti); chi ha già la data passata e non viene toccato
  // lo chiude `cessaScaduti` (job orario).
  const oggi = new Date().toISOString().slice(0, 10);
  if (updates.data_cessazione && String(updates.data_cessazione).slice(0, 10) <= oggi
      && (updates.stato ?? existing.stato) !== 'cessato') {
    updates.stato = 'cessato';
    events.push({ event_type: 'cessazione', from_value: existing.stato, to_value: 'cessato' });
  }

  updates.updated_at = new Date();
  await db`UPDATE hr_employee SET ${db(updates)} WHERE id = ${id}`;

  if (opts.silent) events.length = 0;
  for (const ev of events) {
    const eventDate = ev.event_type === 'cessazione' && updates.data_cessazione
      ? updates.data_cessazione
      : new Date().toISOString().slice(0, 10);
    await db`
      INSERT INTO hr_employee_event ${db({
        employee_id: id,
        event_type: ev.event_type,
        event_date: eventDate,
        from_value: ev.from_value,
        to_value: ev.to_value,
        created_by_user_id: opts.actor.id,
        created_by_name: opts.actor.display_name,
      })}
    `;
  }
}

const ACTOR_SISTEMA: UpdateActor = { id: null, display_name: 'Cessazione automatica' };

/**
 * Chi non è cessato ma ha una data di cessazione già trascorsa passa a «cessato» (con l'evento in timeline,
 * datato alla data di cessazione). Ritorna quante schede ha chiuso.
 */
export async function cessaScaduti(): Promise<number> {
  const oggi = new Date().toISOString().slice(0, 10);
  const rows = await db<{ id: number; stato: string; data_cessazione: string }[]>`
    SELECT id, stato, data_cessazione::text AS data_cessazione FROM hr_employee
    WHERE stato <> 'cessato' AND data_cessazione IS NOT NULL AND data_cessazione <= ${oggi}`;
  let chiusi = 0;
  for (const r of rows) {
    try {
      await applyEmployeeUpdate(r.id, r, { stato: 'cessato', data_cessazione: r.data_cessazione }, { silent: false, actor: ACTOR_SISTEMA });
      chiusi++;
    } catch (err) {
      logger.error(`[hr] cessazione automatica scheda ${r.id} non riuscita: ${err instanceof Error ? err.message : err}`);   // le altre schede vanno avanti
    }
  }
  return chiusi;
}
