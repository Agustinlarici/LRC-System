import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { parseBody } from '../../lib/validate.js';
import { requireManage, requireModule, type Env } from '../../lib/auth.js';
import {
  aggiornaConfig, caricaScheda, cerca, configCorrente, creaPacchettoConoscenza, creaPacchettoToAi, decidiConoscenza,
  dettaglioFile, importaRisultatoIa, decidiSigla, listaAudit, listaBundle, matrice, togliDecisione, tutteNo, listaConoscenza, listaFile, mostraSegreto,
  proponiConoscenzaDiretta, registraDecisione, revisioneSenzaIa, rianalizza, reinviaAllaIa, rifiutaScheda, riepilogo,
  scaricaBundle, scaricaOriginale, validaScheda, verificaCatenaAudit, TIPI_DIZIONARIO,
  type Utente,
} from './service.js';

export const ferrariRoutes = new Hono<Env>();

const VISTA = 'ferrari_schede' as const;
const SUPERVISORE = 'ferrari_supervisore' as const;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 50;

const utente = (c: Context<Env>): Utente => {
  const u = c.get('user');
  return { id: u.id, username: u.display_name || u.username };
};

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function scarica(c: Context<Env>, filename: string, contenuto: Buffer, tipo: string) {
  const sicuro = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return c.body(new Uint8Array(contenuto), 200, {
    'Content-Type': tipo,
    'Content-Disposition': `attachment; filename="${sicuro}"`,
    'Content-Length': String(contenuto.length),
    'Cache-Control': 'no-store',
  });
}

