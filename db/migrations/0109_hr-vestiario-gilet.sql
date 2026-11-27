-- ============================================================
-- LRC-System — HR: vestiario, gilet sì/no per dipendente
-- ============================================================
-- Chi ha il gilet = true non rientra nella somma degli altri capi da ordinare.
-- Colonna nuova con default: il codice precedente continua a funzionare (rollback sicuro).

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS gilet BOOLEAN NOT NULL DEFAULT FALSE;
