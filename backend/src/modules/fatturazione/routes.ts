// Fatturazione: despachi (da BC) con prezzo di vendita stimato STR. Vedere = modulo 'fatturazione'; modificare regole/gruppi/conti = canManage.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';
import { requireModule, requireManage } from '../../lib/auth.js';
import { getShipments } from '../edi/dynamics-client.js';
import { getRigheDespachi } from './bc.js';
import { calcola, normalizza, MAX_REGOLE, RegolaInputSchema, type Gruppi, type Regola } from './regole-base.js';

export const fatturazioneRoutes = new Hono();

async function leggiRegole(): Promise<Regola[]> {
  const righe = await db<{ id: string; nome: string; attiva: boolean; article_code: string; prezzo: string; passi: Regola['passi'] }[]>`
    SELECT id, nome, attiva, article_code, prezzo::text, passi FROM fatt_regola ORDER BY ordine, id`;
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

// Lista despachi dei conti configurati, con totale STR stimato.
fatturazioneRoutes.get('/despachi', requireModule('fatturazione'), async (c) => {
  const q = z.object({ from: DataSchema.optional(), to: DataSchema.optional(), search: z.string().max(60).optional() }).parse(c.req.query());
  const conti = await leggiConti();
  const spedizioni = await getShipments(conti, q.from, q.to, { limit: 200, search: q.search || undefined });
  if (spedizioni.length === 0) return c.json([]);
  const [righe, regole, gruppi] = await Promise.all([getRigheDespachi(spedizioni.map(s => s.shipment_id)), leggiRegole(), leggiGruppi()]);
  const g = mappaGruppi(gruppi);
  const totali = new Map<string, number>();
  for (const r of righe) totali.set(r.shipment_id, (totali.get(r.shipment_id) ?? 0) + calcola(r.descrizione, r.article_code, regole, g).totale * r.quantity);
  return c.json(spedizioni.map(s => ({
    shipment_id: s.shipment_id, shipment_date: s.shipment_date, customer_account: s.customer_account,
    line_count: s.line_count, totale_str: Math.round((totali.get(s.shipment_id) ?? 0) * 100) / 100,
  })));
});

// Dettaglio di un despacho: righe con descrizione, prezzo unitario stimato e regole applicate.
fatturazioneRoutes.get('/despachi/:id', requireModule('fatturazione'), async (c) => {
  const id = c.req.param('id');
  if (!id || id.length > 50) throw new HTTPException(400, { message: 'Despacho non valido' });
  const conti = await leggiConti();
  const spedizioni = await getShipments(conti, undefined, undefined, { limit: 50, search: id });
  if (!spedizioni.some(s => s.shipment_id === id)) throw new HTTPException(404, { message: 'Despacho non trovato' });   // solo i conti configurati
  const [righe, regole, gruppi] = await Promise.all([getRigheDespachi([id]), leggiRegole(), leggiGruppi()]);
  const g = mappaGruppi(gruppi);
  const out = righe.map(r => {
    const calc = calcola(r.descrizione, r.article_code, regole, g);
    return { ...r, prezzo_str: calc.totale, totale_riga: Math.round(calc.totale * r.quantity * 100) / 100, regole: calc.applicate };
  });
  return c.json({ shipment_id: id, righe: out, totale_str: Math.round(out.reduce((s, r) => s + r.totale_riga, 0) * 100) / 100 });
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
      await tx`INSERT INTO fatt_regola (ordine, nome, attiva, article_code, prezzo, passi, creato_da)
               VALUES (${i}, ${r.nome}, ${r.attiva}, ${r.article_code}, ${r.prezzo}, ${tx.json(r.passi as never)}, ${user.username})`;
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
