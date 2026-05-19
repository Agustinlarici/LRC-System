/**
 * Alert Manager — tracks active incidents, debounces notifications,
 * persists history to PostgreSQL.
 *
 * raiseAlert(key, ...) — opens a new incident (no-op if already open)
 * resolveAlert(key)    — closes the incident and notifies resolution
 */

import { db } from '../db/client.js';
import { sendAlert, sendResolved } from './notifier.js';
import { getAllStats } from './sync-stats.js';
import { logger } from './logger.js';

export type Severity = 'critical' | 'warning' | 'info';

interface ActiveAlert {
  key:       string;
  severity:  Severity;
  title:     string;
  message:   string;
  startedAt: Date;
  dbId?:     number;
}

const active = new Map<string, ActiveAlert>();

// ─── Core API ─────────────────────────────────────────────────────────────────

export async function raiseAlert(
  key: string,
  severity: Severity,
  title: string,
  message: string,
): Promise<void> {
  if (active.has(key)) return; // already open

  const alert: ActiveAlert = { key, severity, title, message, startedAt: new Date() };
  active.set(key, alert);

  try {
    const [row] = await db`
      INSERT INTO system_alerts (alert_key, severity, title, message)
      VALUES (${key}, ${severity}, ${title}, ${message})
      RETURNING id
    `;
    alert.dbId = row.id as number;
  } catch (e) {
    logger.warn(`[AlertManager] DB insert failed: ${e}`);
  }

  const prefix = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';
  await sendAlert(`${prefix} ${title}`, message, key);
  logger.warn(`[AlertManager] RAISED ${key}: ${message}`);
}

export async function resolveAlert(key: string, resolvedMsg?: string): Promise<void> {
  const alert = active.get(key);
  if (!alert) return;

  active.delete(key);

  if (alert.dbId) {
    try {
      await db`
        UPDATE system_alerts
        SET resolved_at = NOW(), resolved_message = ${resolvedMsg ?? null}
        WHERE id = ${alert.dbId}
      `;
    } catch { /* non-critical */ }
  }

  await sendResolved(alert.title, key);
  logger.info(`[AlertManager] RESOLVED ${key}`);
}

export function isAlertActive(key: string): boolean {
  return active.has(key);
}

export function getActiveAlerts(): ActiveAlert[] {
  return Array.from(active.values());
}

// ─── Sync health checks (called by watchdog every 2 min) ─────────────────────

export async function checkSyncHealth(): Promise<void> {
  const stats = getAllStats();
  const now   = Date.now();

  // ── sync_incremental ──────────────────────────────────────────────────────
  const inc = stats['sync_incremental'];
  if (inc) {
    const lastMs       = inc.lastFinishedAt ? new Date(inc.lastFinishedAt).getTime() : 0;
    const minSinceLast = (now - lastMs) / 60_000;

    // Job in error state
    if (inc.status === 'error') {
      await raiseAlert(
        'sync_incremental_error', 'warning',
        'Sync WebThron in errore',
        `Errore: ${inc.lastError ?? 'sconosciuto'}`,
      );
    } else if (isAlertActive('sync_incremental_error')) {
      await resolveAlert('sync_incremental_error', 'Sync ripristinato');
    }

    // Missed 2+ cycles: last run was >25 min ago and the job is not currently running
    if (lastMs > 0 && minSinceLast > 25 && inc.status !== 'running') {
      await raiseAlert(
        'sync_incremental_missed', 'critical',
        'Sync WebThron bloccato',
        `Nessun ciclo da ${Math.round(minSinceLast)} min (atteso ogni 10 min)`,
      );
    } else if (isAlertActive('sync_incremental_missed') && minSinceLast < 15) {
      await resolveAlert('sync_incremental_missed', 'Sync ripreso');
    }
  }

  // ── bc_sync ───────────────────────────────────────────────────────────────
  const bc = stats['bc_sync'];
  if (bc?.status === 'error') {
    await raiseAlert(
      'bc_sync_error', 'warning',
      'Sync Business Central fallito',
      bc.lastError ?? 'Errore sconosciuto',
    );
  } else if (isAlertActive('bc_sync_error')) {
    await resolveAlert('bc_sync_error');
  }

  // ── heatmap_snapshot ──────────────────────────────────────────────────────
  const oee = stats['heatmap_snapshot'];
  if (oee?.status === 'error') {
    await raiseAlert(
      'oee_snapshot_error', 'warning',
      'Snapshot OEE fallito',
      oee.lastError ?? 'Errore sconosciuto',
    );
  } else if (isAlertActive('oee_snapshot_error')) {
    await resolveAlert('oee_snapshot_error');
  }

  // ── lookup_refresh ────────────────────────────────────────────────────────
  const lk = stats['lookup_refresh'];
  if (lk?.status === 'error') {
    await raiseAlert(
      'lookup_refresh_error', 'info',
      'Refresh lookup tables fallito',
      lk.lastError ?? 'Errore sconosciuto',
    );
  } else if (isAlertActive('lookup_refresh_error')) {
    await resolveAlert('lookup_refresh_error');
  }
}
