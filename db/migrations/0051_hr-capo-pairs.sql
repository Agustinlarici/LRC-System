-- ============================================================
-- LRC-System — HR: coppie di co-responsabili per l'organigramma
-- Run AFTER migrate-hr.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS
-- ============================================================

-- Due persone che guidano insieme lo stesso team (co-responsabili): compaiono
-- una accanto all'altra nell'organigramma invece che separate. employee_a_id è
-- sempre il minore dei due id (ordine canonico), per evitare la coppia duplicata al contrario.
CREATE TABLE IF NOT EXISTS hr_capo_pair (
  id             SERIAL PRIMARY KEY,
  employee_a_id  INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  employee_b_id  INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_a_id, employee_b_id)
);
