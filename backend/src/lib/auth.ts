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

const _JWT_SECRET = process.env.JWT_SECRET;
if (!_JWT_SECRET) throw new Error('JWT_SECRET env var is required — server cannot start without it');
export const JWT_SECRET = _JWT_SECRET;
export const COOKIE_NAME  = 'lrc_session';
const COOKIE_MAX_AGE      = 60 * 60 * 8; // 8 hours

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleKey =
  | 'ingresso_merci' | 'packing' | 'monitor' | 'monitor_resumen' | 'buffer'
  | 'mappa' | 'tickets' | 'tickets_it' | 'tickets_admin' | 'impostazioni' | 'dashboards'
  | 'spma' | 'recepciones' | 'edi' | 'monitor_parate' | 'monitor_motivi' | 'webddt' | 'qualita';

export type ModulePermission = {
  module_key: ModuleKey;
  can_view:   boolean;
  can_manage: boolean;
};

export type AuthUser = {
  id:              number;
  username:        string;
  display_name:    string;
  role:            'guest' | 'operator' | 'it' | 'admin';
  permissions:     ModulePermission[];
  email:           string | null;
  phone:           string | null;
  department_id:   number | null;
  department_name: string | null;
};

export type UserProfile = {
  email:           string | null;
  phone:           string | null;
  department_id:   number | null;
  department_name: string | null;
};

export type Env = { Variables: { user: AuthUser } };

// ─── Token helpers ────────────────────────────────────────────────────────────

export type TokenPayload = Pick<AuthUser, 'id' | 'username' | 'display_name' | 'role'>;

export function signToken(payload: TokenPayload): string {
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

// ─── Load permissions / profile from DB ────────────────────────────────────────

async function loadPermissions(userId: number): Promise<ModulePermission[]> {
  const rows = await db<ModulePermission[]>`
    SELECT module_key, can_view, can_manage
    FROM user_module_permissions
    WHERE user_id = ${userId}
  `;
  return rows;
}

const EMPTY_PROFILE: UserProfile = { email: null, phone: null, department_id: null, department_name: null };

export async function loadProfile(userId: number): Promise<UserProfile> {
  try {
    const [row] = await db<UserProfile[]>`
      SELECT u.email, u.phone, u.department_id, d.name AS department_name
      FROM users u
      LEFT JOIN ticket_departments d ON d.id = u.department_id
      WHERE u.id = ${userId}
    `;
    return row ?? EMPTY_PROFILE;
  } catch {
    // phone/department_id may not exist yet if migrate-tickets-user-profile.sql
    // hasn't run on this DB — degrade gracefully instead of failing every request
    return EMPTY_PROFILE;
  }
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

  const [permissions, profile] = await Promise.all([
    loadPermissions(payload.id),
    loadProfile(payload.id),
  ]);
  const user: AuthUser = { ...payload, ...profile, permissions };
  c.set('user', user);
  await next();
}

// ─── Optional auth (public routes that behave differently when logged in) ──────

/** Returns the current user if a valid session cookie is present, otherwise null. Never throws. */
export async function getOptionalUser(c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  let payload: any;
  try {
    payload = verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const [permissions, profile] = await Promise.all([
    loadPermissions(payload.id),
    loadProfile(payload.id),
  ]);
  return { ...payload, ...profile, permissions };
}

// ─── Module permission middleware factories ────────────────────────────────────

export function requireModule(moduleKey: ModuleKey) {
  return async function (c: Context<Env>, next: Next) {
    await requireAuth(c, async () => {});
    const user = c.get('user');
    if (user.role !== 'admin') {
      const perm = user.permissions.find(p => p.module_key === moduleKey);
      if (!perm?.can_view) {
        throw new HTTPException(403, { message: `Accesso al modulo '${moduleKey}' negato` });
      }
    }
    await next();
  };
}

export function requireManage(moduleKey: ModuleKey) {
  return async function (c: Context<Env>, next: Next) {
    await requireAuth(c, async () => {});
    const user = c.get('user');
    if (user.role !== 'admin') {
      const perm = user.permissions.find(p => p.module_key === moduleKey);
      if (!perm?.can_manage) {
        throw new HTTPException(403, { message: `Permessi di gestione per '${moduleKey}' negati` });
      }
    }
    await next();
  };
}
