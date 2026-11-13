// Chiamata che iKnow fa alla VM quando una delibera è accettata: POST /api/delibere/accettate
// (vedi docs/PHOTO-STATION.md). Rotta pubblica per richiesta esplicita: la protegge il token Bearer
// concordato con l'azienda (nel DB solo l'hash). iKnow riprova finché non riceve 200, quindi:
//   - una chiamata valida risponde 200 SEMPRE (anche se è un doppione o la fase non è ancora configurata);
//   - 401 token errato, 503 token non ancora configurato, 400 corpo non valido.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { parseBody } from '../../lib/validate.js';
import { bearerTokenAny, normalizeCommessa, normalizePhase, sha256Hex } from './helpers.js';
import { activePhaseRules, matchPhase, registerEvent } from './events.js';

export const iknowRoutes = new Hono();

/** Chiamate valide ricevute mentre l'origine non è 'api' (in memoria): la pagina le mostra, così non passano inosservate. */
export const ignoredApiCalls: { count: number; last_at: Date | null } = { count: 0, last_at: null };

const Body = z.object({
  seriale:    z.string().trim().min(1).max(64),
  commessa:   z.string().min(1).max(64),
  fase:       z.string().min(1).max(80),
  componente: z.string().trim().min(1).max(80),
  versione:   z.string().trim().min(1).max(40),
  data_ora:   z.string().min(1).max(40),
});

export function parseDataOra(raw: string): Date | null {
  // "2026-10-27 10:00:00" o ISO, con o senza fuso (senza fuso vale l'ora del server: va concordato)
  const d = new Date(raw.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

iknowRoutes.post('/accettate', async (c) => {
  const [cfg] = await db`SELECT token_hash FROM photo_iknow_config WHERE id = 1`;
  if (!cfg) throw new HTTPException(503, { message: 'Integrazione iKnow non configurata' });
  const token = bearerTokenAny(c.req.header('Authorization'));
  const given = Buffer.from(sha256Hex(token ?? ''), 'hex');
  const wanted = Buffer.from(cfg.token_hash as string, 'hex');
  if (!token || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    logger.warn({ ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') }, 'iknow: token non valido');
    throw new HTTPException(401, { message: 'Token non valido' });
  }

  // Solo con l'origine «API» gli ordini nascono da qui. Altrimenti si risponde 200 (iKnow non deve
  // riprovare per sempre) ma non si crea nulla, e la chiamata si conta.
  const [mode] = await db`SELECT mode FROM photo_feed_config WHERE id = 1`;
  if (mode?.mode !== 'api') {
    ignoredApiCalls.count++; ignoredApiCalls.last_at = new Date();
    logger.warn({ mode: mode?.mode ?? 'off' }, 'iknow: chiamata ricevuta ma l\'origine non è «API»: ignorata');
    return c.json({ ok: true, result: 'ignored' });
  }

  const b = await parseBody(c, Body);
  const commessa = normalizeCommessa(b.commessa);       // resta stringa: "000000" non perde gli zeri
  const eventAt = parseDataOra(b.data_ora);
  if (!commessa) throw new HTTPException(400, { message: 'commessa non valida' });
  if (!eventAt) throw new HTTPException(400, { message: 'data_ora non valida' });

  // Fase: nome esatto di iKnow o codice normalizzato. Se non è nel catalogo l'ordine si salva comunque
  // (annullato, con il motivo) e si risponde 200: iKnow non deve riprovare all'infinito.
  const rules = await activePhaseRules();
  const matched = matchPhase(rules, b.fase);
  const phase = matched ?? normalizePhase(b.fase);
  if (!phase) throw new HTTPException(400, { message: 'fase non valida' });

  const ev = { seriale: b.seriale, commessa, fase: b.fase, componente: b.componente, versione: b.versione, eventAt };
  const r = await registerEvent(ev, phase, matched !== null, 'iknow', 'iKnow');
  if (r.result === 'phase_unknown') logger.warn({ phase, jobId: r.jobId }, 'iknow: fase sconosciuta, ordine messo da parte');
  return c.json({ ok: true, result: r.result, ...(r.jobId ? { job_id: r.jobId } : {}) });
});
