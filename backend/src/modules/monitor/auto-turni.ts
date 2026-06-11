import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

type PausaDef = { ora_inizio: string; ora_fine: string };

function parsePause(v: unknown): PausaDef[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as PausaDef[];
  if (typeof v === 'string') { try { return JSON.parse(v) as PausaDef[]; } catch { return []; } }
  return [];
}

/**
 * Applies standard shifts to all lines that have no data saved for the given date.
 * Safe to call multiple times — skips lines that already have turni or quantita.
 * Returns the number of lines that had defaults applied.
 */
export async function applyDefaultsForDate(dateStr: string): Promise<number> {
  // Use noon UTC to safely derive day-of-week regardless of timezone
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

  const defaults = await db`
    SELECT linea_id, t1_inizio, t1_fine, t2_inizio, t2_fine, quantita_giornaliera, pause
    FROM monitor_turno_default
    WHERE day_of_week = ${dow}
      AND (t1_inizio IS NOT NULL OR quantita_giornaliera IS NOT NULL)
  `;

  let applied = 0;

  for (const def of defaults) {
    const lineaId = def.linea_id as number;

    // Skip if any turno or quantita is already saved for this line+date
    const [existingTurno] = await db`
      SELECT 1 FROM monitor_turno
      WHERE linea_id = ${lineaId} AND data = ${dateStr}::date LIMIT 1
    `;
    if (existingTurno) continue;

    const [existingQta] = await db`
      SELECT 1 FROM monitor_quantita_giorno
      WHERE linea_id = ${lineaId} AND data = ${dateStr}::date LIMIT 1
    `;
    if (existingQta) continue;

    if (def.t1_inizio && def.t1_fine) {
      await db`
        INSERT INTO monitor_turno (linea_id, data, numero, ora_inizio, ora_fine)
        VALUES (${lineaId}, ${dateStr}::date, 1, ${def.t1_inizio}, ${def.t1_fine})
        ON CONFLICT (linea_id, data, numero) DO NOTHING
      `;
    }

    if (def.t2_inizio && def.t2_fine) {
      await db`
        INSERT INTO monitor_turno (linea_id, data, numero, ora_inizio, ora_fine)
        VALUES (${lineaId}, ${dateStr}::date, 2, ${def.t2_inizio}, ${def.t2_fine})
        ON CONFLICT (linea_id, data, numero) DO NOTHING
      `;
    }

    if (def.quantita_giornaliera != null) {
      await db`
        INSERT INTO monitor_quantita_giorno (linea_id, data, quantita_giornaliera)
        VALUES (${lineaId}, ${dateStr}::date, ${def.quantita_giornaliera})
        ON CONFLICT (linea_id, data) DO NOTHING
      `;
    }

    const pause = parsePause(def.pause);
    if (pause.length > 0) {
      const [existingPause] = await db`
        SELECT 1 FROM monitor_pausa
        WHERE linea_id = ${lineaId} AND data = ${dateStr}::date LIMIT 1
      `;
      if (!existingPause) {
        for (const p of pause) {
          await db`
            INSERT INTO monitor_pausa (linea_id, data, ora_inizio, ora_fine)
            VALUES (${lineaId}, ${dateStr}::date, ${p.ora_inizio}, ${p.ora_fine})
          `;
        }
      }
    }

    applied++;
  }

  return applied;
}
