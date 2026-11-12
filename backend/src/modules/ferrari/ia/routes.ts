// API della VM per il collegamento con la PC IA: stato, interruttore, schede con le tappe, riprova/annulla.
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parseBody } from '../../../lib/validate.js';
import { requireManage, requireModule, type Env } from '../../../lib/auth.js';
import type { Utente } from '../service.js';
import { leggiConfigIa, salvaConfigIa } from './config.js';
import { servizioIa } from './servizio.js';

const VISTA = 'ferrari_schede' as const;
export const iaRoutes = new Hono<Env>();

const utente = (c: Context<Env>): Utente => {
  const u = c.get('user');
  return { id: u.id, username: u.display_name || u.username };
};
const id = (raw: string | undefined): string => {
  if (!raw || !/^\d{1,18}$/.test(raw)) throw new HTTPException(400, { message: 'Identificativo non valido' });
  return raw;
};

iaRoutes.get('/stato', requireModule(VISTA), async (c) => {
  const s = servizioIa();
  const cfg = await leggiConfigIa();
  return c.json({ config: cfg, connessione: s.connessione, contatori: await s.contatori() });
});

iaRoutes.put('/config', requireManage(VISTA), async (c) => {
  const b = await parseBody(c, z.object({
    attiva: z.boolean().optional(), url: z.string().max(200).optional(),
    maxTentativi: z.number().int().optional(), timeoutS: z.number().int().optional(),
  }));
  return c.json(await salvaConfigIa(utente(c), b));
});

iaRoutes.post('/prova', requireManage(VISTA), async (c) => c.json(await servizioIa().prova()));
iaRoutes.post('/sigle/sincronizza', requireManage(VISTA), async (c) => c.json(await servizioIa().sincronizzaSigle()));

iaRoutes.get('/schede', requireModule(VISTA), async (c) => {
  const limite = Math.min(200, Math.max(1, Number(c.req.query('limite')) || 50));
  return c.json({ schede: await servizioIa().elenco(limite) });
});

iaRoutes.get('/jobs/:id', requireModule(VISTA), async (c) => c.json(await servizioIa().dettaglioJob(id(c.req.param('id')))));

iaRoutes.post('/jobs/:id/riprova', requireManage(VISTA), async (c) => {
  await servizioIa().riprova(utente(c), id(c.req.param('id')));
  return c.json({ ok: true });
});

iaRoutes.post('/jobs/:id/annulla', requireManage(VISTA), async (c) => {
  await servizioIa().annulla(utente(c), id(c.req.param('id')));
  return c.json({ ok: true });
});

iaRoutes.post('/accoda-mancanti', requireManage(VISTA), async (c) => c.json({ accodate: await servizioIa().accodaMancanti(utente(c)) }));

/** «Analizza con IA» su una scheda. 409 se l'IA e' spenta o c'e' gia' un lavoro in corso per quella scheda. */
iaRoutes.post('/schede/:fileId/analizza', requireManage(VISTA), async (c) => {
  const fileId = Number(id(c.req.param('fileId')));
  if (!(await leggiConfigIa()).attiva) throw new HTTPException(409, { message: 'La IA e\' spenta: accendila in Impostazioni' });
  const j = await servizioIa().accodaFile(utente(c), fileId);
  if (!j) throw new HTTPException(409, { message: 'C\'e\' gia\' un\'analisi in corso per questa scheda (o la scheda non si puo\' analizzare)' });
  return c.json({ job: j }, 202);
});
