import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from '../lib/logger.js';

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }

  logger.error({ err }, '[ERROR]');
  return c.json({ message: 'Internal server error' }, 500);
}
