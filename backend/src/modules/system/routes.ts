import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../lib/validate.js';
import { getIKnowFlags, setIKnowFlags } from '../../lib/system-flags.js';

export const systemRoutes = new Hono();

systemRoutes.get('/iknow-flags', async (c) => {
  const flags = await getIKnowFlags();
  return c.json(flags);
});

systemRoutes.patch('/iknow-flags', async (c) => {
  const body = await parseBody(c, z.object({
    iknow_enabled:        z.boolean().optional(),
    iknow_andon_enabled:  z.boolean().optional(),
    iknow_buffer_enabled: z.boolean().optional(),
  }));
  const flags = await setIKnowFlags(body);
  return c.json(flags);
});
