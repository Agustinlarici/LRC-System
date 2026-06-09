import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { getExecutiveCache, getDeliberaFasi, isConforming } from './executive-cache.js';
import { syncFullDayToHistory } from './pg-webthron-sync.js';

export const monitorRoutes = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

function parseDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HTTPException(400, { message: 'Data non valida' });
  return raw;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const VALID_LOGOS = ['ferrari', 'maserati', 'aston-martin'] as const;

const lineaSchema = z.object({
  nome:  z.string().min(1),
  fase:  z.string().min(1),
  logo:  z.enum(VALID_LOGOS).nullable().optional(),
});

const comboSchema = z.object({
  modello:    z.string().min(1),
  componente: z.string().min(1),
});


const soglieSchema = z.object({
  soglia_giallo: z.number().int().min(1).max(100),
  soglia_rosso:  z.number().int().min(1).max(100),
});

const pausaSchema = z.object({
  data:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ora_inizio: z.string().regex(/^\d{2}:\d{2}$/),
  ora_fine:   z.string().regex(/^\d{2}:\d{2}$/),
});

// Schema for saving full day data for a line (T1, T2, quantity, pauses)
const giornoSchema = z.object({
  data:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  t1_inizio:            z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t1_fine:              z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t2_inizio:            z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t2_fine:              z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quantita_giornaliera: z.number().int().positive().nullable().optional(),
  pause:                z.array(z.object({
    ora_inizio: z.string().regex(/^\d{2}:\d{2}$/),
    ora_fine:   z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
});

// ─── Linee CRUD ───────────────────────────────────────────────────────────────

monitorRoutes.get('/linee', async (c) => {
  const rows = await db`
    SELECT id, nome, fase, attivo, logo, created_at
    FROM monitor_linea
    ORDER BY nome
  `;
  return c.json(rows);
});

monitorRoutes.post('/linee', async (c) => {
  const body = await parseBody(c, lineaSchema);
  const [row] = await db`
    INSERT INTO monitor_linea (nome, fase)
    VALUES (${body.nome}, ${body.fase})
    RETURNING *
  `;
  return c.json(row, 201);
});

monitorRoutes.patch('/linee/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, lineaSchema.partial());
  const [row] = await db`
    UPDATE monitor_linea
    SET
      nome = COALESCE(${body.nome ?? null}, nome),
      fase = COALESCE(${body.fase ?? null}, fase),
      logo = CASE WHEN ${('logo' in body)} THEN ${body.logo ?? null} ELSE logo END
    WHERE id = ${id}
    RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Linea non trovata' });
  return c.json(row);
});

monitorRoutes.delete('/linee/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [deleted] = await db`DELETE FROM monitor_linea WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Linea non trovata' });
  return c.body(null, 204);
});

// ─── Combo Modello/Componente ─────────────────────────────────────────────────

monitorRoutes.get('/linee/:id/combo', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const rows = await db`
    SELECT id, linea_id, modello, componente
    FROM monitor_linea_combo
    WHERE linea_id = ${lineaId}
    ORDER BY id
  `;
  return c.json(rows);
});

monitorRoutes.post('/linee/:id/combo', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const body = await parseBody(c, comboSchema);
  const [row] = await db`
    INSERT INTO monitor_linea_combo (linea_id, modello, componente)
    VALUES (${lineaId}, ${body.modello}, ${body.componente})
    RETURNING *
  `;
  return c.json(row, 201);
});

monitorRoutes.delete('/combo/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM monitor_linea_combo WHERE id = ${id}`;
  return c.body(null, 204);
});

// ─── Turni ────────────────────────────────────────────────────────────────────

monitorRoutes.get('/linee/:id/turni', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const rows = await db`
    SELECT id, linea_id, data, numero, ora_inizio, ora_fine
    FROM monitor_turno
    WHERE linea_id = ${lineaId}
    ORDER BY data DESC, numero
  `;
  return c.json(rows);
});

monitorRoutes.delete('/turni/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM monitor_turno WHERE id = ${id}`;
  return c.body(null, 204);
});

// ─── Pause operatori ──────────────────────────────────────────────────────────

monitorRoutes.get('/linee/:id/pause', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const rows = await db`
    SELECT id, linea_id, data, ora_inizio, ora_fine
    FROM monitor_pausa
    WHERE linea_id = ${lineaId}
    ORDER BY data DESC, ora_inizio
  `;
  return c.json(rows);
});

monitorRoutes.post('/linee/:id/pause', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const body = await parseBody(c, pausaSchema);
  const [row] = await db`
    INSERT INTO monitor_pausa (linea_id, data, ora_inizio, ora_fine)
    VALUES (${lineaId}, ${body.data}, ${body.ora_inizio}, ${body.ora_fine})
    RETURNING *
  `;
  return c.json(row, 201);
});

monitorRoutes.delete('/pause/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  await db`DELETE FROM monitor_pausa WHERE id = ${id}`;
  return c.body(null, 204);
});

// ─── Soglie colore ────────────────────────────────────────────────────────────

monitorRoutes.get('/linee/:id/soglie', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const [row] = await db`
    SELECT * FROM monitor_soglie WHERE linea_id = ${lineaId}
  `;
  return c.json(row ?? { linea_id: lineaId, soglia_giallo: 50, soglia_rosso: 20 });
});

