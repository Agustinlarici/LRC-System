/**
 * Tickets module auth — delegates entirely to the system-wide auth lib.
 * Kept as a thin re-export so tickets/routes.ts imports don't change.
 */
import { Hono } from 'hono';
import {
  requireModule, requireManage,
  type Env as SystemEnv, type AuthUser,
} from '../../lib/auth.js';

export type { AuthUser as ITUser };
export type Env = { Variables: { user: AuthUser } };

export const requireIT    = requireModule('tickets_it');
export const requireAdmin = requireManage('tickets_admin');

// Empty router — login/logout/me/users are now at /api/auth/...
export const authRoutes = new Hono<SystemEnv>();