async function leggiFile(c: Context<Env>, campo: string, max = MAX_FILES): Promise<{ name: string; buf: Buffer }[]> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: 'Richiesta multipart non valida' });
  }
  const files = form.getAll(campo).filter(f => typeof f !== 'string') as unknown as File[];
  if (files.length === 0) throw new HTTPException(400, { message: `File mancante (campo "${campo}")` });
  if (files.length > max) throw new HTTPException(400, { message: `Massimo ${max} file per richiesta` });
  const out: { name: string; buf: Buffer }[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE * 8) throw new HTTPException(413, { message: `${f.name}: file troppo grande` });
    out.push({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

// ─── Lettura ──────────────────────────────────────────────────────────────────

ferrariRoutes.get('/matrice', requireModule(VISTA), async (c) =>
  c.json(await matrice(c.req.query('modello')?.slice(0, 30), c.req.query('q')?.slice(0, 100))));

ferrariRoutes.post('/sigle', requireManage(VISTA), async (c) => {
  const b = await parseBody(c, z.object({
    modello: z.string().max(30), codice: z.string().min(1).max(60), va: z.boolean(), tutti: z.boolean(),
  }));
  return c.json({ codice: await decidiSigla(utente(c), b.modello, b.codice, b.va, b.tutti) });
});

ferrariRoutes.post('/sigle/tutte-no', requireManage(VISTA), async (c) => {
  const b = await parseBody(c, z.object({ modello: z.string().min(1).max(30) }));
  return c.json({ segnate: await tutteNo(utente(c), b.modello) });
});

ferrariRoutes.delete('/sigle', requireManage(VISTA), async (c) =>
  c.json({ tolte: await togliDecisione(utente(c), c.req.query('modello') ?? '', c.req.query('codice') ?? '', c.req.query('tutti') === '1') }));

ferrariRoutes.get('/summary', requireModule(VISTA), async (c) => c.json(await riepilogo()));

const FiltriSchema = z.object({
  stato: z.string().max(30).optional(), esito: z.enum(['VERDE', 'AMBRA', 'ROSSO']).optional(),
  modello: z.string().max(30).optional(), q: z.string().max(100).optional(),
  dal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), al: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  codice: z.string().max(8).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional(),
});

ferrariRoutes.get('/files', requireModule(VISTA), async (c) => {
  const p = FiltriSchema.safeParse(c.req.query());
  if (!p.success) throw new HTTPException(400, { message: 'Filtri non validi' });
  return c.json(await listaFile(p.data));
});

ferrariRoutes.get('/files/:id', requireModule(VISTA), async (c) => c.json(await dettaglioFile(parseId(c.req.param('id')))));

ferrariRoutes.get('/files/:id/original', requireModule(VISTA), async (c) => {
  const f = await scaricaOriginale(parseId(c.req.param('id')));
  return scarica(c, f.filename, f.original, 'application/octet-stream');
});

// ─── Caricamento ──────────────────────────────────────────────────────────────

ferrariRoutes.post('/files', requireManage(VISTA), async (c) => {
  const user = utente(c);
  const files = await leggiFile(c, 'files');
  const risultati = [];
  for (const f of files) {
    if (!/\.(xls|xlsx)$/i.test(f.name)) {
      risultati.push({ filename: f.name, errore: 'Estensione non consentita (solo .xls / .xlsx)' });
      continue;
    }
    if (f.buf.length > MAX_FILE) {
      risultati.push({ filename: f.name, errore: 'File troppo grande (max 10 MB)' });
      continue;
    }
    risultati.push(await caricaScheda(user, f.name, f.buf));
  }
  return c.json({ risultati });
});

// ─── Revisione ────────────────────────────────────────────────────────────────

const PropostaSchema = z.object({
  tipo: z.enum(['componente', 'codice']),
  ambito: z.enum(['MODELLO', 'TUTTI']),
  modello: z.string().max(30).optional(),
  pattern: z.string().max(200).optional(), comp_tipo: z.string().max(40).optional(), valore: z.string().max(300).optional(),
  esempio_testo: z.string().max(1000).optional(),
  codice: z.string().max(8).optional(), significato: z.string().max(300).optional(), categoria: z.string().max(60).optional(),
});

const DecisioneSchema = z.object({
  rev: z.number().int().min(0),
  item_key: z.string().min(1).max(200),
  decisione: z.enum(['conferma_vm', 'conferma_ia', 'correggi', 'ignora', 'verificato_immagini']),
  valore_dopo: z.object({
    tipo: z.string().max(40).optional(), valore: z.string().max(300).optional(),
    frammento: z.string().max(600).optional(), significato: z.string().max(300).optional(),
  }).nullable().optional(),
  motivo: z.string().max(500).nullable().optional(),
  proposta: PropostaSchema.nullable().optional(),
});

ferrariRoutes.post('/files/:id/decisioni', requireManage(VISTA), async (c) => {
  const body = await parseBody(c, DecisioneSchema);
  return c.json(await registraDecisione(utente(c), parseId(c.req.param('id')), body));
});

const RevSchema = z.object({ rev: z.number().int().min(0) });

ferrariRoutes.post('/files/:id/valida', requireManage(VISTA), async (c) => {
  const { rev } = await parseBody(c, RevSchema);
  return c.json(await validaScheda(utente(c), parseId(c.req.param('id')), rev));
});

ferrariRoutes.post('/files/:id/rifiuta', requireManage(VISTA), async (c) => {
  const body = await parseBody(c, RevSchema.extend({ motivo: z.string().min(1).max(500) }));
  return c.json(await rifiutaScheda(utente(c), parseId(c.req.param('id')), body.rev, body.motivo));
});

ferrariRoutes.post('/files/:id/rianalizza', requireManage(VISTA), async (c) =>
  c.json(await rianalizza(utente(c), parseId(c.req.param('id')))));

ferrariRoutes.post('/files/:id/reinvia-ia', requireManage(VISTA), async (c) =>
  c.json(await reinviaAllaIa(utente(c), parseId(c.req.param('id')))));

ferrariRoutes.post('/files/:id/solo-vm', requireManage(VISTA), async (c) =>
  c.json(await revisioneSenzaIa(utente(c), parseId(c.req.param('id')))));

// ─── Pacchetti ────────────────────────────────────────────────────────────────

ferrariRoutes.get('/bundle', requireModule(VISTA), async (c) => c.json(await listaBundle()));

ferrariRoutes.get('/bundle/:id/download', requireModule(VISTA), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HTTPException(400, { message: 'ID pacchetto non valido' });
  const b = await scaricaBundle(id);
  return scarica(c, b.filename, b.contenuto, 'application/zip');
});