monitorRoutes.put('/linee/:id/soglie', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const body = await parseBody(c, soglieSchema);
  const [row] = await db`
    INSERT INTO monitor_soglie (linea_id, soglia_giallo, soglia_rosso, updated_at)
    VALUES (${lineaId}, ${body.soglia_giallo}, ${body.soglia_rosso}, NOW())
    ON CONFLICT (linea_id) DO UPDATE
      SET soglia_giallo = EXCLUDED.soglia_giallo,
          soglia_rosso  = EXCLUDED.soglia_rosso,
          updated_at    = NOW()
    RETURNING *
  `;
  return c.json(row);
});

// ─── Giorno: unified read/write for turni calendar view ───────────────────────

// GET /giorno/:data — returns all lines with their T1, T2, quantity, and pauses for a day
monitorRoutes.get('/giorno/:data', async (c) => {
  const data = parseDate(c.req.param('data'));

  const linee = await db`
    SELECT id, nome, fase FROM monitor_linea ORDER BY nome
  `;

  const turni = await db`
    SELECT linea_id, numero, ora_inizio, ora_fine
    FROM monitor_turno
    WHERE data = ${data}
    ORDER BY linea_id, numero
  `;

  const quantita = await db`
    SELECT linea_id, quantita_giornaliera
    FROM monitor_quantita_giorno
    WHERE data = ${data}
  `;

  const pause = await db`
    SELECT id, linea_id, ora_inizio, ora_fine
    FROM monitor_pausa
    WHERE data = ${data}
    ORDER BY linea_id, ora_inizio
  `;

  const result = linee.map(l => {
    const t1 = turni.find(t => t.linea_id === l.id && t.numero === 1);
    const t2 = turni.find(t => t.linea_id === l.id && t.numero === 2);
    const q  = quantita.find(q => q.linea_id === l.id);
    const lp = pause.filter(p => p.linea_id === l.id);
    return {
      linea_id:             l.id,
      linea_nome:           l.nome,
      t1_inizio:            t1 ? (t1.ora_inizio as string).slice(0, 5) : null,
      t1_fine:              t1 ? (t1.ora_fine   as string).slice(0, 5) : null,
      t2_inizio:            t2 ? (t2.ora_inizio as string).slice(0, 5) : null,
      t2_fine:              t2 ? (t2.ora_fine   as string).slice(0, 5) : null,
      quantita_giornaliera: q  ? q.quantita_giornaliera : null,
      pause:                lp.map(p => ({
        id:         p.id,
        ora_inizio: (p.ora_inizio as string).slice(0, 5),
        ora_fine:   (p.ora_fine   as string).slice(0, 5),
      })),
    };
  });

  return c.json(result);
});

// PUT /linee/:id/giorno — save T1, T2, quantity, pauses for a line+day in one transaction
monitorRoutes.put('/linee/:id/giorno', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const body = await parseBody(c, giornoSchema);
  const { data } = body;

  await db.begin(async (sql) => {
    const q = sql as unknown as typeof db;
    // Upsert T1
    if (body.t1_inizio && body.t1_fine) {
      await q`
        INSERT INTO monitor_turno (linea_id, data, numero, ora_inizio, ora_fine)
        VALUES (${lineaId}, ${data}, 1, ${body.t1_inizio}, ${body.t1_fine})
        ON CONFLICT (linea_id, data, numero) DO UPDATE
          SET ora_inizio = EXCLUDED.ora_inizio, ora_fine = EXCLUDED.ora_fine
      `;
    } else {
      await q`DELETE FROM monitor_turno WHERE linea_id = ${lineaId} AND data = ${data} AND numero = 1`;
    }

    // Upsert T2
    if (body.t2_inizio && body.t2_fine) {
      await q`
        INSERT INTO monitor_turno (linea_id, data, numero, ora_inizio, ora_fine)
        VALUES (${lineaId}, ${data}, 2, ${body.t2_inizio}, ${body.t2_fine})
        ON CONFLICT (linea_id, data, numero) DO UPDATE
          SET ora_inizio = EXCLUDED.ora_inizio, ora_fine = EXCLUDED.ora_fine
      `;
    } else {
      await q`DELETE FROM monitor_turno WHERE linea_id = ${lineaId} AND data = ${data} AND numero = 2`;
    }

    // Upsert daily quantity
    if (body.quantita_giornaliera) {
      await q`
        INSERT INTO monitor_quantita_giorno (linea_id, data, quantita_giornaliera)
        VALUES (${lineaId}, ${data}, ${body.quantita_giornaliera})
        ON CONFLICT (linea_id, data) DO UPDATE
          SET quantita_giornaliera = EXCLUDED.quantita_giornaliera
      `;
    } else {
      await q`DELETE FROM monitor_quantita_giorno WHERE linea_id = ${lineaId} AND data = ${data}`;
    }

    // Replace all pauses for this line+day
    if (body.pause !== undefined) {
      await q`DELETE FROM monitor_pausa WHERE linea_id = ${lineaId} AND data = ${data}`;
      for (const p of body.pause ?? []) {
        await q`
          INSERT INTO monitor_pausa (linea_id, data, ora_inizio, ora_fine)
          VALUES (${lineaId}, ${data}, ${p.ora_inizio}, ${p.ora_fine})
        `;
      }
    }
  });

  return c.body(null, 204);
});

// ─── Timezone helper ──────────────────────────────────────────────────────────
// Usa sempre Europe/Rome — gestisce automaticamente CET (UTC+1) e CEST (UTC+2)

