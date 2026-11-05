-- ============================================================
-- LRC-System — HR: richieste di ferie/permessi
-- Il capo (o HR) richiede per sé o per il proprio team; HR approva o rifiuta.
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_request (
  id                   SERIAL PRIMARY KEY,
  employee_id          INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  tipo                 VARCHAR(20) NOT NULL CHECK (tipo IN ('ferie', 'permesso')),
  data_inizio          DATE NOT NULL,
  data_fine            DATE NOT NULL,
  motivo               TEXT,
  stato                VARCHAR(20) NOT NULL DEFAULT 'in_attesa'
                       CHECK (stato IN ('in_attesa', 'approvata', 'rifiutata', 'annullata')),
  decided_by_user_id   INTEGER REFERENCES users(id),
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fine >= data_inizio)
);

CREATE INDEX IF NOT EXISTS idx_hr_request_employee ON hr_request(employee_id, data_inizio DESC);
CREATE INDEX IF NOT EXISTS idx_hr_request_stato    ON hr_request(stato, created_at DESC);
