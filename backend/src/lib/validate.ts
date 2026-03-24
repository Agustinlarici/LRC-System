import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HTTPException(400, {
      message: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
    });
  }
  return result.data;
}