// Ritorna l'offset Rome come stringa ISO (es. "01:00" o "02:00") per costruire Date corretti
// Usa Intl per evitare il bug quando TZ=Europe/Rome nel container (toLocaleString restituisce 0)
function romeOffsetStr(d: Date): string {
  const tzName = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome', timeZoneName: 'shortOffset',
  }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = tzName.match(/GMT([+-])(\d+)/);
  if (!match) return '01:00';
  const h = String(Number(match[2])).padStart(2, '0');
  return match[1] === '+' ? `${h}:00` : `-${h}:00`;
}

function getRomeNow(): { now: Date; timeStr: string; dateStr: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return {
    now,
    timeStr: `${get('hour')}:${get('minute')}`,
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// ─── Stato monitor (endpoint pubblico) ────────────────────────────────────────

monitorRoutes.get('/stato/:id', async (c) => {
  const id = parseId(c.req.param('id'));

  const [linea] = await db`
    SELECT id, nome, fase, logo
    FROM monitor_linea
    WHERE id = ${id} AND attivo = true
  `;
  if (!linea) throw new HTTPException(404, { message: 'Monitor non trovato' });

  const combos = await db`SELECT modello, componente FROM monitor_linea_combo WHERE linea_id = ${id}`;
  const combosSet = new Set(combos.map(c => `${c.modello}|${c.componente}`));

  // Ultima commessa dalla fase precedente nella sequenza SPMA
  const [prevFaseRow] = await db`
    SELECT fs2.fase_name AS prev_fase
    FROM spma_fase_sequence fs1
    JOIN spma_fase_sequence fs2
      ON fs2.component_category_id = fs1.component_category_id
      AND fs2.order_index = fs1.order_index - 1
    WHERE fs1.fase_name = ${linea.fase}
    LIMIT 1
  `;
  let commesse: string[] = [];
  if (prevFaseRow) {
    const rows = await db`
      SELECT DISTINCT weh.commessa
      FROM webthron_events_history weh
      WHERE weh.fase = ${prevFaseRow.prev_fase}
        AND weh.commessa IS NOT NULL AND weh.commessa != ''
        AND EXISTS (
          SELECT 1 FROM monitor_linea_combo mlc
          WHERE mlc.linea_id = ${id}
            AND mlc.modello = weh.modello
            AND mlc.componente = weh.componente
        )
        AND weh.data_cache >= (NOW() AT TIME ZONE 'Europe/Rome')::date - INTERVAL '1 day'
        AND weh.commessa NOT IN (
          SELECT DISTINCT weh2.commessa
          FROM webthron_events_history weh2
          WHERE weh2.fase IN (
            SELECT fs_later.fase_name
            FROM spma_fase_sequence fs_curr
            JOIN spma_fase_sequence fs_later
              ON fs_later.component_category_id = fs_curr.component_category_id
             AND fs_later.order_index >= fs_curr.order_index
            WHERE fs_curr.fase_name = ${linea.fase}
          )
            AND weh2.commessa IS NOT NULL AND weh2.commessa != ''
            AND EXISTS (
              SELECT 1 FROM monitor_linea_combo mlc2
              WHERE mlc2.linea_id = ${id}
                AND mlc2.modello = weh2.modello
                AND mlc2.componente = weh2.componente
            )
        )
      ORDER BY weh.commessa
    `;
    commesse = rows.map(r => r.commessa as string);
  }

  const { now, timeStr, dateStr } = getRomeNow();

  // Get all turni for today (data in orario Europe/Rome)
  const turniOggi = await db`
    SELECT numero, ora_inizio, ora_fine
    FROM monitor_turno
    WHERE linea_id = ${id} AND data = ${dateStr}::date
    ORDER BY numero
  `;

  // Find which turno is currently active (if any)
  const turnoAttivo = turniOggi.find(t => {
    const ini = (t.ora_inizio as string).slice(0, 5);
    const fin = (t.ora_fine   as string).slice(0, 5);
    return timeStr >= ini && timeStr <= fin;
  });

  // Get daily quantity
  const [qtaRow] = await db`
    SELECT quantita_giornaliera
    FROM monitor_quantita_giorno
    WHERE linea_id = ${id} AND data = ${dateStr}::date
  `;

  const [soglie] = await db`
    SELECT soglia_giallo, soglia_rosso FROM monitor_soglie WHERE linea_id = ${id}
  `;
  const soglieColore = soglie ?? { soglia_giallo: 50, soglia_rosso: 20 };

  if (!turnoAttivo || !qtaRow) {
    return c.json({
      linea:                { id: linea.id, nome: linea.nome, logo: linea.logo ?? null },
      turno_attivo:         false,
      qta_prodotta:         0,
      qta_da_produrre:      qtaRow?.quantita_giornaliera ?? 0,
      cycle_time_sec:       null,
      ultimo_evento:        null,
      elapsed_sec:          null,
      remaining_sec:        null,
      linestop_sec:         0,
      avanzamento_previsto: 0,
      commesse:             commesse,
      soglie:               soglieColore,
    });
  }

  // Pauses for today
  const pause = await db`
    SELECT ora_inizio, ora_fine
    FROM monitor_pausa
    WHERE linea_id = ${id} AND data = ${dateStr}::date
    ORDER BY ora_inizio
  `;

  // Helper: costruisce un Date da HH:MM in orario Rome
  const offset = romeOffsetStr(now);
  const romeDt = (hhmm: string) =>
    new Date(`${dateStr}T${(hhmm as string).slice(0, 5)}:00+${offset}`);

  // ── Cycle time ─────────────────────────────────────────────────────────────
  function timeToMin(t: string) {
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  }

  const totalTurnoMinutes = turniOggi.reduce((acc, t) => {
    return acc + Math.max(0, timeToMin(t.ora_fine as string) - timeToMin(t.ora_inizio as string));
  }, 0);

  const pauseMinuti = pause.reduce((acc, p) => {
    const pStart = timeToMin(p.ora_inizio as string);
    const pEnd   = timeToMin(p.ora_fine   as string);
    const overlapWithTurni = turniOggi.reduce((tAcc, t) => {
      const oStart = Math.max(pStart, timeToMin(t.ora_inizio as string));
      const oEnd   = Math.min(pEnd,   timeToMin(t.ora_fine   as string));
      return tAcc + Math.max(0, oEnd - oStart);
    }, 0);
    return acc + overlapWithTurni;
  }, 0);

  const nettoMinuti  = Math.max(1, totalTurnoMinutes - pauseMinuti);
  const cycleTimeSec = Math.round((nettoMinuti * 60) / (qtaRow.quantita_giornaliera as number));

  // ── Cache ──────────────────────────────────────────────────────────────────
  const execCache = getExecutiveCache();
  const allProdTimestamps = (execCache?.rows ?? [])
    .filter(r => r.fase === (linea.fase as string) && combosSet.has(`${r.modello}|${r.componente}`))
    .map(r => r.data_inserimento)
    .sort((a, b) => a.getTime() - b.getTime());

  const turnoStartTs = romeDt(turnoAttivo.ora_inizio as string);

  // Timestamps del turno attivo (filtra eventi fuori dal turno corrente)
  const turnoTimestamps = allProdTimestamps.filter(
    t => t.getTime() >= turnoStartTs.getTime() && t.getTime() <= now.getTime(),
  );

  const qtaProdotta  = turnoTimestamps.length;
  const ultimoEvento = turnoTimestamps[turnoTimestamps.length - 1] ?? null;

  // ── Line Stop (gap analysis su cicli passati) ──────────────────────────────
  let pastLinestopSec = 0;

  // Gap dall'inizio turno al primo pezzo
  if (turnoTimestamps.length > 0) {
    const gapInizio = (turnoTimestamps[0].getTime() - turnoStartTs.getTime()) / 1000;
    if (gapInizio > cycleTimeSec) pastLinestopSec += gapInizio - cycleTimeSec;
  }

  // Gap tra pezzi consecutivi
  for (let i = 1; i < turnoTimestamps.length; i++) {
    const gap = (turnoTimestamps[i].getTime() - turnoTimestamps[i - 1].getTime()) / 1000;
    if (gap > cycleTimeSec) pastLinestopSec += gap - cycleTimeSec;
  }

  // ── Check pausa corrente ───────────────────────────────────────────────────
  const currentPausa = pause.find(p => {
    const start = (p.ora_inizio as string).slice(0, 5);
    const end   = (p.ora_fine   as string).slice(0, 5);
    return timeStr >= start && timeStr < end;
  });
  const inPausa = !!currentPausa;

  // ── Avanzamento previsto ───────────────────────────────────────────────────
  const turnoEndTs       = romeDt(turnoAttivo.ora_fine as string);
  const totalShiftSec    = (turnoEndTs.getTime() - turnoStartTs.getTime()) / 1000;
  const totalPausaSec    = pause.reduce((acc, p) => {
    const ps = romeDt(p.ora_inizio as string).getTime();
    const pe = romeDt(p.ora_fine   as string).getTime();
    return acc + Math.max(0, (pe - ps) / 1000);
  }, 0);
  const netShiftSec      = Math.max(1, totalShiftSec - totalPausaSec);

  // Riferimento temporale: se in pausa, congela all'inizio della pausa
  const refNow = inPausa && currentPausa
    ? romeDt(currentPausa.ora_inizio as string)
    : now;

  const completedPausaSec = pause.reduce((acc, p) => {
    const ps = romeDt(p.ora_inizio as string).getTime();
    const pe = romeDt(p.ora_fine   as string).getTime();
    if (pe <= refNow.getTime()) return acc + (pe - ps) / 1000;
    return acc;
  }, 0);

  const elapsedFromStartSec = Math.max(0, (refNow.getTime() - turnoStartTs.getTime()) / 1000);
  const netElapsedSec       = Math.max(0, Math.min(netShiftSec, elapsedFromStartSec - completedPausaSec));
  const avanzamentoPrevisto = Math.floor(netElapsedSec / cycleTimeSec);

  // ── Fermata manuale aperta ────────────────────────────────────────────────
  const [openStop] = await db`
    SELECT EXTRACT(EPOCH FROM (NOW() - started_at))::INT AS fermata_elapsed_sec
    FROM monitor_stop_events
    WHERE linea_id = ${id} AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1
  `;
  const fermataManuale     = !!openStop;
  const fermataElapsedSec  = (openStop?.fermata_elapsed_sec as number | null) ?? null;

  // ── Risposta durante pausa ─────────────────────────────────────────────────
  if (inPausa) {
    return c.json({
      linea:                { id: linea.id, nome: linea.nome, logo: linea.logo ?? null },
      turno_attivo:         true,
      in_pausa:             true,
      fermata_manuale:      fermataManuale,
      fermata_elapsed_sec:  fermataElapsedSec,
      qta_prodotta:         qtaProdotta,
      qta_da_produrre:      qtaRow.quantita_giornaliera,
      cycle_time_sec:       cycleTimeSec,
      ultimo_evento:        ultimoEvento?.toISOString() ?? null,
      elapsed_sec:          null,
      remaining_sec:        null,
      linestop_sec:         Math.floor(pastLinestopSec),
      avanzamento_previsto: avanzamentoPrevisto,
      commesse:             commesse,
      soglie:               soglieColore,
    });
  }

  // ── Elapsed corrente ───────────────────────────────────────────────────────
  const refTime    = ultimoEvento ?? turnoStartTs;
  const rawElapsed = Math.floor((now.getTime() - refTime.getTime()) / 1000);

  const pauseSecBetween = pause.reduce((acc, p) => {
    const pStartMs = romeDt(p.ora_inizio as string).getTime();
    const pEndMs   = romeDt(p.ora_fine   as string).getTime();
    const overlapStart = Math.max(pStartMs, refTime.getTime());
    const overlapEnd   = Math.min(pEndMs,   now.getTime());
    return acc + Math.max(0, Math.floor((overlapEnd - overlapStart) / 1000));
  }, 0);

  const elapsedSec           = Math.max(0, rawElapsed - pauseSecBetween);
  const currentCycleLinestop = Math.max(0, elapsedSec - cycleTimeSec);
  const linestopSec          = Math.floor(pastLinestopSec) + currentCycleLinestop;

  return c.json({
    linea:                { id: linea.id, nome: linea.nome, logo: linea.logo ?? null },
    turno_attivo:         true,
    in_pausa:             false,
    fermata_manuale:      fermataManuale,
    fermata_elapsed_sec:  fermataElapsedSec,
    qta_prodotta:         qtaProdotta,
    qta_da_produrre:      qtaRow.quantita_giornaliera,
    cycle_time_sec:       cycleTimeSec,
    ultimo_evento:        ultimoEvento?.toISOString() ?? null,
    elapsed_sec:          elapsedSec,
    remaining_sec:        cycleTimeSec - elapsedSec,
    linestop_sec:         linestopSec,
    avanzamento_previsto: avanzamentoPrevisto,
    commesse:             commesse,
    soglie:               soglieColore,
  });
});

// ─── Executive dashboard ──────────────────────────────────────────────────────
// GET /api/monitor/executive — all-lines daily OEE summary, single PG query + cache reads

monitorRoutes.get('/executive', async (c) => {
  const { now, dateStr: todayStr } = getRomeNow();
  const dateParam  = c.req.query('date');
  const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  const dateStr    = (isValidDate && dateParam! < todayStr) ? dateParam! : todayStr;
  const isHistorical = dateStr < todayStr;

  // ONE PostgreSQL query: all active lines with their daily turni, fermi, pausa, quantita
  // Note: midnight-crossing shifts (e.g. 22:00–06:00) not supported — TIME subtraction
  // would yield a negative interval. Standard Italian shifts are within one calendar day.
  const linee = await db`
    SELECT
      ml.id,
      ml.nome,
      ml.logo,
      ml.fase,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('modello', mlc.modello, 'componente', mlc.componente))
          FILTER (WHERE mlc.id IS NOT NULL),
        '[]'::json
      )                                                                       AS combos,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM (mt.ora_fine::time - mt.ora_inizio::time))
      ) FILTER (WHERE mt.id IS NOT NULL), 0) / 60.0                           AS minuti_turno,
      MIN(mt.ora_inizio::text) FILTER (WHERE mt.id IS NOT NULL)               AS turno_inizio_min,
      MAX(mt.ora_fine::text)   FILTER (WHERE mt.id IS NOT NULL)               AS turno_fine_max,
      COALESCE((
        SELECT mqg.quantita_giornaliera
        FROM monitor_quantita_giorno mqg
        WHERE mqg.linea_id = ml.id AND mqg.data = ${dateStr}::date
      ), 0)                                                                    AS pezzi_pianificati,
      COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (mp.ora_fine::time - mp.ora_inizio::time)))
        FROM monitor_pausa mp
        WHERE mp.linea_id = ml.id AND mp.data = ${dateStr}::date
      ), 0) / 60.0                                                             AS minuti_pausa
    FROM monitor_linea ml
    LEFT JOIN monitor_turno       mt  ON mt.linea_id  = ml.id AND mt.data = ${dateStr}::date
    LEFT JOIN monitor_linea_combo mlc ON mlc.linea_id = ml.id
    WHERE ml.attivo = true
    GROUP BY ml.id, ml.nome, ml.logo, ml.fase
    ORDER BY ml.nome
  `;

  // Production rows — history table for past dates, in-memory cache for today
  const deliberaFasi = getDeliberaFasi();
  let allRows: Array<{ fase: string; modello: string; componente: string; cod_seriale: string; esito_delibera: string | null; data_inserimento: Date }>;
  if (isHistorical) {
    const histRows = await db`
      SELECT fase, modello, componente, cod_seriale, esito_delibera, data_inserimento
      FROM webthron_events_history
      WHERE data_cache = ${dateStr}::date
      ORDER BY data_inserimento ASC
    `;
    allRows = histRows.map(r => ({
      fase:             r.fase             as string,
      modello:          r.modello          as string,
      componente:       r.componente       as string,
      cod_seriale:      r.cod_seriale      as string,
      esito_delibera:   r.esito_delibera   as string | null,
      data_inserimento: new Date(r.data_inserimento as string),
    }));
  } else {
    allRows = getExecutiveCache()?.rows ?? [];
  }

  // Build per-line summaries
  const lineeOut = linee.map(l => {
    const combos: Array<{ modello: string; componente: string }> = (l.combos as Array<{ modello: string; componente: string }>) ?? [];

    // pezzi_reali: production rows matching this line's fase + combos
    const combosSet = new Set(combos.map(c => `${c.modello}|${c.componente}`));
    const prodRows  = allRows.filter(r =>
      r.fase === (l.fase as string) && combosSet.has(`${r.modello}|${r.componente}`)
    );
    const pezzi_reali  = prodRows.length;

    // quality: match delibera events to produced serials only
    // rows are ordered ASC — last entry per serial wins
    const prodSerials  = new Set(prodRows.map(r => r.cod_seriale));
    const deliberaRows = prodSerials.size > 0
      ? allRows.filter(r =>
          deliberaFasi.includes(r.fase) && prodSerials.has(r.cod_seriale)
        )
      : [];
    const latestBySerial = new Map<string, string | null>();
    for (const r of deliberaRows) latestBySerial.set(r.cod_seriale, r.esito_delibera);
    const pezzi_deliberati = latestBySerial.size;
    let pezzi_conformi = 0;
    for (const esito of latestBySerial.values()) if (isConforming(esito)) pezzi_conformi++;

    const minuti_turno      = Number(l.minuti_turno) || 0;
    const minuti_pausa      = Number(l.minuti_pausa) || 0;
    const pezzi_pianificati = Number(l.pezzi_pianificati) || 0;
    const turno_oggi        = minuti_turno > 0;

    // Gap-based fermo calculation — same logic as Andon /stato
    const net_planned_pre = Math.max(1, minuti_turno - minuti_pausa);
    const cycleTimeSec = (turno_oggi && pezzi_pianificati > 0)
      ? Math.round(net_planned_pre * 60 / pezzi_pianificati)
      : null;

    const romeOffset = romeOffsetStr(now);
    const turnoStartTs = (turno_oggi && l.turno_inizio_min)
      ? new Date(`${dateStr}T${(l.turno_inizio_min as string).slice(0, 5)}:00+${romeOffset}`)
      : null;
    const turnoFineTs = (turno_oggi && l.turno_fine_max)
      ? new Date(`${dateStr}T${(l.turno_fine_max as string).slice(0, 5)}:00+${romeOffset}`)
      : null;

    const prodTimestamps = prodRows
      .map(r => r.data_inserimento)
      .sort((a, b) => a.getTime() - b.getTime());

    // Gap analysis — collect stop events + sum lost time
    type Fermata = { inizio: string; fine: string | null; durata_min: number };
    const fermate: Fermata[] = [];
    let minuti_fermo = 0;

    if (cycleTimeSec && turnoStartTs && prodTimestamps.length > 0) {
      // Gap from turno start to first piece
      const gapStart = (prodTimestamps[0].getTime() - turnoStartTs.getTime()) / 1000;
      if (gapStart > cycleTimeSec) {
        const dur = gapStart - cycleTimeSec;
        fermate.push({
          inizio: new Date(turnoStartTs.getTime() + cycleTimeSec * 1000).toISOString(),
          fine:   prodTimestamps[0].toISOString(),
          durata_min: Math.round(dur / 60),
        });
        minuti_fermo += dur / 60;
      }
      // Gaps between consecutive pieces
      for (let i = 1; i < prodTimestamps.length; i++) {
        const gap = (prodTimestamps[i].getTime() - prodTimestamps[i - 1].getTime()) / 1000;
        if (gap > cycleTimeSec) {
          const dur = gap - cycleTimeSec;
          fermate.push({
            inizio: new Date(prodTimestamps[i - 1].getTime() + cycleTimeSec * 1000).toISOString(),
            fine:   prodTimestamps[i].toISOString(),
            durata_min: Math.round(dur / 60),
          });
          minuti_fermo += dur / 60;
        }
      }
    }
    minuti_fermo = Math.round(minuti_fermo);

    // Current ferma: only meaningful for today (historical dates always = false)
    const lastTs = prodTimestamps[prodTimestamps.length - 1] ?? null;
    const inTurno = !isHistorical && turnoStartTs && turnoFineTs
      && now >= turnoStartTs && now <= turnoFineTs;
    const elapsedSinceLastSec = (!isHistorical && lastTs) ? (now.getTime() - lastTs.getTime()) / 1000 : null;
    const ferma_adesso = !!(inTurno && cycleTimeSec && elapsedSinceLastSec != null && elapsedSinceLastSec > cycleTimeSec);
    const ferma_da_min = ferma_adesso && cycleTimeSec && elapsedSinceLastSec != null
      ? Math.round((elapsedSinceLastSec - cycleTimeSec) / 60)
      : null;
    // Add ongoing stop to fermate list (only for today)
    if (ferma_adesso && cycleTimeSec && lastTs) {
      fermate.push({
        inizio:     new Date(lastTs.getTime() + cycleTimeSec * 1000).toISOString(),
        fine:       null,
        durata_min: ferma_da_min ?? 0,
      });
    }

    // Avanzamento previsto — for historical dates use pezzi_pianificati (full day)
    let avanzamento_previsto = 0;
    if (isHistorical) {
      avanzamento_previsto = pezzi_pianificati;
    } else if (turno_oggi && turnoStartTs && turnoFineTs && pezzi_pianificati > 0) {
      const totalShiftSec  = (turnoFineTs.getTime() - turnoStartTs.getTime()) / 1000;
      const totalPausaSec  = 0;
      const netShiftSec    = Math.max(1, totalShiftSec - totalPausaSec);
      const elapsedSec     = Math.max(0, Math.min(netShiftSec, (now.getTime() - turnoStartTs.getTime()) / 1000));
      avanzamento_previsto = Math.round(pezzi_pianificati * elapsedSec / netShiftSec);
    }

    // OEE — daily, based on total turno time for today
    const net_planned   = net_planned_pre;
    const disponibilita = turno_oggi
      ? Math.max(0, Math.min(1, (net_planned - minuti_fermo) / net_planned))
      : 0;
    const performance = (turno_oggi && pezzi_pianificati > 0)
      ? Math.min(1, pezzi_reali / pezzi_pianificati)
      : 0;
    // TODO: qualità defaults to 1.0 when no delibera data for this line's combos
    const qualita = pezzi_deliberati > 0
      ? Math.max(0, Math.min(1, pezzi_conformi / pezzi_deliberati))
      : 1.0;
    const oee = Math.round(disponibilita * performance * qualita * 1000) / 10;

    let status: 'verde' | 'giallo' | 'rosso' | 'nessun_turno';
    if (!turno_oggi)                      status = 'nessun_turno';
    else if (!isHistorical && ferma_adesso) status = 'rosso';
    else if (oee < 60)                    status = 'giallo';
    else                                  status = 'verde';

    return {
      id:               l.id      as number,
      nome:             l.nome    as string,
      logo:             (l.logo ?? null) as string | null,
      pezzi_reali,
      pezzi_pianificati,
      avanzamento_previsto,
      pezzi_conformi,
      pezzi_deliberati,
      minuti_turno:     Math.round(minuti_turno),
      minuti_fermo:     Math.round(minuti_fermo),
      minuti_pausa:     Math.round(minuti_pausa),
      disponibilita:    Math.round(disponibilita * 1000) / 10,
      performance:      Math.round(performance * 1000) / 10,
      qualita:          Math.round(qualita * 1000) / 10,
      oee,
      turno_oggi,
      ferma_adesso,
      ferma_da_min,
      fermi_count:      fermate.length,
      fermate,
      status,
    };
  });

  // KPI aggregates
  const withTurno = lineeOut.filter(l => l.turno_oggi);

  const produzione_reale       = lineeOut.reduce((a, l) => a + l.pezzi_reali, 0);
  const produzione_pianificata = lineeOut.reduce((a, l) => a + l.avanzamento_previsto, 0);
  const tempo_perso_min        = lineeOut.reduce((a, l) => a + l.minuti_fermo, 0);
  const fermi_count_tot        = lineeOut.reduce((a, l) => a + l.fermi_count, 0);

  // OEE generale: weighted average by minuti_turno
  const totalTurnoMin = withTurno.reduce((a, l) => a + l.minuti_turno, 0);
  const oee_generale  = totalTurnoMin > 0
    ? Math.round(withTurno.reduce((a, l) => a + l.oee * l.minuti_turno, 0) / totalTurnoMin * 10) / 10
    : 0;

  // Qualità globale (null = no delibera data at all today)
  const totalDeliberati = lineeOut.reduce((a, l) => a + l.pezzi_deliberati, 0);
  const totalConformi   = lineeOut.reduce((a, l) => a + l.pezzi_conformi, 0);
  const qualita_pct     = totalDeliberati > 0
    ? Math.round(totalConformi / totalDeliberati * 1000) / 10
    : null;

  return c.json({
    aggiornato_at:  new Date().toISOString(),
    date:           dateStr,
    is_historical:  isHistorical,
    delibera_fasi:  deliberaFasi,
    kpi: {
      oee_generale,
      tempo_perso_min,
      fermi_count:           fermi_count_tot,
      produzione_reale,
      produzione_pianificata,
      qualita_pct,
    },
    linee: lineeOut,
  });
});

// ─── Resumen: gruppi configurabili di linee andon ─────────────────────────────

const resumenSchema = z.object({
  nome: z.string().min(1).max(100),
});

const resumenLineeSchema = z.object({
  linea_ids: z.array(z.number().int().positive()),
});

monitorRoutes.get('/resumen', async (c) => {
  const rows = await db`
    SELECT r.id, r.nome, r.created_at,
           COUNT(rl.linea_id)::int AS linea_count
    FROM monitor_resumen r
    LEFT JOIN monitor_resumen_linee rl ON rl.resumen_id = r.id
    GROUP BY r.id, r.nome, r.created_at
    ORDER BY r.nome
  `;
  return c.json(rows);
});

monitorRoutes.get('/resumen/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [row] = await db`SELECT id, nome, created_at FROM monitor_resumen WHERE id = ${id}`;
  if (!row) throw new HTTPException(404, { message: 'Resumen non trovato' });
  const linee = await db`
    SELECT rl.linea_id, ml.nome, ml.fase, ml.attivo
    FROM monitor_resumen_linee rl
    JOIN monitor_linea ml ON ml.id = rl.linea_id
    WHERE rl.resumen_id = ${id}
    ORDER BY rl.ordine, ml.nome
  `;
  return c.json({ ...row, linee });
});

monitorRoutes.post('/resumen', async (c) => {
  const body = await parseBody(c, resumenSchema);
  const [row] = await db`
    INSERT INTO monitor_resumen (nome) VALUES (${body.nome}) RETURNING *
  `;
  return c.json(row, 201);
});

monitorRoutes.patch('/resumen/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, resumenSchema);
  const [row] = await db`
    UPDATE monitor_resumen SET nome = ${body.nome} WHERE id = ${id} RETURNING *
  `;
  if (!row) throw new HTTPException(404, { message: 'Resumen non trovato' });
  return c.json(row);
});

