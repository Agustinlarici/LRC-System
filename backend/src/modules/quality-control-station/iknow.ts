// Chiamata che iKnow fa alla VM quando una delibera è accettata: POST /api/delibere/accettate
// (vedi docs/QUALITY-CONTROL-STATION.md). Rotta pubblica per richiesta esplicita: la protegge il token Bearer
// concordato con l'azienda (nel DB solo l'hash). iKnow riprova finché non riceve 200, quindi:
//   - una chiamata valida risponde 200 SEMPRE (anche se è un doppione o la fase non è ancora configurata);
//   - 401 token errato, 503 token non ancora configurato, 400 corpo non valido.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { bearerTokenAny, normalizeCommessa, normalizePhase, sha256Hex } from './helpers.js';
import { activePhaseRules, matchPhase, registerEvent } from './events.js';
import { cleanIp, peekFields, recordCall, type CallLog, type Esito } from './iknow-log.js';

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
  // Ogni chiamata lascia una riga nel registro (pagina Quality Control Station), qualunque sia l'esito.
  const call: CallLog = { ip: cleanIp(c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')), httpStatus: 500, esito: 'errore_interno' };
  function fail(status: 400 | 401 | 503, esito: Esito, message: string): never {   // function: serve a TS per restringere i tipi dopo la chiamata
    call.httpStatus = status; call.esito = esito; call.dettaglio = message;
    throw new HTTPException(status, { message });
  }
  try {
    const [cfg] = await db`SELECT token_hash FROM photo_iknow_config WHERE id = 1`;
    if (!cfg) fail(503, 'token_non_configurato', 'Integrazione iKnow non configurata');
    const token = bearerTokenAny(c.req.header('Authorization'));
    const given = Buffer.from(sha256Hex(token ?? ''), 'hex');
    const wanted = Buffer.from(cfg.token_hash as string, 'hex');
    if (!token || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      logger.warn({ ip: call.ip }, 'iknow: token non valido');
      fail(401, 'token_errato', token ? 'Token non valido' : 'Header Authorization mancante o senza Bearer');
    }

    // Da qui il token è valido: il corpo si può leggere (e mostrare nel registro, troncato).
    const raw: unknown = await c.req.json().catch(() => null);
    call.campi = peekFields(raw);

    // Solo con l'origine «API» gli ordini nascono da qui. Altrimenti si risponde 200 (iKnow non deve
    // riprovare per sempre) ma non si crea nulla, e la chiamata si conta.
    const [mode] = await db`SELECT mode FROM photo_feed_config WHERE id = 1`;
    if (mode?.mode !== 'api') {
      ignoredApiCalls.count++; ignoredApiCalls.last_at = new Date();
      logger.warn({ mode: mode?.mode ?? 'off' }, 'iknow: chiamata ricevuta ma l\'origine non è «API»: ignorata');
      call.httpStatus = 200; call.esito = 'ignorata_origine'; call.dettaglio = `Origine attuale: ${mode?.mode ?? 'off'}`;
      return c.json({ ok: true, result: 'ignored' });
    }

    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      fail(400, 'corpo_non_valido', raw === null ? 'Invalid JSON body' : parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '));
    }
    const b = parsed.data!;
    const commessa = normalizeCommessa(b.commessa);       // resta stringa: "000000" non perde gli zeri
    const eventAt = parseDataOra(b.data_ora);
    if (!commessa) fail(400, 'corpo_non_valido', 'commessa non valida');
    if (!eventAt) fail(400, 'corpo_non_valido', 'data_ora non valida');

    // Fase: nome esatto di iKnow o codice normalizzato. Se non è nel catalogo l'ordine si salva comunque
    // (annullato, con il motivo) e si risponde 200: iKnow non deve riprovare all'infinito.
    const rules = await activePhaseRules();
    const matched = matchPhase(rules, b.fase);
    const phase = matched ?? normalizePhase(b.fase);
    if (!phase) fail(400, 'corpo_non_valido', 'fase non valida');

    const ev = { seriale: b.seriale, commessa, fase: b.fase, componente: b.componente, versione: b.versione, eventAt };
    const r = await registerEvent(ev, phase, matched !== null, 'iknow', 'iKnow');
    if (r.result === 'phase_unknown') logger.warn({ phase, jobId: r.jobId }, 'iknow: fase sconosciuta, ordine messo da parte');
    call.httpStatus = 200; call.jobId = r.jobId ?? null;
    call.esito = r.result === 'created' ? 'ok' : r.result === 'duplicate' ? 'duplicata' : 'fase_sconosciuta';
    if (r.result === 'phase_unknown') call.dettaglio = `Fase «${phase}» non configurata`;
    return c.json({ ok: true, result: r.result, ...(r.jobId ? { job_id: r.jobId } : {}) });
  } finally {
    await recordCall(call);
  }
});
