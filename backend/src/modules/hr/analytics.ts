import { Hono } from 'hono';
import { db } from '../../db/client.js';
import { requireModule, type Env } from '../../lib/auth.js';

export const hrAnalyticsRoutes = new Hono<Env>();

// Serie mensile richiesta: ultimi N mesi (?months=) oppure un intervallo personalizzato
// (?from=YYYY-MM-DD&to=YYYY-MM-DD, presi al mese) oppure tutto lo storico (?all=1, dalla prima
// assunzione a oggi). Ritorna il primo mese e quanti mesi.
const MAX_MONTHS = 600;
async function monthRange(q: (k: string) => string | undefined): Promise<{ start: string; count: number }> {
  const re = /^(\d{4})-(\d{2})/;
  const mf = q('from')?.match(re);
  const mt = q('to')?.match(re);
  let lo: number, count: number;
  if (mf && mt) {
    const a = Number(mf[1]) * 12 + Number(mf[2]) - 1;
    const b = Number(mt[1]) * 12 + Number(mt[2]) - 1;
    lo = Math.min(a, b);
    count = Math.min(Math.abs(b - a) + 1, MAX_MONTHS);
  } else if (q('all')) {
    const [first] = await db`SELECT to_char(date_trunc('month', MIN(data_assunzione)), 'YYYY-MM') AS ym FROM hr_employee`;
    const m = String(first?.ym ?? '').match(re);
    const now = new Date();
    const nowIdx = now.getFullYear() * 12 + now.getMonth();
    lo = m ? Number(m[1]) * 12 + Number(m[2]) - 1 : nowIdx - 11;
    count = Math.min(nowIdx - lo + 1, MAX_MONTHS);
    lo = nowIdx - count + 1;
  } else {
    count = Math.min(Math.max(parseInt(q('months') ?? '24', 10) || 24, 1), 120);
    const now = new Date();
    lo = now.getFullYear() * 12 + now.getMonth() - (count - 1);
  }
  return { start: `${Math.floor(lo / 12)}-${String((lo % 12) + 1).padStart(2, '0')}-01`, count };
}

// ─── Riepilogo generale ────────────────────────────────────────────────────────

hrAnalyticsRoutes.get('/summary', requireModule('hr'), async (c) => {
  const [totals] = await db`
    SELECT
      COUNT(*) FILTER (WHERE stato != 'cessato')::int AS total_attivi,
      ROUND(AVG(EXTRACT(YEAR FROM AGE(now(), data_nascita))) FILTER (WHERE stato != 'cessato' AND data_nascita IS NOT NULL), 1)::float8 AS eta_media,
      ROUND(AVG(EXTRACT(EPOCH FROM AGE(now(), data_assunzione)) / (365.25*86400)) FILTER (WHERE stato != 'cessato'), 1)::float8 AS anzianita_media,
      COUNT(*) FILTER (WHERE data_assunzione >= now() - interval '1 year')::int AS assunzioni_ultimo_anno,
      COUNT(*) FILTER (WHERE data_cessazione >= now() - interval '1 year')::int AS cessazioni_ultimo_anno
    FROM hr_employee
  `;

  const eventRows = await db`
    SELECT event_type, COUNT(*)::int AS count
    FROM hr_employee_event
    WHERE event_date >= now() - interval '1 year'
    GROUP BY event_type
  `;
  const eventi_ultimo_anno: Record<string, number> = {};
  for (const row of eventRows) eventi_ultimo_anno[row.event_type] = row.count;

  return c.json({ ...totals, eventi_ultimo_anno });
});

// ─── Distribuzione età per funzione aziendale ───

hrAnalyticsRoutes.get('/age-distribution', requireModule('hr'), async (c) => {
  const rows = await db`
    SELECT
      COALESCE(NULLIF(TRIM(e.funzione_aziendale), ''), 'Senza funzione') AS funzione_name,
      EXTRACT(YEAR FROM AGE(now(), e.data_nascita))::int AS eta,
      COUNT(*)::int AS count
    FROM hr_employee e
    WHERE e.stato != 'cessato' AND e.data_nascita IS NOT NULL
    GROUP BY funzione_name, eta
    ORDER BY eta
  `;
  return c.json(rows);
});

// ─── Distribuzione per reparto / capo ──────────────────────────────────────────

