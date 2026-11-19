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
import { calcola, normalizza, MAX_REGOLE, RegolaInputSchema, type Gruppi, type Regola } from './regole-base.js';

export const fatturazioneRoutes = new Hono();

async function leggiRegole(): Promise<Regola[]> {
  const righe = await db<{ id: string; nome: string; attiva: boolean; article_code: string; prezzo: string; logica: Regola['logica']; condizioni: Regola['condizioni']; eccezioni: Regola['eccezioni'] }[]>`
    SELECT id, nome, attiva, article_code, prezzo::text, logica, condizioni, eccezioni FROM fatt_regola ORDER BY ordine, id`;
  return righe.map(r => ({ ...r, id: Number(r.id), prezzo: Number(r.prezzo) }));
}

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
  if (!(await avviaSync())) return c.json({ avviata: false });
  sincronizzaGiaAvviata().catch(err => logger.error({ err }, 'fatturazione: sincronizzazione manuale fallita'));
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.sincronizza', entity: 'fatt_riga' });
  return c.json({ avviata: true });
});

// Lista despachi (dalla copia locale) dei conti configurati, con totale STR stimato.
fatturazioneRoutes.get('/despachi', requireModule('fatturazione'), async (c) => {
  const q = z.object({ from: DataSchema.optional(), to: DataSchema.optional(), search: z.string().max(60).optional() }).parse(c.req.query());
  const righe = await db<RigaDb[]>`
    SELECT shipment_id, line_no, shipment_date::text, customer_account, article_code, quantity::text, order_no, descrizione
    FROM fatt_riga
    WHERE customer_account IN (SELECT conto FROM fatt_conto)
      ${q.from ? db`AND shipment_date >= ${q.from}` : db``}
      ${q.to ? db`AND shipment_date <= ${q.to}` : db``}
      ${q.search ? db`AND shipment_id ILIKE ${'%' + q.search.replace(/[%_\\]/g, m => '\\' + m) + '%'}` : db``}
    ORDER BY shipment_date DESC NULLS LAST, shipment_id DESC, line_no
    LIMIT 20000`;
  const [regole, gruppi] = await Promise.all([leggiRegole(), leggiGruppi()]);
  const g = mappaGruppi(gruppi);
  const per = new Map<string, { shipment_id: string; shipment_date: string | null; customer_account: string; line_count: number; totale_str: number; senza_regola: number }>();
  for (const r of righe) {
    const d = per.get(r.shipment_id) ?? { shipment_id: r.shipment_id, shipment_date: r.shipment_date, customer_account: r.customer_account, line_count: 0, totale_str: 0, senza_regola: 0 };
    const calc = calcola(r.descrizione, r.article_code, regole, g);
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
  const out = righe.map(r => {
    const calc = calcola(r.descrizione, r.article_code, regole, g);
    const quantity = Number(r.quantity);
    return { line_no: r.line_no, article_code: r.article_code, quantity, order_no: r.order_no, descrizione: r.descrizione,
             prezzo_str: calc.totale, totale_riga: arrotonda(calc.totale * quantity), regole: calc.applicate };
  });
  return c.json({ shipment_id: id, righe: out, totale_str: arrotonda(out.reduce((s, r) => s + r.totale_riga, 0)) });
});

// Prova di una descrizione, senza BC (per scrivere e controllare le regole).
fatturazioneRoutes.post('/prova', requireModule('fatturazione'), async (c) => {
  const body = await parseBody(c, z.object({ article_code: z.string().trim().max(60), descrizione: z.string().max(500) }));
  return c.json(calcola(body.descrizione, body.article_code, await leggiRegole(), mappaGruppi(await leggiGruppi())));
});

fatturazioneRoutes.get('/regole', requireModule('fatturazione'), async (c) => c.json(await leggiRegole()));

// Sostituisce l'elenco delle regole (l'ordine è quello della lista).
fatturazioneRoutes.put('/regole', requireManage('fatturazione'), async (c) => {
  const { regole } = await parseBody(c, z.object({ regole: z.array(RegolaInputSchema).max(MAX_REGOLE) }));
  const user = c.get('user');
  await db.begin(async raw => {
    const tx = raw as unknown as typeof db;
    await tx`DELETE FROM fatt_regola`;
    for (const [i, r] of regole.entries()) {
      await tx`INSERT INTO fatt_regola (ordine, nome, attiva, article_code, prezzo, logica, condizioni, eccezioni, creato_da)
               VALUES (${i}, ${r.nome}, ${r.attiva}, ${r.article_code}, ${r.prezzo}, ${r.logica}, ${tx.json(r.condizioni as never)}, ${tx.json(r.eccezioni as never)}, ${user.username})`;
    }
  });
  await auditLog({ userId: user.id, username: user.username, action: 'fatturazione.regole_salvate', entity: 'fatt_regola', details: { regole: regole.length } });
  return c.json(await leggiRegole());
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
