-- ============================================================
-- LRC-System — HR: malattia/infortunio come richieste + proposte di modifica scheda
-- Il capo propone, HR decide (campo per campo per le modifiche).
-- ============================================================

-- Le richieste possono essere anche di malattia e infortunio.
ALTER TABLE hr_request DROP CONSTRAINT IF EXISTS hr_request_tipo_check;
ALTER TABLE hr_request ADD CONSTRAINT hr_request_tipo_check
  CHECK (tipo IN ('ferie', 'permesso', 'malattia', 'infortunio'));

-- Proposta di modifica della scheda di un dipendente.
CREATE TABLE IF NOT EXISTS hr_change_request (
  id                   SERIAL PRIMARY KEY,
  employee_id          INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  motivo               TEXT,
  stato                VARCHAR(20) NOT NULL DEFAULT 'in_attesa'
                       CHECK (stato IN ('in_attesa', 'decisa', 'annullata')),
  decided_by_user_id   INTEGER REFERENCES users(id),
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_change_request_stato ON hr_change_request(stato, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_change_request_employee ON hr_change_request(employee_id);

-- Un campo proposto = una riga: HR approva o rifiuta ogni campo separatamente.
CREATE TABLE IF NOT EXISTS hr_change_request_item (
  id                SERIAL PRIMARY KEY,
  request_id        INTEGER NOT NULL REFERENCES hr_change_request(id) ON DELETE CASCADE,
  campo             VARCHAR(50) NOT NULL,
  valore_attuale    TEXT,   -- valore al momento della proposta (per reparto_id: l'id)
  valore_proposto   TEXT,
  label_attuale     TEXT,   -- testo leggibile (per reparto_id: il nome del reparto)
  label_proposto    TEXT,
  stato             VARCHAR(20) NOT NULL DEFAULT 'in_attesa'
                    CHECK (stato IN ('in_attesa', 'approvato', 'rifiutato'))
);
CREATE INDEX IF NOT EXISTS idx_hr_change_request_item_req ON hr_change_request_item(request_id);
