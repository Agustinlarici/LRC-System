// Fatturazione: despachi (da BC) con prezzo di vendita stimato STR. Vedere = modulo 'fatturazione'; modificare regole/gruppi/conti = canManage.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { avviaSync, sincronizzaGiaAvviata } from './sync.js';
import { calcola, chiaveRegola, indicizza, normalizza, MAX_REGOLE, RegolaInputSchema, type Gruppi, type Passo, type Regola, type RegolaInput } from './regole-base.js';
import { importaRegole } from './import-regole.js';
import { validateSpmaFile } from '../../lib/mime-check.js';

export const fatturazioneRoutes = new Hono();

// La catena di passi sta in condizioni[0] (stesso formato di prima, così il codice vecchio regge lo schema).
async function leggiRegole(): Promise<Regola[]> {
  const righe = await db<{ id: string; nome: string; attiva: boolean; article_code: string; prezzo: string; condizioni: { passi: Passo[] }[] }[]>`
    SELECT id, nome, attiva, article_code, prezzo::text, condizioni FROM fatt_regola ORDER BY article_code, id`;
  return righe.map(r => ({ id: Number(r.id), nome: r.nome, attiva: r.attiva, article_code: r.article_code, prezzo: Number(r.prezzo), passi: r.condizioni[0]?.passi ?? [] }));
}

const condizioniDa = (r: RegolaInput) => (r.passi.length > 0 ? [{ passi: r.passi }] : []);

async function leggiGruppi(): Promise<{ nome: string; parole: string[] }[]> {
  return db<{ nome: string; parole: string[] }[]>`SELECT nome, parole FROM fatt_gruppo ORDER BY nome`;
}
const mappaGruppi = (g: { nome: string; parole: string[] }[]): Gruppi => new Map(g.map(x => [normalizza(x.nome), x.parole]));

async function leggiConti(): Promise<string[]> {
  return (await db<{ conto: string }[]>`SELECT conto FROM fatt_conto ORDER BY conto`).map(r => r.conto);
}

const DataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const arrotonda = (n: number) => Math.round(n * 100) / 100;

interface RigaDb { shipment_id: string; line_no: number; shipment_date: string | null; customer_account: string; article_code: string; quantity: string; order_no: string; descrizione: string }

// Stato dell'ultima sincronizzazione da BC.
fatturazioneRoutes.get('/stato', requireModule('fatturazione'), async (c) => {
  const [r] = await db<{ ultima_sync: string | null; in_corso: boolean; errore: string | null }[]>`
    SELECT ultima_sync, (in_corso_da IS NOT NULL AND in_corso_da > now() - interval '30 minutes') AS in_corso, errore FROM fatt_sync_stato WHERE id = 1`;
  return c.json(r ?? { ultima_sync: null, in_corso: false, errore: null });
});

// Sincronizzazione a mano (parte in background; lo stato si legge da /stato).
fatturazioneRoutes.post('/sincronizza', requireManage('fatturazione'), async (c) => {
  const user = c.get('user');
  // Periodo facoltativo: rilegge da BC solo i despachi di quelle date (senza corpo = ultimi 90 giorni).
  const periodo = z.object({ da: DataSchema.optional(), a: DataSchema.optional() })
    .refine(p => !p.da || !p.a || p.da <= p.a, { message: 'La data iniziale deve precedere quella finale' })
    .parse(await c.req.json().catch(() => ({})));
  if (!(await avviaSync())) return c.json({ avviata: false });
  sincronizzaGiaAvviata(periodo).catch(err => logger.error({ err }, 'fatturazione: sincronizzazione manuale fallita'));
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.sincronizza', entity: 'fatt_riga' });
  return c.json({ avviata: true });
});

