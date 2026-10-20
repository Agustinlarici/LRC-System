-- ============================================================
-- LRC-System — HR: più responsabili per dipendente
-- Run AFTER migrate-hr.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS
-- ============================================================

-- Un dipendente può avere più responsabili contemporaneamente (es. due persone che
-- co-guidano lo stesso team). hr_employee.capo_id resta come "responsabile principale"
-- (il primo della lista, usato per compatibilità dove serve un solo valore — es.
-- posizionamento nell'organigramma quando i responsabili non guidano lo stesso identico team).
CREATE TABLE IF NOT EXISTS hr_employee_capo (
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  capo_id     INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, capo_id)
);
CREATE INDEX IF NOT EXISTS idx_hr_employee_capo_capo ON hr_employee_capo(capo_id);

-- Backfill una tantum: chi aveva già un responsabile singolo lo ritrova qui.
INSERT INTO hr_employee_capo (employee_id, capo_id)
SELECT id, capo_id FROM hr_employee WHERE capo_id IS NOT NULL
ON CONFLICT DO NOTHING;
