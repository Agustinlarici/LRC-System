import { db } from '../db/client.js';
import { logger } from './logger.js';

export interface AuditEntry {
  userId?:   number | null;
  username?: string | null;
  action:    string;
  entity?:   string | null;
  entityId?: string | number | null;
  ip?:       string | null;
  details?:  Record<string, unknown> | null;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await db`
      INSERT INTO audit_log (user_id, username, action, entity, entity_id, ip, details)
      VALUES (
        ${entry.userId   ?? null},
        ${entry.username ?? null},
        ${entry.action},
        ${entry.entity   ?? null},
        ${entry.entityId != null ? String(entry.entityId) : null},
        ${entry.ip       ?? null},
        ${entry.details  ? JSON.parse(JSON.stringify(entry.details)) : null}
      )
    `;
  } catch (err) {
    // Audit failures must never break the main request flow
    logger.error({ err }, 'audit_log: write failed');
  }
}
