// POST /ia/consulta — la PC IA chiede un dato in tempo reale (sola lettura). Non usa la sessione degli utenti: la richiesta è firmata
// con HMAC (segreto condiviso IA_VM_SECRET). Se il segreto non è configurato la rotta resta CHIUSA (503).
import { Hono } from 'hono';
import { z } from 'zod';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { IA_QUERIES, type QueryIa, type RisultatoIa } from './queries.js';
import { verificaFirma } from './signature.js';

const PERCORSO_FIRMATO = '/ia/consulta';   // fisso: la PC IA firma sempre questo valore, qualunque prefisso metta il proxy
const MAX_CORPO = 16 * 1024;
const MAX_RIGHE = 200;
const TIMEOUT_MS = 10_000;
const MAX_AL_MINUTO = 120;

const Corpo = z.object({ dataset: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), parametri: z.record(z.string(), z.unknown()) }).strict();

export interface DipendenzeIa {
  segreto: () => string;
  query: Record<string, QueryIa>;
  ora: () => number;
}

export function creaIaLiveRoutes(dip: DipendenzeIa = { segreto: () => process.env.IA_VM_SECRET ?? '', query: IA_QUERIES, ora: Date.now }) {
  const r = new Hono();
  let finestra = { inizio: 0, n: 0 };

  r.post('/consulta', async (c) => {
    const segreto = dip.segreto();
    if (!segreto) return c.json({ error: 'Collegamento IA non configurato' }, 503);
    const ora = dip.ora();
    if (ora - finestra.inizio > 60_000) finestra = { inizio: ora, n: 0 };
    if (++finestra.n > MAX_AL_MINUTO) return c.json({ error: 'Troppe richieste' }, 429);

    const lunghezza = Number(c.req.header('content-length') ?? '0');
    if (lunghezza > MAX_CORPO) return c.json({ error: 'Corpo troppo grande' }, 413);
    const corpo = Buffer.from(await c.req.arrayBuffer());
    if (corpo.length > MAX_CORPO) return c.json({ error: 'Corpo troppo grande' }, 413);

    const ok = verificaFirma({
      segreto, metodo: 'POST', percorso: PERCORSO_FIRMATO, corpo,
      ts: c.req.header('x-ia-ts'), nonce: c.req.header('x-ia-nonce'), firma: c.req.header('x-ia-sig'), ora,
    });
    if (!ok) {
      await auditLog({ username: 'pc-ia', action: 'ia_consulta_rifiutata', entity: 'ia', ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? null });
      return c.json({ error: 'Firma non valida' }, 401);
    }

    let json: unknown;
    try { json = JSON.parse(corpo.toString('utf8')); } catch { return c.json({ error: 'JSON non valido' }, 400); }
    const b = Corpo.safeParse(json);
    if (!b.success) return c.json({ error: 'Richiesta non valida' }, 422);
    const q = Object.prototype.hasOwnProperty.call(dip.query, b.data.dataset) ? dip.query[b.data.dataset] : undefined;
    if (!q) return c.json({ error: 'Dataset sconosciuto' }, 404);
    const p = q.parametri.safeParse(b.data.parametri);
    if (!p.success) return c.json({ error: 'Parametri non validi' }, 422);

    let out: RisultatoIa;
    try {
      out = await Promise.race([
        q.esegui(p.data),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), TIMEOUT_MS).unref()),
      ]);
    } catch (err) {
      logger.error({ err, dataset: b.data.dataset }, 'ia_consulta: errore');
      await auditLog({ username: 'pc-ia', action: 'ia_consulta', entity: b.data.dataset, details: { ok: false } });
      return c.json({ error: 'Dato non disponibile' }, 502);   // nessun dettaglio verso la PC IA
    }
    const righe = out.righe.slice(0, MAX_RIGHE);
    await auditLog({ username: 'pc-ia', action: 'ia_consulta', entity: b.data.dataset, details: { ok: true, parametri: Object.keys(p.data), righe: righe.length } });
    return c.json({ colonne: out.colonne, righe });
  });
  return r;
}

export const iaLiveRoutes = creaIaLiveRoutes();