hrAnalyticsRoutes.get('/department-distribution', requireModule('hr'), async (c) => {
  const rows = await db`
    SELECT COALESCE(NULLIF(TRIM(e.funzione_aziendale), ''), 'Senza funzione') AS funzione_name, COUNT(*)::int AS count
    FROM hr_employee e
    WHERE e.stato != 'cessato'
    GROUP BY funzione_name
    ORDER BY count DESC
  `;
  return c.json(rows);
});

hrAnalyticsRoutes.get('/manager-distribution', requireModule('hr'), async (c) => {
  const rows = await db`
    SELECT e.capo_id, COALESCE(capo.nome || ' ' || capo.cognome, 'Senza responsabile') AS capo_nome, COUNT(*)::int AS count
    FROM hr_employee e
    LEFT JOIN hr_employee capo ON capo.id = e.capo_id
    WHERE e.stato != 'cessato'
    GROUP BY e.capo_id, capo_nome
    ORDER BY count DESC
  `;
  return c.json(rows);
});

// ─── Evoluzione aziendale — serie mensile calcolata on-demand ──────────────────
// Il volume di dipendenti è contenuto (centinaia, non migliaia), quindi calcolarla
// dal vivo su hr_employee è più semplice e sempre corretto rispetto a mantenere
// una tabella di snapshot cache da tenere sincronizzata.

hrAnalyticsRoutes.get('/evolution', requireModule('hr'), async (c) => {
  const { start, count } = await monthRange(k => c.req.query(k));

  const rows = await db`
    WITH months AS (
      SELECT date_trunc('month', ${start}::date::timestamptz) + (n || ' months')::interval AS month_start
      FROM generate_series(0, ${count - 1}) n
    )
    SELECT
      m.month_start::date AS month,
      COUNT(*) FILTER (
        WHERE e.data_assunzione <= (m.month_start + interval '1 month' - interval '1 day')
          AND (e.data_cessazione IS NULL OR e.data_cessazione > (m.month_start + interval '1 month' - interval '1 day'))
      )::int AS total_employees,
      COUNT(*) FILTER (
        WHERE date_trunc('month', e.data_assunzione) = m.month_start
      )::int AS hires,
      COUNT(*) FILTER (
        WHERE date_trunc('month', e.data_cessazione) = m.month_start
      )::int AS terminations,
      ROUND(AVG(EXTRACT(YEAR FROM AGE(m.month_start, e.data_nascita))) FILTER (
        WHERE e.data_assunzione <= (m.month_start + interval '1 month' - interval '1 day')
          AND (e.data_cessazione IS NULL OR e.data_cessazione > (m.month_start + interval '1 month' - interval '1 day'))
          AND e.data_nascita IS NOT NULL
      ), 1)::float8 AS avg_age,
      ROUND(AVG(EXTRACT(EPOCH FROM AGE(m.month_start, e.data_assunzione)) / (365.25*86400)) FILTER (
        WHERE e.data_assunzione <= (m.month_start + interval '1 month' - interval '1 day')
          AND (e.data_cessazione IS NULL OR e.data_cessazione > (m.month_start + interval '1 month' - interval '1 day'))
      ), 1)::float8 AS avg_seniority_years
    FROM months m
    CROSS JOIN hr_employee e
    GROUP BY m.month_start
    ORDER BY m.month_start
  `;
  return c.json(rows);
});

// ─── Evoluzione struttura organizzativa: numero reparti/capi nel tempo ────────

hrAnalyticsRoutes.get('/evolution/departments', requireModule('hr'), async (c) => {
  const { start, count } = await monthRange(k => c.req.query(k));

  const rows = await db`
    WITH months AS (
      SELECT date_trunc('month', ${start}::date::timestamptz) + (n || ' months')::interval AS month_start
      FROM generate_series(0, ${count - 1}) n
    )
    SELECT
      m.month_start::date AS month,
      COALESCE(NULLIF(TRIM(e.funzione_aziendale), ''), 'Senza funzione') AS funzione_name,
      COUNT(*)::int AS count
    FROM months m
    CROSS JOIN hr_employee e
    WHERE e.data_assunzione <= (m.month_start + interval '1 month' - interval '1 day')
      AND (e.data_cessazione IS NULL OR e.data_cessazione > (m.month_start + interval '1 month' - interval '1 day'))
    GROUP BY m.month_start, funzione_name
    ORDER BY m.month_start
  `;
  return c.json(rows);
});
