-- ============================================================
-- LRC-System — HR: anzianità dai contratti
-- Vista con i giorni di servizio di ogni dipendente, sommando TUTTI i suoi contratti
-- (STR, interinali, esterni): la scheda, la lista dipendenti e l'analisi HR leggono da qui.
--  - un giorno coperto da più contratti si conta una volta sola (intervalli uniti)
--  - i periodi tra un contratto e l'altro non contano
--  - un contratto senza fine, o con fine futura, conta fino a oggi; per chi è cessato, fino alla cessazione
--  - contratto senza tipo = interinale (come nella tabella dei contratti)
--  - chi non ha contratti registrati: dalla data di assunzione a oggi (o alla cessazione)
-- Giorni inclusivi (primo e ultimo giorno contati), come la colonna «Giorni» della scheda.
-- Solo una vista nuova: il codice vecchio non la usa, il rollback non ne risente.
-- ============================================================

CREATE OR REPLACE VIEW hr_employee_anzianita AS
WITH iv AS (
  SELECT c.employee_id,
         COALESCE(c.tipo, 'INTERINALE') AS tipo,
         c.data_inizio AS s,
         LEAST(COALESCE(c.data_fine, CASE WHEN e.stato = 'cessato' THEN e.data_cessazione END, CURRENT_DATE), CURRENT_DATE) AS f
  FROM hr_employee_contract c
  JOIN hr_employee e ON e.id = c.employee_id
),
-- Giorni nuovi portati da ogni contratto rispetto a quelli già coperti dai precedenti (ordinati per inizio)
tot AS (
  SELECT employee_id,
         GREATEST(0, f - GREATEST(s - 1, COALESCE(MAX(f) OVER (PARTITION BY employee_id ORDER BY s, f ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), s - 1))) AS n
  FROM iv WHERE f >= s
),
per_tipo AS (
  SELECT employee_id, tipo,
         GREATEST(0, f - GREATEST(s - 1, COALESCE(MAX(f) OVER (PARTITION BY employee_id, tipo ORDER BY s, f ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), s - 1))) AS n
  FROM iv WHERE f >= s
),
somma AS (SELECT employee_id, SUM(n)::int AS giorni FROM tot GROUP BY employee_id),
somma_tipo AS (
  SELECT employee_id,
         COALESCE(SUM(n) FILTER (WHERE tipo = 'STR'), 0)::int        AS giorni_str,
         COALESCE(SUM(n) FILTER (WHERE tipo = 'INTERINALE'), 0)::int AS giorni_interinale,
         COALESCE(SUM(n) FILTER (WHERE tipo = 'ESTERNO'), 0)::int    AS giorni_esterno
  FROM per_tipo GROUP BY employee_id
)
SELECT e.id AS employee_id,
       COALESCE(s.giorni, GREATEST(0, LEAST(COALESCE(e.data_cessazione, CURRENT_DATE), CURRENT_DATE) - e.data_assunzione + 1))::int AS giorni_totale,
       COALESCE(t.giorni_str, 0)        AS giorni_str,
       COALESCE(t.giorni_interinale, 0) AS giorni_interinale,
       COALESCE(t.giorni_esterno, 0)    AS giorni_esterno
FROM hr_employee e
LEFT JOIN somma s ON s.employee_id = e.id
LEFT JOIN somma_tipo t ON t.employee_id = e.id;