monitorRoutes.delete('/resumen/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const [deleted] = await db`DELETE FROM monitor_resumen WHERE id = ${id} RETURNING id`;
  if (!deleted) throw new HTTPException(404, { message: 'Resumen non trovato' });
  return c.body(null, 204);
});

monitorRoutes.put('/resumen/:id/linee', async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, resumenLineeSchema);
  await db.begin(async (sql) => {
    const q = sql as unknown as typeof db;
    await q`DELETE FROM monitor_resumen_linee WHERE resumen_id = ${id}`;
    for (let i = 0; i < body.linea_ids.length; i++) {
      await q`
        INSERT INTO monitor_resumen_linee (resumen_id, linea_id, ordine)
        VALUES (${id}, ${body.linea_ids[i]}, ${i})
      `;
    }
  });
  return c.body(null, 204);
});

// ─── Turni default (per linea × giorno settimana) ─────────────────────────────

const turnoDefaultRowSchema = z.object({
  day_of_week:          z.number().int().min(0).max(6),
  t1_inizio:            z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t1_fine:              z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t2_inizio:            z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  t2_fine:              z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quantita_giornaliera: z.number().int().positive().nullable().optional(),
  pause:                z.array(z.object({
    ora_inizio: z.string().regex(/^\d{2}:\d{2}$/),
    ora_fine:   z.string().regex(/^\d{2}:\d{2}$/),
  })).optional(),
});

