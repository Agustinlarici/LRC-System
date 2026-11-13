// Autenticazione delle stazioni (PC Camere): token Bearer, nel DB solo l'hash.
// Non sono utenti: una stazione può solo prendere ordini di foto e caricarne i file.
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/client.js';
import { bearerToken, sha256Hex } from './helpers.js';

export type StationEnv = { Variables: { station: { id: number; name: string } } };

export async function requireStation(c: Context<StationEnv>, next: Next) {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) throw new HTTPException(401, { message: 'Token stazione mancante' });
  const [st] = await db`
    UPDATE photo_stations SET last_seen_at = now()
    WHERE token_hash = ${sha256Hex(token)} AND revoked_at IS NULL
    RETURNING id, name
  `;
  if (!st) throw new HTTPException(401, { message: 'Token stazione non valido' });
  c.set('station', { id: st.id, name: st.name });
  await next();
}
