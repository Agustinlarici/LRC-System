import { db } from '../../db/client.js';
import { scanFerrariFolder, type ScanRow } from './ferrari-ingresso-parser.js';

export const FERRARI_DELINS_FOLDER =
  process.env.EDI_FERRARI_DELINS_FOLDER || '\\\\192.168.1.245\\edi\\FERRARI\\DELINS';

export interface FerrariSyncStats {
  rows:            number;
  files_processed: number;
  files_skipped:   number;
  errors:          { file: string; error: string }[];
}

// ─── Stato sync in memoria ────────────────────────────────────────────────────

export type SyncState =
  | { status: 'idle' }
  | { status: 'running'; started_at: string }
  | { status: 'done';    finished_at: string; stats: FerrariSyncStats }
  | { status: 'error';   finished_at: string; message: string };

let syncState: SyncState = { status: 'idle' };

export function getSyncState(): SyncState {
  return syncState;
}

// ─── Sync effettivo (può durare minuti) ───────────────────────────────────────

const BATCH = 500;

export async function syncFerrariDelins(): Promise<FerrariSyncStats> {
  const result = await scanFerrariFolder(FERRARI_DELINS_FOLDER);
  const now    = new Date();

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    await tx`TRUNCATE edi_ferrari_delins`;
    if (result.rows.length > 0) {
      const values = result.rows.map((r: ScanRow) => ({ ...r, scanned_at: now }));
      for (let i = 0; i < values.length; i += BATCH) {
        await tx`INSERT INTO edi_ferrari_delins ${tx(values.slice(i, i + BATCH))}`;
      }
    }
  });

  // Aggiorna le statistiche del planner dopo il caricamento massiccio
  await db`ANALYZE edi_ferrari_delins`;

  return {
    rows:            result.rows.length,
    files_processed: result.files_processed,
    files_skipped:   result.files_skipped,
    errors:          result.errors,
  };
}

// ─── Avvio in background (non blocca la request HTTP) ────────────────────────

export function startSyncInBackground(): SyncState {
  if (syncState.status === 'running') return syncState;

  syncState = { status: 'running', started_at: new Date().toISOString() };

  syncFerrariDelins()
    .then(stats  => { syncState = { status: 'done',  finished_at: new Date().toISOString(), stats }; })
    .catch(err   => { syncState = { status: 'error', finished_at: new Date().toISOString(), message: (err as Error).message }; });

  return syncState;
}