// GET /linee/:id/defaults — 7 righe (una per giorno), create on-the-fly se mancano
monitorRoutes.get('/linee/:id/defaults', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const rows = await db`
    SELECT day_of_week, t1_inizio, t1_fine, t2_inizio, t2_fine, quantita_giornaliera, pause
    FROM monitor_turno_default
    WHERE linea_id = ${lineaId}
    ORDER BY day_of_week
  `;
  const byDow = new Map(rows.map(r => [r.day_of_week as number, r]));
  const result = Array.from({ length: 7 }, (_, i) => {
    const r = byDow.get(i);
    return {
      day_of_week:          i,
      t1_inizio:            r ? (r.t1_inizio as string | null) : null,
      t1_fine:              r ? (r.t1_fine   as string | null) : null,
      t2_inizio:            r ? (r.t2_inizio as string | null) : null,
      t2_fine:              r ? (r.t2_fine   as string | null) : null,
      quantita_giornaliera: r ? (r.quantita_giornaliera as number | null) : null,
      pause:                r ? (r.pause as Array<{ ora_inizio: string; ora_fine: string }>) : [],
    };
  });
  return c.json(result);
});

// PUT /linee/:id/defaults — salva tutti e 7 i giorni
monitorRoutes.put('/linee/:id/defaults', async (c) => {
  const lineaId = parseId(c.req.param('id'));
  const body = await parseBody(c, z.array(turnoDefaultRowSchema));
  for (const row of body) {
    const pauseJson = JSON.stringify(row.pause ?? []);
    await db`
      INSERT INTO monitor_turno_default
        (linea_id, day_of_week, t1_inizio, t1_fine, t2_inizio, t2_fine, quantita_giornaliera, pause)
      VALUES (
        ${lineaId}, ${row.day_of_week},
        ${row.t1_inizio ?? null}, ${row.t1_fine ?? null},
        ${row.t2_inizio ?? null}, ${row.t2_fine ?? null},
        ${row.quantita_giornaliera ?? null},
        ${pauseJson}::jsonb
      )
      ON CONFLICT (linea_id, day_of_week) DO UPDATE SET
        t1_inizio            = EXCLUDED.t1_inizio,
        t1_fine              = EXCLUDED.t1_fine,
        t2_inizio            = EXCLUDED.t2_inizio,
        t2_fine              = EXCLUDED.t2_fine,
        quantita_giornaliera = EXCLUDED.quantita_giornaliera,
        pause                = EXCLUDED.pause
    `;
  }
  return c.body(null, 204);
});

