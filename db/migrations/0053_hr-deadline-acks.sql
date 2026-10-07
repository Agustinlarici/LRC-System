-- ============================================================
-- LRC-System — HR: presa in carico delle scadenze (preso in carico)
-- Run AFTER migrate-hr.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS
-- ============================================================

-- Una riga per dipendente: lo stato vale solo finché data_cessazione coincide con
-- quella a cui si riferiva — se la data cambia (proroga) la scadenza torna "da vedere".
CREATE TABLE IF NOT EXISTS hr_deadline_ack (
  employee_id       INTEGER PRIMARY KEY REFERENCES hr_employee(id) ON DELETE CASCADE,
  data_cessazione   DATE NOT NULL,
  status            VARCHAR(20) NOT NULL CHECK (status IN ('preso_in_carico')),
  user_id           INTEGER,
  user_name         VARCHAR(150),
  acted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
