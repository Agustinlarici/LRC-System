import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { getWebthronCache } from './webthron-cache.js';

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
function romeOffsetStr(d: Date): string {
  const utcMs   = d.getTime();
  const romeMs  = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Rome' })).getTime();
  const offsetH = Math.round((romeMs - utcMs) / 3_600_000);
  return offsetH >= 0 ? `${String(offsetH).padStart(2, '0')}:00` : `-${String(-offsetH).padStart(2, '0')}:00`;
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

  const combos = await db`
    SELECT modello, componente FROM monitor_linea_combo WHERE linea_id = ${id}
  `;

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
  const cached = getWebthronCache(id);
  const turnoStartTs  = romeDt(turnoAttivo.ora_inizio as string);

  // Timestamps del turno attivo (filtra eventi fuori dal turno corrente)
  const turnoTimestamps = (cached?.timestamps ?? []).filter(
    t => t.getTime() >= turnoStartTs.getTime() && t.getTime() <= now.getTime(),
  );

  const qtaProdotta  = turnoTimestamps.length;
  const ultimoEvento = turnoTimestamps[turnoTimestamps.length - 1] ?? null;

  // ── Line Stop (gap analysis su cicli passati) ──────────────────────────────
  let pastLinestopSec = 0;
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
  const avanzamentoPrevisto = Math.round((qtaRow.quantita_giornaliera as number) * netElapsedSec / netShiftSec);

  // ── Risposta durante pausa ─────────────────────────────────────────────────
  if (inPausa) {
    return c.json({
      linea:                { id: linea.id, nome: linea.nome, logo: linea.logo ?? null },
      turno_attivo:         true,
      in_pausa:             true,
      qta_prodotta:         qtaProdotta,
      qta_da_produrre:      qtaRow.quantita_giornaliera,
      cycle_time_sec:       cycleTimeSec,
      ultimo_evento:        ultimoEvento?.toISOString() ?? null,
      elapsed_sec:          null,
      remaining_sec:        null,
      linestop_sec:         Math.floor(pastLinestopSec),
      avanzamento_previsto: avanzamentoPrevisto,
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
    qta_prodotta:         qtaProdotta,
    qta_da_produrre:      qtaRow.quantita_giornaliera,
    cycle_time_sec:       cycleTimeSec,
    ultimo_evento:        ultimoEvento?.toISOString() ?? null,
    elapsed_sec:          elapsedSec,
    remaining_sec:        cycleTimeSec - elapsedSec,
    linestop_sec:         linestopSec,
    avanzamento_previsto: avanzamentoPrevisto,
    soglie:               soglieColore,
  });
});