// Lista despachi (dalla copia locale) dei conti configurati, con totale STR stimato.
fatturazioneRoutes.get('/despachi', requireModule('fatturazione'), async (c) => {
  const q = z.object({ from: DataSchema.optional(), to: DataSchema.optional(), search: z.string().max(60).optional(),
    articolo: z.string().max(60).optional(), testo: z.string().max(60).optional(), vuote: z.enum(['1']).optional() }).parse(c.req.query());
  const like = (v: string) => '%' + v.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const righe = await db<RigaDb[]>`
    SELECT shipment_id, line_no, shipment_date::text, customer_account, article_code, quantity::text, order_no, descrizione
    FROM fatt_riga
    WHERE customer_account IN (SELECT conto FROM fatt_conto)
      ${q.from ? db`AND shipment_date >= ${q.from}` : db``}
      ${q.to ? db`AND shipment_date <= ${q.to}` : db``}
      ${q.search ? db`AND shipment_id ILIKE ${like(q.search)}` : db``}
      ${q.articolo || q.testo || q.vuote ? db`AND shipment_id IN (SELECT shipment_id FROM fatt_riga WHERE true
        ${q.articolo ? db`AND article_code ILIKE ${like(q.articolo)}` : db``}
        ${q.testo ? db`AND descrizione ILIKE ${like(q.testo)}` : db``}
        ${q.vuote ? db`AND btrim(descrizione) = ''` : db``})` : db``}
    ORDER BY shipment_date DESC NULLS LAST, shipment_id DESC, line_no
    LIMIT 20000`;
  const [regole, gruppi] = await Promise.all([leggiRegole(), leggiGruppi()]);
  const g = mappaGruppi(gruppi);
  const perArticolo = indicizza(regole);
  const per = new Map<string, { shipment_id: string; shipment_date: string | null; customer_account: string; line_count: number; totale_str: number; senza_regola: number }>();
  for (const r of righe) {
    const d = per.get(r.shipment_id) ?? { shipment_id: r.shipment_id, shipment_date: r.shipment_date, customer_account: r.customer_account, line_count: 0, totale_str: 0, senza_regola: 0 };
    const calc = calcola(r.descrizione, r.article_code, perArticolo(r.article_code), g);
    d.line_count += 1; d.totale_str += calc.totale * Number(r.quantity); if (calc.applicate.length === 0) d.senza_regola += 1;
    per.set(r.shipment_id, d);
  }
  return c.json([...per.values()].slice(0, 200).map(d => ({ ...d, totale_str: arrotonda(d.totale_str) })));
});

// Dettaglio di un despacho: righe con descrizione, prezzo unitario stimato e regole applicate.
fatturazioneRoutes.get('/despachi/:id', requireModule('fatturazione'), async (c) => {
  const id = c.req.param('id');
  if (!id || id.length > 50) throw new HTTPException(400, { message: 'Despacho non valido' });
  const righe = await db<RigaDb[]>`
    SELECT shipment_id, line_no, shipment_date::text, customer_account, article_code, quantity::text, order_no, descrizione
    FROM fatt_riga WHERE shipment_id = ${id} AND customer_account IN (SELECT conto FROM fatt_conto) ORDER BY line_no`;   // solo i conti configurati
  if (righe.length === 0) throw new HTTPException(404, { message: 'Despacho non trovato' });
  const [regole, gruppi] = await Promise.all([leggiRegole(), leggiGruppi()]);
  const g = mappaGruppi(gruppi);
  const perArticolo = indicizza(regole);
  const out = righe.map(r => {
    const calc = calcola(r.descrizione, r.article_code, perArticolo(r.article_code), g);
    const quantity = Number(r.quantity);
    return { line_no: r.line_no, article_code: r.article_code, quantity, order_no: r.order_no, descrizione: r.descrizione,
             prezzo_str: calc.totale, totale_riga: arrotonda(calc.totale * quantity), regole: calc.applicate };
  });
  return c.json({ shipment_id: id, shipment_date: righe[0]!.shipment_date, customer_account: righe[0]!.customer_account, righe: out, totale_str: arrotonda(out.reduce((s, r) => s + r.totale_riga, 0)) });
});

// Prova di una descrizione, senza BC (per scrivere e controllare le regole).
fatturazioneRoutes.post('/prova', requireModule('fatturazione'), async (c) => {
  const body = await parseBody(c, z.object({ article_code: z.string().trim().max(60), descrizione: z.string().max(500) }));
  return c.json(calcola(body.descrizione, body.article_code, await leggiRegole(), mappaGruppi(await leggiGruppi())));
});

fatturazioneRoutes.get('/regole', requireModule('fatturazione'), async (c) => c.json(await leggiRegole()));

const IdSchema = z.coerce.number().int().positive();
const parseId = (v: string | undefined): number => {
  const r = IdSchema.safeParse(v);
  if (!r.success) throw new HTTPException(400, { message: 'Id non valido' });
  return r.data;
};

/** Una regola uguale (stesso articolo e stesse parole) si sommerebbe due volte: non si ammette. */
async function controllaDuplicato(r: RegolaInput, tranneId?: number) {
  const k = chiaveRegola(r);
  if ((await leggiRegole()).some(x => x.id !== tranneId && chiaveRegola(x) === k)) {
    throw new HTTPException(409, { message: 'Esiste già una regola con lo stesso articolo e le stesse parole' });
  }
}

fatturazioneRoutes.post('/regole', requireManage('fatturazione'), async (c) => {
  const r = await parseBody(c, RegolaInputSchema);
  const user = c.get('user');
  if (Number((await db<{ n: string }[]>`SELECT count(*)::text n FROM fatt_regola`)[0]!.n) >= MAX_REGOLE) throw new HTTPException(400, { message: `Massimo ${MAX_REGOLE} regole` });
  await controllaDuplicato(r);
  const [row] = await db<{ id: string }[]>`
    INSERT INTO fatt_regola (ordine, nome, attiva, article_code, prezzo, logica, condizioni, eccezioni, creato_da)
    VALUES (0, ${r.nome}, ${r.attiva}, ${r.article_code}, ${r.prezzo}, 'tutte', ${db.json(condizioniDa(r) as never)}, ${db.json([] as never)}, ${user.username})
    RETURNING id`;
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regola_creata', entity: 'fatt_regola', entityId: row!.id });
  return c.json((await leggiRegole()).find(x => x.id === Number(row!.id)), 201);
});

