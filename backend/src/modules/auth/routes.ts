import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomInt, createHash } from 'crypto';
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

// ─── Change own password ────────────────────────────────────────────────────────
// Usato sia dal cambio volontario, sia dal cambio obbligatorio al primo accesso
// (quando l'admin assegna una password generica, must_change_password = TRUE).

authRoutes.post('/change-password', requireAuth, async (c) => {
  const user = c.get('user');
  const ip   = requestIp(c);

  const body = await parseBody(c, z.object({
    current_password: z.string().min(1),
    new_password:      z.string().min(6),
  }));

  const [row] = await db<{ password_hash: string }[]>`
    SELECT password_hash FROM users WHERE id = ${user.id}
  `;
  if (!row) throw new HTTPException(404, { message: 'Utente non trovato' });

  const valid = await compare(body.current_password, row.password_hash);
  if (!valid) {
    await auditLog({ userId: user.id, username: user.username, action: 'change_password_failed', ip, details: { reason: 'wrong_current_password' } });
    throw new HTTPException(401, { message: 'Password attuale non corretta' });
  }

  const password_hash = await hash(body.new_password, 10);
  await db`
    UPDATE users SET password_hash = ${password_hash}, must_change_password = FALSE WHERE id = ${user.id}
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'password_changed', ip });

  return c.json({ status: 'ok' });
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
    INSERT INTO users (username, password_hash, display_name, email, phone, department_id, role, must_change_password)
    VALUES (${body.username}, ${password_hash}, ${body.display_name}, ${body.email ?? null}, ${body.phone ?? null}, ${body.department_id ?? null}, ${body.role ?? 'operator'}, TRUE)
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
  if (body.password      !== undefined) {
    updates.password_hash = await hash(body.password, 10);
    updates.must_change_password = true;
  }

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
      module_key: z.enum(['ingresso_merci','packing','monitor','monitor_resumen','buffer','mappa','tickets','tickets_it','tickets_admin','impostazioni','dashboards','spma','recepciones','edi','monitor_parate','monitor_motivi','webddt','qualita','programma_produzione','hr','hr_salary']),
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

// ─── Device pairing (kiosk tablets that skip login) ────────────────────────────
// Un dispositivo condiviso (es. tablet montato in produzione) può restare
// autenticato senza password: un admin genera un codice a 6 cifre valido 10
// minuti per un utente specifico, il dispositivo lo scambia una sola volta con
// un token lungo salvato in localStorage, e ad ogni apertura lo scambia con una
// sessione normale. Il token è revocabile singolarmente da /admin/system.

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function requestIp(c: any): string | null {
  return c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? null;
}

authRoutes.post('/devices/pair/generate', requireManage('tickets_admin'), async (c) => {
  const body = await parseBody(c, z.object({
    user_id: z.number().int().positive(),
    label:   z.string().min(1).max(100),
  }));

  const [target] = await db<{ id: number }[]>`SELECT id FROM users WHERE id = ${body.user_id} AND is_active`;
  if (!target) throw new HTTPException(404, { message: 'Utente non trovato' });

  await db`DELETE FROM device_pairing_codes WHERE expires_at < now()`;

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

  await db`
    INSERT INTO device_pairing_codes (code, user_id, label, expires_at)
    VALUES (${code}, ${body.user_id}, ${body.label}, ${expiresAt})
  `;

  const actor = c.get('user');
  await auditLog({ userId: actor.id, username: actor.username, action: 'device_pair_code_generated', entity: 'device_tokens', details: { for_user_id: body.user_id, label: body.label } });

  return c.json({ code, expires_at: expiresAt });
});

authRoutes.post('/devices/pair/redeem', loginRateLimit, async (c) => {
  const ip = requestIp(c);
  const body = await parseBody(c, z.object({ code: z.string().length(6) }));

  const [pairing] = await db<{ user_id: number; label: string }[]>`
    SELECT user_id, label FROM device_pairing_codes
    WHERE code = ${body.code} AND expires_at > now()
  `;
  if (!pairing) {
    await auditLog({ action: 'device_pair_redeem_failed', ip, details: { reason: 'invalid_or_expired_code' } });
    throw new HTTPException(401, { message: 'Codice non valido o scaduto' });
  }

  const [user] = await db<{ id: number; username: string; display_name: string; role: string; is_active: boolean }[]>`
    SELECT id, username, display_name, role, is_active FROM users WHERE id = ${pairing.user_id}
  `;
  if (!user || !user.is_active) throw new HTTPException(401, { message: 'Utente non attivo' });

  const deviceToken = randomBytes(32).toString('hex');
  await db`
    INSERT INTO device_tokens (user_id, token_hash, label)
    VALUES (${pairing.user_id}, ${hashDeviceToken(deviceToken)}, ${pairing.label})
  `;
  await db`DELETE FROM device_pairing_codes WHERE code = ${body.code}`;

  const [permissions, profile] = await Promise.all([
    db<{ module_key: string; can_view: boolean; can_manage: boolean }[]>`
      SELECT module_key, can_view, can_manage FROM user_module_permissions WHERE user_id = ${user.id}
    `,
    loadProfile(user.id),
  ]);

  const payload: TokenPayload = { id: user.id, username: user.username, display_name: user.display_name, role: user.role as TokenPayload['role'] };
  setSessionCookie(c, signToken(payload));
  await auditLog({ userId: user.id, username: user.username, action: 'device_paired', ip, details: { label: pairing.label } });

  return c.json({ device_token: deviceToken, user: { ...payload, ...profile, permissions } });
});

authRoutes.post('/devices/login', loginRateLimit, async (c) => {
  const ip = requestIp(c);
  const body = await parseBody(c, z.object({ device_token: z.string().min(32) }));
  const tokenHash = hashDeviceToken(body.device_token);

  const [device] = await db<{ id: number; user_id: number }[]>`
    SELECT id, user_id FROM device_tokens WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
  `;
  if (!device) {
    await auditLog({ action: 'device_login_failed', ip, details: { reason: 'unknown_or_revoked_token' } });
    throw new HTTPException(401, { message: 'Dispositivo non riconosciuto' });
  }

  const [user] = await db<{ id: number; username: string; display_name: string; role: string; is_active: boolean }[]>`
    SELECT id, username, display_name, role, is_active FROM users WHERE id = ${device.user_id}
  `;
  if (!user || !user.is_active) throw new HTTPException(401, { message: 'Utente non attivo' });

  const [permissions, profile] = await Promise.all([
    db<{ module_key: string; can_view: boolean; can_manage: boolean }[]>`
      SELECT module_key, can_view, can_manage FROM user_module_permissions WHERE user_id = ${user.id}
    `,
    loadProfile(user.id),
  ]);

  const payload: TokenPayload = { id: user.id, username: user.username, display_name: user.display_name, role: user.role as TokenPayload['role'] };
  setSessionCookie(c, signToken(payload));
  await db`UPDATE device_tokens SET last_used_at = now() WHERE id = ${device.id}`;

  return c.json({ user: { ...payload, ...profile, permissions } });
});

authRoutes.get('/devices', requireManage('tickets_admin'), async (c) => {
  const devices = await db`
    SELECT dt.id, dt.label, dt.created_at, dt.last_used_at, dt.revoked_at,
           u.id AS user_id, u.display_name AS user_display_name
    FROM device_tokens dt
    JOIN users u ON u.id = dt.user_id
    ORDER BY dt.revoked_at IS NOT NULL, dt.created_at DESC
  `;
  return c.json(devices);
});

authRoutes.delete('/devices/:id', requireManage('tickets_admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [revoked] = await db`
    UPDATE device_tokens SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL
    RETURNING id, label
  `;
  if (!revoked) throw new HTTPException(404, { message: 'Dispositivo non trovato o già revocato' });

  const actor = c.get('user');
  await auditLog({ userId: actor.id, username: actor.username, action: 'device_revoked', entity: 'device_tokens', entityId: id, details: { label: revoked.label } });

  return c.json({ status: 'ok' });
});