ferrariRoutes.post('/bundle/to-ai', requireManage(VISTA), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ file_ids: z.array(z.number().int().positive()).max(500).optional() }).safeParse(body);
  if (!parsed.success) throw new HTTPException(400, { message: 'file_ids non valido' });
  const r = await creaPacchettoToAi(utente(c), parsed.data.file_ids);
  c.header('X-Bundle-Id', r.manifest.bundle_id);
  return scarica(c, r.filename, r.zip, 'application/zip');
});

ferrariRoutes.post('/bundle/knowledge', requireManage(VISTA), async (c) => {
  const r = await creaPacchettoConoscenza(utente(c));
  c.header('X-Bundle-Id', r.manifest.bundle_id);
  return scarica(c, r.filename, r.zip, 'application/zip');
});

ferrariRoutes.post('/bundle/import', requireManage(VISTA), async (c) => {
  const [f] = await leggiFile(c, 'file', 1);
  return c.json(await importaRisultatoIa(utente(c), f!.name, f!.buf));
});

// ─── Conoscenza ───────────────────────────────────────────────────────────────

ferrariRoutes.get('/conoscenza', requireModule(VISTA), async (c) => {
  const stato = c.req.query('stato');
  if (stato && !['proposta', 'approvata', 'rifiutata', 'revocata'].includes(stato)) throw new HTTPException(400, { message: 'Stato non valido' });
  return c.json({ ...(await listaConoscenza(stato)), tipi: TIPI_DIZIONARIO });
});

ferrariRoutes.post('/conoscenza/proposte', requireManage(VISTA), async (c) => {
  const { proposte } = await parseBody(c, z.object({ proposte: z.array(PropostaSchema).min(1).max(500) }));
  const user = utente(c);
  const ids: number[] = [];
  for (const p of proposte) ids.push(await proponiConoscenzaDiretta(user, p));
  return c.json({ ids });
});

ferrariRoutes.post('/conoscenza/:entita/decisione', requireManage(SUPERVISORE), async (c) => {
  const entita = c.req.param('entita');
  if (entita !== 'codice' && entita !== 'componente') throw new HTTPException(400, { message: 'Entità non valida' });
  const body = await parseBody(c, z.object({
    ids: z.array(z.number().int().positive()).min(1).max(500),
    azione: z.enum(['approva', 'rifiuta', 'revoca']),
    motivo: z.string().max(500).nullable().optional(),
  }));
  return c.json(await decidiConoscenza(utente(c), entita, body.ids, body.azione, body.motivo ?? null));
});

// ─── Configurazione, ricerca, storico ─────────────────────────────────────────

ferrariRoutes.get('/config', requireModule(VISTA), async (c) => c.json(await configCorrente()));

ferrariRoutes.put('/config', requireManage(SUPERVISORE), async (c) => {
  const body = await parseBody(c, z.object({
    sampling_pct: z.number().int().min(0).max(100).optional(),
    four_eyes: z.boolean().optional(),
    ia_attesa_ore: z.number().int().min(1).max(24 * 30).optional(),
  }));
  await aggiornaConfig(utente(c), body);
  return c.json(await configCorrente());
});

ferrariRoutes.get('/segreto', requireManage(SUPERVISORE), async (c) => c.json({ segreto: await mostraSegreto(utente(c)) }));

ferrariRoutes.get('/cerca', requireModule(VISTA), async (c) => c.json(await cerca(c.req.query('q') ?? '')));

ferrariRoutes.get('/audit', requireModule(VISTA), async (c) => {
  const limite = Math.min(Math.max(Number(c.req.query('limite') ?? 200) || 200, 1), 1000);
  return c.json(await listaAudit(limite, c.req.query('entita') || undefined, c.req.query('id') || undefined));
});

ferrariRoutes.get('/audit/verifica', requireModule(VISTA), async (c) => c.json(await verificaCatenaAudit()));
