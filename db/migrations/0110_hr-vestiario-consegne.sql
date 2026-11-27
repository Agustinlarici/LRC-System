-- ============================================================
-- LRC-System — HR: consegna del vestiario (data per dipendente)
-- ============================================================
-- Una riga = al dipendente è stato consegnato il vestiario in quella data.
-- Nessuna riga = non ancora consegnato. Solo tabella nuova: il codice vecchio non la usa.

CREATE TABLE IF NOT EXISTS hr_vestiario_consegna (
  employee_id  INTEGER     PRIMARY KEY REFERENCES hr_employee(id) ON DELETE CASCADE,
  consegnato_il DATE       NOT NULL,
  updated_by   VARCHAR(100),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
