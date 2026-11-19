// Fatturazione: copia da BC delle righe di spedizione dei conti configurati (ultimi N giorni) in fatt_riga.
// Gira ogni ora (scheduler) o a mano; una sola esecuzione alla volta (fatt_sync_stato.in_corso_da).
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getShipments } from '../edi/dynamics-client.js';
import { getRigheDespachi } from './bc.js';

const GIORNI = 90;
const PAGINA = 500;           // despachi per pagina letta da BC
const BLOCCO = 300;           // despachi per query verso BC
const STALE_MIN = 30;         // una sincronizzazione «in corso» da più di 30 min si considera morta

export async function avviaSync(): Promise<boolean> {
  const [r] = await db<{ id: number }[]>`
    UPDATE fatt_sync_stato SET in_corso_da = now(), errore = NULL
    WHERE id = 1 AND (in_corso_da IS NULL OR in_corso_da < now() - make_interval(mins => ${STALE_MIN}))
    RETURNING id`;
  return !!r;
}

/** Sincronizzazione completa (scheduler): -1 se ce n'e' gia' una in corso. */
export async function sincronizza(): Promise<number> {
  if (!(await avviaSync())) return -1;
  return sincronizzaGiaAvviata();
}

/** Da chiamare dopo avviaSync() riuscito. */
export async function sincronizzaGiaAvviata(): Promise<number> {
  try {
    const conti = (await db<{ conto: string }[]>`SELECT conto FROM fatt_conto`).map(r => r.conto);
    const da = new Date(Date.now() - GIORNI * 86_400_000).toISOString().slice(0, 10);
    // A pagine: un limite unico taglierebbe in silenzio i despachi più vecchi.
    const spedizioni: Awaited<ReturnType<typeof getShipments>> = [];
    for (let offset = 0; ; offset += PAGINA) {
      const pagina = await getShipments(conti, da, undefined, { limit: PAGINA, offset });
      spedizioni.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    let n = 0;
    for (let i = 0; i < spedizioni.length; i += BLOCCO) {
      const parte = spedizioni.slice(i, i + BLOCCO);
      const righe = await getRigheDespachi(parte.map(s => s.shipment_id));
      const info = new Map(parte.map(s => [s.shipment_id, s]));
      const dati = righe.flatMap(r => {
        const s = info.get(r.shipment_id);
        return s ? [{ shipment_id: r.shipment_id, line_no: r.line_no, shipment_date: s.shipment_date, customer_account: s.customer_account,
                      article_code: r.article_code, quantity: r.quantity, order_no: r.order_no, descrizione: r.descrizione }] : [];
      });
      await db.begin(async raw => {
        const tx = raw as unknown as typeof db;
        await tx`DELETE FROM fatt_riga WHERE shipment_id = ANY(${parte.map(s => s.shipment_id)})`;
        for (let k = 0; k < dati.length; k += 500) await tx`INSERT INTO fatt_riga ${tx(dati.slice(k, k + 500))}`;
      });
      n += dati.length;
    }
    await db`UPDATE fatt_sync_stato SET ultima_sync = now(), in_corso_da = NULL, errore = NULL WHERE id = 1`;
    logger.info(`[fatturazione] sincronizzate ${n} righe di ${spedizioni.length} despachi`);
    return n;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db`UPDATE fatt_sync_stato SET in_corso_da = NULL, errore = ${msg.slice(0, 500)} WHERE id = 1`;
    throw e;
  }
}
