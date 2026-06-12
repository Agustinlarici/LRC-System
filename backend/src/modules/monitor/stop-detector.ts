/**
 * Stop Detector — rileva fermate di linea dai gap nella sequenza di produzione
 * e le persiste in monitor_stop_events.
 *
 * Logica: per ogni linea attiva, confronta gli eventi di produzione ordinati
 * nel turno. Ogni gap > cycle_time_sec genera una fermata:
 *   started_at = evento_precedente + cycle_time_sec
 *   ended_at   = evento_successivo (null se fermata ancora aperta)
 *
 * Idempotente: usa ON CONFLICT su (linea_id, started_at).
 */

import { db }               from '../../db/client.js';
import { getExecutiveCache } from './executive-cache.js';
import { logger }            from '../../lib/logger.js';

// ─── Rome time helpers (locali per evitare dipendenze circolari) ──────────────

function romeOffsetStr(d: Date): string {
  const tzName = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome', timeZoneName: 'shortOffset',
  }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = tzName.match(/GMT([+-])(\d+)/);
  if (!match) return '01:00';
  return match[1] === '+' ? `${String(Number(match[2])).padStart(2, '0')}:00` : `-${String(Number(match[2])).padStart(2, '0')}:00`;
}

function getRomeNow() {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const timeStr = `${get('hour')}:${get('minute')}:${get('second')}`;
  return { now, dateStr, timeStr };
}

function romeDt(dateStr: string, hhmm: string, d: Date): Date {
  const offset = romeOffsetStr(d);
  return new Date(`${dateStr}T${hhmm.slice(0, 5)}:00+${offset}`);
}

function timeToMin(t: string) {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// ─── Core detection for a single line ────────────────────────────────────────

async function detectStopsForLine(lineaId: number): Promise<void> {
  const { now, dateStr } = getRomeNow();
  const cache = getExecutiveCache();
  if (!cache) return;

  // Load linea config
  const [linea] = await db`SELECT id, fase FROM monitor_linea WHERE id = ${lineaId} AND attivo = true`;
  if (!linea) return;

  const combos = await db`SELECT modello, componente FROM monitor_linea_combo WHERE linea_id = ${lineaId}`;
  if (combos.length === 0) return;
  const combosSet = new Set(combos.map(c => `${c.modello as string}|${c.componente as string}`));

  const turniOggi = await db`
    SELECT ora_inizio, ora_fine FROM monitor_turno
    WHERE linea_id = ${lineaId} AND data = ${dateStr}::date ORDER BY ora_inizio
  `;
  if (turniOggi.length === 0) return;

  const [qtaRow] = await db`
    SELECT quantita_giornaliera FROM monitor_quantita_giorno
    WHERE linea_id = ${lineaId} AND data = ${dateStr}::date
  `;
  if (!qtaRow) return;

  const pause = await db`
    SELECT ora_inizio, ora_fine FROM monitor_pausa
    WHERE linea_id = ${lineaId} AND data = ${dateStr}::date ORDER BY ora_inizio
  `;

  // Cycle time
  const totalTurnoMin = turniOggi.reduce((acc: number, t) =>
    acc + Math.max(0, timeToMin(t.ora_fine as string) - timeToMin(t.ora_inizio as string)), 0);
  const pauseMin = pause.reduce((acc: number, p) => {
    const pS = timeToMin(p.ora_inizio as string), pE = timeToMin(p.ora_fine as string);
    const overlap = turniOggi.reduce((tAcc: number, t) =>
      tAcc + Math.max(0, Math.min(pE, timeToMin(t.ora_fine as string)) - Math.max(pS, timeToMin(t.ora_inizio as string))), 0);
    return acc + overlap;
  }, 0);
  const nettoMin     = Math.max(1, totalTurnoMin - pauseMin);
  const cycleTimeSec = Math.round((nettoMin * 60) / (qtaRow.quantita_giornaliera as number));

  // Production events for this line in today's turni
  const turnoStart = romeDt(dateStr, turniOggi[0].ora_inizio as string, now);
  const turnoEnd   = romeDt(dateStr, turniOggi[turniOggi.length - 1].ora_fine as string, now);

  const events = cache.rows
    .filter(r => r.fase === (linea.fase as string) && combosSet.has(`${r.modello}|${r.componente}`))
    .map(r => r.data_inserimento)
    .filter(t => t >= turnoStart && t <= now)
    .sort((a, b) => a.getTime() - b.getTime());

  // Collect pause intervals as ms ranges for net-time calculation
  const pauseRanges = pause.map(p => ({
    start: romeDt(dateStr, p.ora_inizio as string, now).getTime(),
    end:   romeDt(dateStr, p.ora_fine   as string, now).getTime(),
  }));

  function netElapsed(fromMs: number, toMs: number): number {
    let pauseMs = 0;
    for (const pr of pauseRanges) {
      pauseMs += Math.max(0, Math.min(pr.end, toMs) - Math.max(pr.start, fromMs));
    }
    return Math.max(0, Math.floor((toMs - fromMs - pauseMs) / 1000));
  }

  // Build list of [gapStart, gapEnd|null] pairs where net gap > cycleTimeSec
  const gaps: Array<{ from: Date; to: Date | null }> = [];

  const checkpoints: Date[] = [turnoStart, ...events];
  const ends: Array<Date | null> = [...events.map(e => e as Date | null), null];

  for (let i = 0; i < checkpoints.length; i++) {
    const from    = checkpoints[i];
    const to      = ends[i];  // null = ongoing
    const toMs    = to ? to.getTime() : Math.min(now.getTime(), turnoEnd.getTime());
    const elapsed = netElapsed(from.getTime(), toMs);
    if (elapsed > cycleTimeSec) {
      gaps.push({ from, to });
    }
  }

  // Upsert each gap as a stop event
  for (const gap of gaps) {
    const startedAt = new Date(gap.from.getTime() + cycleTimeSec * 1000);
    const endedAt   = gap.to ?? null;

    await db`
      INSERT INTO monitor_stop_events (linea_id, started_at, ended_at)
      VALUES (${lineaId}, ${startedAt}, ${endedAt})
      ON CONFLICT (linea_id, started_at) DO UPDATE
        SET ended_at = EXCLUDED.ended_at
        WHERE monitor_stop_events.ended_at IS NULL
    `;

    // Se il gap è chiuso, chiude anche eventuali stop non-manuali aperti rimasti
    // bloccati (es. 'attesa' creati con started_at = NOW() prima del fix)
    if (gap.to !== null) {
      await db`
        UPDATE monitor_stop_events
        SET ended_at = ${gap.to}
        WHERE linea_id  = ${lineaId}
          AND ended_at  IS NULL
          AND source   != 'manuale'
          AND started_at >= ${gap.from}
          AND started_at <  ${gap.to}
      `;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function detectStopsAllLines(): Promise<void> {
  try {
    const linee = await db`SELECT id FROM monitor_linea WHERE attivo = true`;
    await Promise.all(linee.map(l => detectStopsForLine(l.id as number).catch(() => {})));
  } catch (err) {
    logger.error({ err }, 'stop-detector: errore rilevamento fermate');
  }
}

export { detectStopsForLine };
