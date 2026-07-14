import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { compare, hash } from 'bcryptjs';
import { db } from '../../db/client.js';
import { parseBody } from '../../lib/validate.js';
import {
  requireAuth, requireManage, signToken, setSessionCookie, clearSessionCookie, loadProfile,
  type Env, type TokenPayload,
} from '../../lib/auth.js';
import { loginRateLimit } from '../../middleware/rate-limit.js';
import { auditLog } from '../../lib/audit.js';

export const authRoutes = new Hono<Env>();

// ─── Login ────────────────────────────────────────────────────────────────────

authRoutes.post('/login', loginRateLimit, async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? null;

  const body = await parseBody(c, z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }));

  const [user] = await db<{ id: number; username: string; password_hash: string; display_name: string; role: string; is_active: boolean }[]>`
    SELECT id, username, password_hash, display_name, role, is_active
    FROM users WHERE lower(username) = ${body.username.toLowerCase()}
  `;

  if (!user || !user.is_active) {
    await auditLog({ username: body.username, action: 'login_failed', ip, details: { reason: 'user_not_found_or_inactive' } });
    throw new HTTPException(401, { message: 'Credenziali non valide' });
  }

  const valid = await compare(body.password, user.password_hash);
  if (!valid) {
    await auditLog({ userId: user.id, username: user.username, action: 'login_failed', ip, details: { reason: 'wrong_password' } });
    throw new HTTPException(401, { message: 'Credenziali non valide' });
  }

  const [permissions, profile] = await Promise.all([
    db`
      SELECT module_key, can_view, can_manage
      FROM user_module_permissions WHERE user_id = ${user.id}
    `,
    loadProfile(user.id),
  ]);

  const payload: TokenPayload = {
    id:           user.id,
    username:     user.username,
    display_name: user.display_name,
    role:         user.role as TokenPayload['role'],
  };

  setSessionCookie(c, signToken(payload));
  await auditLog({ userId: user.id, username: user.username, action: 'login_success', ip });

  return c.json({ user: { ...payload, ...profile, permissions } });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

authRoutes.post('/logout', requireAuth, async (c) => {
  const user = c.get('user');
  const ip   = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? null;
  clearSessionCookie(c);
  await auditLog({ userId: user.id, username: user.username, action: 'logout', ip });
  return c.json({ status: 'ok' });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') });
});

// ─── Users list ───────────────────────────────────────────────────────────────

authRoutes.get('/users', requireManage('tickets_admin'), async (c) => {
  const users = await db`
    SELECT u.id, u.username, u.display_name, u.email, u.phone, u.department_id, d.name AS department_name,
           u.role, u.is_active, u.created_at
    FROM users u
    LEFT JOIN ticket_departments d ON d.id = u.department_id
    ORDER BY u.display_name
  `;
  return c.json(users);
});

// ─── Create user ──────────────────────────────────────────────────────────────

authRoutes.post('/users', requireManage('tickets_admin'), async (c) => {
  const body = await parseBody(c, z.object({
    username:      z.string().min(2).max(50),
    password:      z.string().min(6),
    display_name:  z.string().min(1).max(100),
    email:         z.string().email().optional(),
    phone:         z.string().max(30).optional(),
    department_id: z.number().int().positive().optional(),
    role:          z.enum(['guest', 'operator', 'it', 'admin']).default('operator'),
  }));

  const password_hash = await hash(body.password, 10);
  const [created] = await db`
    INSERT INTO users (username, password_hash, display_name, email, phone, department_id, role)
    VALUES (${body.username}, ${password_hash}, ${body.display_name}, ${body.email ?? null}, ${body.phone ?? null}, ${body.department_id ?? null}, ${body.role ?? 'operator'})
    RETURNING id, username, display_name, email, phone, department_id, role, is_active, created_at
  `;
  const actor = c.get('user');
  await auditLog({ userId: actor.id, username: actor.username, action: 'user_created', entity: 'users', entityId: created.id, details: { new_username: body.username, role: body.role } });
  return c.json(created, 201);
});

// ─── Update user ──────────────────────────────────────────────────────────────

authRoutes.patch('/users/:id', requireManage('tickets_admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, z.object({
    display_name:  z.string().min(1).max(100).optional(),
    email:         z.string().email().nullable().optional(),
    phone:         z.string().max(30).nullable().optional(),
    department_id: z.number().int().positive().nullable().optional(),
    role:          z.enum(['guest', 'operator', 'it', 'admin']).optional(),
    is_active:     z.boolean().optional(),
    password:      z.string().min(6).optional(),
  }));

  const updates: Record<string, any> = {};
  if (body.display_name  !== undefined) updates.display_name  = body.display_name;
  if (body.email         !== undefined) updates.email         = body.email;
  if (body.phone         !== undefined) updates.phone         = body.phone;
  if (body.department_id !== undefined) updates.department_id = body.department_id;
  if (body.role          !== undefined) updates.role          = body.role;
  if (body.is_active     !== undefined) updates.is_active     = body.is_active;
  if (body.password      !== undefined) updates.password_hash = await hash(body.password, 10);

  if (!Object.keys(updates).length) {
    throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });
  }

  const [updated] = await db`
    UPDATE users SET ${db(updates)} WHERE id = ${id}
    RETURNING id, username, display_name, email, phone, department_id, role, is_active
  `;
  if (!updated) throw new HTTPException(404, { message: 'Utente non trovato' });
  const actor = c.get('user');
  const changedFields = Object.keys(updates).filter(k => k !== 'password_hash');
  await auditLog({ userId: actor.id, username: actor.username, action: 'user_updated', entity: 'users', entityId: id, details: { changed_fields: changedFields } });
  return c.json(updated);
});

// ─── Get user permissions ──────────────────────────────────────────────────────

authRoutes.get('/users/:id/permissions', requireManage('tickets_admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const perms = await db`
    SELECT module_key, can_view, can_manage
    FROM user_module_permissions WHERE user_id = ${id}
  `;
  return c.json(perms);
});

// ─── Replace user permissions (bulk) ──────────────────────────────────────────

authRoutes.put('/users/:id/permissions', requireManage('tickets_admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, z.object({
    permissions: z.array(z.object({
      module_key: z.enum(['ingresso_merci','packing','monitor','monitor_resumen','buffer','mappa','tickets','tickets_it','tickets_admin','impostazioni','dashboards','spma','recepciones','edi','monitor_parate','monitor_motivi','webddt']),
      can_view:   z.boolean(),
      can_manage: z.boolean(),
    })),
  }));

  // Delete existing and re-insert
  await db`DELETE FROM user_module_permissions WHERE user_id = ${id}`;

  if (body.permissions.length > 0) {
    for (const p of body.permissions) {
      await db`
        INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
        VALUES (${id}, ${p.module_key}, ${p.can_view}, ${p.can_manage})
      `;
    }
  }

  const perms = await db`
    SELECT module_key, can_view, can_manage
    FROM user_module_permissions WHERE user_id = ${id}
  `;
  return c.json(perms);
});
