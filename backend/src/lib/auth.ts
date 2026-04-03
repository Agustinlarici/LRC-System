/**
 * System-wide authentication library
 * JWT cookie: lrc_session
 */
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import jwt from 'jsonwebtoken';
import { db } from '../db/client.js';

const { sign, verify } = jwt;

export const JWT_SECRET   = process.env.JWT_SECRET ?? 'change-me-in-production';
export const COOKIE_NAME  = 'lrc_session';
const COOKIE_MAX_AGE      = 60 * 60 * 8; // 8 hours

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleKey =
  | 'ingresso_merci' | 'packing' | 'monitor' | 'buffer'
  | 'mappa' | 'tickets' | 'tickets_it' | 'tickets_admin' | 'impostazioni' | 'dashboards';

export type ModulePermission = {
  module_key: ModuleKey;
  can_view:   boolean;
  can_manage: boolean;
};

export type AuthUser = {
  id:           number;
  username:     string;
  display_name: string;
  role:         'guest' | 'operator' | 'it' | 'admin';
  permissions:  ModulePermission[];
};

export type Env = { Variables: { user: AuthUser } };

// ─── Token helpers ────────────────────────────────────────────────────────────

export function signToken(payload: Omit<AuthUser, 'permissions'>): string {
  return sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge:   COOKIE_MAX_AGE,
    path:     '/',
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

// ─── Load permissions from DB ─────────────────────────────────────────────────

async function loadPermissions(userId: number): Promise<ModulePermission[]> {
  const rows = await db<ModulePermission[]>`
    SELECT module_key, can_view, can_manage
    FROM user_module_permissions
    WHERE user_id = ${userId}
  `;
  return rows;
}

// ─── Core middleware ───────────────────────────────────────────────────────────

export async function requireAuth(c: Context<Env>, next: Next) {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) throw new HTTPException(401, { message: 'Non autenticato' });

  let payload: any;
  try {
    payload = verify(token, JWT_SECRET);
  } catch {
    throw new HTTPException(401, { message: 'Sessione scaduta' });
  }

  const permissions = await loadPermissions(payload.id);
  const user: AuthUser = { ...payload, permissions };
  c.set('user', user);
  await next();
}

// ─── Module permission middleware factories ────────────────────────────────────

export function requireModule(moduleKey: ModuleKey) {
  return async function (c: Context<Env>, next: Next) {
    await requireAuth(c, async () => {});
    const user = c.get('user');
    const perm = user.permissions.find(p => p.module_key === moduleKey);
    if (!perm?.can_view) {
      throw new HTTPException(403, { message: `Accesso al modulo '${moduleKey}' negato` });
    }
    await next();
  };
}

export function requireManage(moduleKey: ModuleKey) {
  return async function (c: Context<Env>, next: Next) {
    await requireAuth(c, async () => {});
    const user = c.get('user');
    const perm = user.permissions.find(p => p.module_key === moduleKey);
    if (!perm?.can_manage) {
      throw new HTTPException(403, { message: `Permessi di gestione per '${moduleKey}' negati` });
    }
    await next();
  };
}