fatturazioneRoutes.put('/regole/:id', requireManage('fatturazione'), async (c) => {
  const id = parseId(c.req.param('id'));
  const r = await parseBody(c, RegolaInputSchema);
  const user = c.get('user');
  await controllaDuplicato(r, id);
  const [row] = await db<{ id: string }[]>`
    UPDATE fatt_regola SET nome = ${r.nome}, attiva = ${r.attiva}, article_code = ${r.article_code}, prezzo = ${r.prezzo},
      logica = 'tutte', condizioni = ${db.json(condizioniDa(r) as never)}, eccezioni = ${db.json([] as never)}, aggiornato_at = now()
    WHERE id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Regola non trovata' });
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regola_modificata', entity: 'fatt_regola', entityId: String(id) });
  return c.json((await leggiRegole()).find(x => x.id === id));
});

fatturazioneRoutes.put('/regole/:id/attiva', requireManage('fatturazione'), async (c) => {
  const id = parseId(c.req.param('id'));
  const { attiva } = await parseBody(c, z.object({ attiva: z.boolean() }));
  const [row] = await db`UPDATE fatt_regola SET attiva = ${attiva}, aggiornato_at = now() WHERE id = ${id} RETURNING id`;
  if (!row) throw new HTTPException(404, { message: 'Regola non trovata' });
  return c.json({ id, attiva });
});

fatturazioneRoutes.delete('/regole/:id', requireManage('fatturazione'), async (c) => {
  const id = parseId(c.req.param('id'));
  const user = c.get('user');
  await db`DELETE FROM fatt_regola WHERE id = ${id}`;
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regola_eliminata', entity: 'fatt_regola', entityId: String(id) });
  return c.json({ status: 'deleted' });
});

// Eliminazione in blocco (le regole filtrate nella pagina).
fatturazioneRoutes.post('/regole/elimina', requireManage('fatturazione'), async (c) => {
  const { ids } = await parseBody(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(MAX_REGOLE) }));
  const user = c.get('user');
  const righe = await db`DELETE FROM fatt_regola WHERE id IN ${db(ids)} RETURNING id`;
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regole_eliminate', entity: 'fatt_regola', details: { regole: righe.length } });
  return c.json({ status: 'deleted', count: righe.length });
});

// Carica regole da Excel: Articolo, Cerca 1-3, Distanza, Prezzo, Note. Stessa regola (articolo + parole) = aggiorna prezzo/note.
fatturazioneRoutes.post('/regole/import-excel', requireManage('fatturazione'), async (c) => {
  let formData: FormData;
  try { formData = await c.req.formData(); } catch { throw new HTTPException(400, { message: 'Richiesta multipart non valida' }); }
  const file = formData.get('file') as File | null;
  if (!file) throw new HTTPException(400, { message: 'File mancante (campo "file")' });
  const buffer = Buffer.from(await file.arrayBuffer());
  validateSpmaFile(buffer, file.name);
  const user = c.get('user');
  const esito = await importaRegole(buffer, user.username);
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regole_importate', entity: 'fatt_regola', details: { lette: esito.total_rows, caricate: esito.upserted, saltate: esito.skipped } });
  return c.json(esito);
});

fatturazioneRoutes.get('/gruppi', requireModule('fatturazione'), async (c) => c.json(await leggiGruppi()));

fatturazioneRoutes.put('/gruppi', requireManage('fatturazione'), async (c) => {
  const { gruppi } = await parseBody(c, z.object({
    gruppi: z.array(z.object({
      nome:   z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_]+$/),
      parole: z.array(z.string().trim().min(1).max(60)).max(200),
    })).max(100),
  }));
  const user = c.get('user');
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    await tx`DELETE FROM fatt_gruppo`;
    for (const g of gruppi) await tx`INSERT INTO fatt_gruppo (nome, parole) VALUES (${normalizza(g.nome)}, ${g.parole})`;
  });
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.gruppi_salvati', entity: 'fatt_gruppo', details: { gruppi: gruppi.length } });
  return c.json(await leggiGruppi());
});

fatturazioneRoutes.get('/conti', requireModule('fatturazione'), async (c) => c.json(await leggiConti()));

fatturazioneRoutes.put('/conti', requireManage('fatturazione'), async (c) => {
  const { conti } = await parseBody(c, z.object({ conti: z.array(z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/)).max(50) }));
  const user = c.get('user');
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    await tx`DELETE FROM fatt_conto`;
    for (const conto of new Set(conti.map(x => x.toUpperCase()))) await tx`INSERT INTO fatt_conto (conto) VALUES (${conto})`;
  });
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.conti_salvati', entity: 'fatt_conto', details: { conti } });
  return c.json(await leggiConti());
});
