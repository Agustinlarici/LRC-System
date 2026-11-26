-- ============================================================
-- LRC-System — HR: contratti dei dipendenti (interinali)
-- Un dipendente interinale può avere molti contratti successivi,
-- ognuno con data di inizio e di fine. Si importa in massa da CSV
-- (Dipendenti → Altro → Import massivo contratti interinali).
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_employee_contract (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  matricola    VARCHAR(30),          -- matricola del contratto (cambia a ogni nuovo contratto)
  qualifica    VARCHAR(100),
  data_inizio  DATE NOT NULL,
  data_fine    DATE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stesso dipendente + stesse date = stesso contratto (anche con fine aperta)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_contract_periodo
  ON hr_employee_contract (employee_id, data_inizio, (COALESCE(data_fine, 'infinity'::date)));

CREATE INDEX IF NOT EXISTS idx_hr_contract_employee ON hr_employee_contract(employee_id, data_inizio DESC);
