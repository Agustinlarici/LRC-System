/**
 * Shared sync performance tracker.
 * Each WebThron job calls startRun() / endRun() / failRun().
 * GET /api/system/sync-status returns the full picture.
 */

export interface RunStats {
  lastStartedAt:   string | null;   // ISO
  lastFinishedAt:  string | null;
  lastDurationMs:  number | null;
  lastRowCount:    number | null;
  lastError:       string | null;
  runCount:        number;
  nextScheduledAt: string | null;
  status:          'idle' | 'running' | 'ok' | 'error';
}

const stats: Record<string, RunStats> = {};

function ensure(job: string): RunStats {
  if (!stats[job]) {
    stats[job] = {
      lastStartedAt: null, lastFinishedAt: null,
      lastDurationMs: null, lastRowCount: null,
      lastError: null, runCount: 0,
      nextScheduledAt: null, status: 'idle',
    };
  }
  return stats[job];
}

const runStartMs: Record<string, number> = {};

export function startRun(job: string): void {
  const s = ensure(job);
  s.lastStartedAt = new Date().toISOString();
  s.lastError     = null;
  s.status        = 'running';
  runStartMs[job] = Date.now();
}

export function endRun(job: string, rows: number): void {
  const s = ensure(job);
  const ms = Date.now() - (runStartMs[job] ?? Date.now());
  s.lastFinishedAt = new Date().toISOString();
  s.lastDurationMs = ms;
  s.lastRowCount   = rows;
  s.lastError      = null;
  s.status         = 'ok';
  s.runCount++;
}

export function failRun(job: string, err: unknown): void {
  const s = ensure(job);
  const ms = Date.now() - (runStartMs[job] ?? Date.now());
  s.lastFinishedAt = new Date().toISOString();
  s.lastDurationMs = ms;
  s.lastError      = err instanceof Error ? err.message : String(err);
  s.status         = 'error';
  s.runCount++;
}

export function setNextRun(job: string, at: Date): void {
  ensure(job).nextScheduledAt = at.toISOString();
}

export function getAllStats(): Record<string, RunStats> {
  return stats;
}
