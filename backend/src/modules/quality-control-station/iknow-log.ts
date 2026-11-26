// Registro delle chiamate di iKnow a POST /api/delibere/accettate (tabella photo_iknow_calls).
// Serve alla pagina Quality Control Station per vedere se le chiamate arrivano e perché falliscono.
// Mai il token né l'header Authorization: solo l'esito. Il log non deve mai far fallire la chiamata.
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export const ESITI = [
  'ok', 'duplicata', 'fase_sconosciuta', 'ignorata_origine',
  'token_errato', 'token_non_configurato', 'corpo_non_valido', 'errore_interno',
] as const;
export type Esito = typeof ESITI[number];

export const RETENTION_DAYS = 30;
const FIELD_MAX = 80;
const FIELDS = ['seriale', 'commessa', 'fase', 'componente', 'versione', 'data_ora'] as const;
type Field = typeof FIELDS[number];

export type CallLog = {
  ip: string | null;
  httpStatus: number;
  esito: Esito;
  dettaglio?: string | null;
  campi?: Partial<Record<Field, string>>;
  jobId?: number | null;
};

/** Estrae dal corpo (anche non valido) i soli campi noti, solo se stringhe, tagliati: mai il corpo intero. */
export function peekFields(raw: unknown): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const f of FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (typeof v === 'string' || typeof v === 'number') out[f] = String(v).slice(0, FIELD_MAX);
  }
  return out;
}

/** L'IP arriva da un header che chi chiama può falsificare: va solo mostrato, mai usato per decidere. */
export function cleanIp(raw: string | undefined): string | null {
  const first = raw?.split(',')[0]?.trim().replace(/[^\x20-\x7e]/g, '');
  return first ? first.slice(0, 64) : null;
}

export async function recordCall(call: CallLog): Promise<void> {
  try {
    const f = call.campi ?? {};
    await db`
      INSERT INTO photo_iknow_calls (ip, http_status, esito, dettaglio, seriale, commessa, fase, componente, versione, data_ora, job_id)
      VALUES (${call.ip}, ${call.httpStatus}, ${call.esito}, ${call.dettaglio?.slice(0, 300) ?? null},
              ${f.seriale ?? null}, ${f.commessa ?? null}, ${f.fase ?? null}, ${f.componente ?? null},
              ${f.versione ?? null}, ${f.data_ora ?? null}, ${call.jobId ?? null})
    `;
    // Pulizia a campione (≈1 chiamata su 50): evita un job a parte per una tabella piccola
    if (Math.random() < 0.02) {
      await db`DELETE FROM photo_iknow_calls WHERE received_at < now() - make_interval(days => ${RETENTION_DAYS})`;
    }
  } catch (e) {
    logger.error({ err: e }, 'iknow: registro chiamata non scritto');
  }
}

export async function listCalls(limit: number) {
  const calls = await db`
    SELECT id::int AS id, received_at, ip, http_status, esito, dettaglio, seriale, commessa, fase, componente, versione, data_ora, job_id::int AS job_id
    FROM photo_iknow_calls ORDER BY id DESC LIMIT ${limit}
  `;
  // Conteggio per esito nelle ultime 24 ore: dice a colpo d'occhio se il problema è il token o altro
  const summary = await db`
    SELECT esito, count(*)::int AS n FROM photo_iknow_calls
    WHERE received_at >= now() - interval '24 hours' GROUP BY esito
  `;
  return { calls, summary_24h: Object.fromEntries(summary.map(r => [r.esito as string, r.n as number])) };
}
