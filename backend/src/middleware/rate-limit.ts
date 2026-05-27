import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auditLog } from '../lib/audit.js';

const MAX_ATTEMPTS = 10;
const WINDOW_MS    = 15 * 60 * 1000; // 15 minutes

const buckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

export function loginRateLimit(c: Context, next: Next) {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  const now    = Date.now();
  const bucket = buckets.get(ip);

  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      // fire-and-forget — auditLog never rejects (catches internally)
      auditLog({ action: 'login_rate_limited', ip, details: { attempts: bucket.count } });
      throw new HTTPException(429, {
        message: `Troppi tentativi. Riprova tra ${Math.ceil(retryAfter / 60)} minuti.`,
      });
    }
    bucket.count++;
  } else {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }

  return next();
}
