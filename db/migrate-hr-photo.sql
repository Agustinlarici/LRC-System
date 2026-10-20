-- ============================================================
-- LRC-System — HR: foto dei dipendenti
-- Run AFTER migrate-hr.sql
-- Safe to re-run
-- La foto sta nel DB (bytea) come i documenti HR: il frontend la riduce a ~400px
-- prima dell'upload, quindi pesa poche decine di KB.
-- ============================================================
CREATE TABLE IF NOT EXISTS hr_employee_photo (
  employee_id  INTEGER PRIMARY KEY REFERENCES hr_employee(id) ON DELETE CASCADE,
  mime         VARCHAR(50) NOT NULL,
  data         BYTEA NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