// GET /defaults-for-date/:data — defaults di tutte le linee per il giorno della settimana della data
monitorRoutes.get('/defaults-for-date/:data', async (c) => {
  const data = parseDate(c.req.param('data'));
  const dow = new Date(data).getUTCDay(); // 0=Dom … 6=Sab
  const rows = await db`
    SELECT linea_id, t1_inizio, t1_fine, t2_inizio, t2_fine, quantita_giornaliera, pause
    FROM monitor_turno_default
    WHERE day_of_week = ${dow}
  `;
  const result: Record<number, {
    t1_inizio: string | null; t1_fine: string | null;
    t2_inizio: string | null; t2_fine: string | null;
    quantita_giornaliera: number | null;
    pause: Array<{ ora_inizio: string; ora_fine: string }>;
  }> = {};
  for (const r of rows) {
    result[r.linea_id as number] = {
      t1_inizio:            (r.t1_inizio as string | null),
      t1_fine:              (r.t1_fine   as string | null),
      t2_inizio:            (r.t2_inizio as string | null),
      t2_fine:              (r.t2_fine   as string | null),
      quantita_giornaliera: (r.quantita_giornaliera as number | null),
      pause:                (r.pause as Array<{ ora_inizio: string; ora_fine: string }>),
    };
  }
  return c.json(result);
});

// ─── Sync manuale WebThron ────────────────────────────────────────────────────

monitorRoutes.post('/admin/sync-day', async (c) => {
  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HTTPException(400, { message: 'Parametro date mancante o non valido (YYYY-MM-DD)' });
  }
  const count = await syncFullDayToHistory(date);
  return c.json({ ok: true, date, rows_synced: count });
});
