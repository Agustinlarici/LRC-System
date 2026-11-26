// Configurazione del collegamento con la PC IA (in ferrari_config, nessun segreto nuovo: si usa quello dei pacchetti).

import { HTTPException } from 'hono/http-exception';
import { db } from '../../../db/client.js';
import { audit, getConfig, setConfig, type Utente } from '../service.js';

type Tx = typeof db;

export interface ConfigIa { attiva: boolean; url: string; maxTentativi: number; timeoutS: number }

export const DEFAULT_IA: ConfigIa = { attiva: false, url: '', maxTentativi: 6, timeoutS: 30 };
const LIMITI = { maxTentativi: [1, 20], timeoutS: [5, 300] } as const;

const numero = (v: string | null, def: number, [min, max]: readonly [number, number]) => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export async function leggiConfigIa(tx: Tx = db): Promise<ConfigIa> {
  return {
    attiva: (await getConfig('ia_attiva', tx)) === 'true',                 // spenta finche' qualcuno non la accende
    url: (await getConfig('ia_url', tx)) ?? DEFAULT_IA.url,
    maxTentativi: numero(await getConfig('ia_max_tentativi', tx), DEFAULT_IA.maxTentativi, LIMITI.maxTentativi),
    timeoutS: numero(await getConfig('ia_timeout_s', tx), DEFAULT_IA.timeoutS, LIMITI.timeoutS),
  };
}

/** Indirizzo della PC IA: solo http/https, senza utente e password, senza query. Stringa vuota = non configurato. */
export function validaUrlIa(grezzo: string): string {
  const v = grezzo.trim();
  if (!v) return '';
  let u: URL;
  try { u = new URL(v); } catch { throw new HTTPException(400, { message: 'Indirizzo non valido (esempio: http://192.168.1.50:5000)' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HTTPException(400, { message: 'L\'indirizzo deve iniziare con http:// o https://' });
  if (u.username || u.password) throw new HTTPException(400, { message: 'Non mettere utente e password nell\'indirizzo' });
  if (u.search || u.hash) throw new HTTPException(400, { message: 'L\'indirizzo non deve avere parametri' });
  if (v.length > 200) throw new HTTPException(400, { message: 'Indirizzo troppo lungo' });
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export async function salvaConfigIa(user: Utente, p: Partial<ConfigIa>): Promise<ConfigIa> {
  const corrente = await leggiConfigIa();
  const url = p.url !== undefined ? validaUrlIa(p.url) : corrente.url;
  if (p.attiva === true && !url) throw new HTTPException(400, { message: 'Prima scrivi l\'indirizzo della PC IA' });
  for (const [k, [min, max]] of Object.entries(LIMITI) as [keyof typeof LIMITI, readonly [number, number]][]) {
    const v = p[k];
    if (v !== undefined && (!Number.isInteger(v) || v < min || v > max)) throw new HTTPException(400, { message: `${k === 'maxTentativi' ? 'Tentativi' : 'Timeout'}: da ${min} a ${max}` });
  }
  await db.begin(async raw => {
    const tx = raw as unknown as Tx;
    if (p.url !== undefined) await setConfig('ia_url', url, tx);
    if (p.attiva !== undefined) await setConfig('ia_attiva', p.attiva ? 'true' : 'false', tx);
    if (p.maxTentativi !== undefined) await setConfig('ia_max_tentativi', String(p.maxTentativi), tx);
    if (p.timeoutS !== undefined) await setConfig('ia_timeout_s', String(p.timeoutS), tx);
    await audit(tx, user, 'ia.config', 'config', null, { attiva: p.attiva ?? corrente.attiva, url: p.url !== undefined ? url : corrente.url });
  });
  return leggiConfigIa();
}
