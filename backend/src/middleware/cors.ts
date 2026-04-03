import { cors } from 'hono/cors';

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Allow any origin on port 3000 (internal tool, LAN + VPN)
  try {
    const url = new URL(origin);
    return url.port === '3000';
  } catch { return false; }
}

export const corsMiddleware = cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : '',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
});
