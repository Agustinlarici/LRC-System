-- ============================================================
-- LRC-System — HR: vestiario (taglie) e nome Osti
-- ============================================================
-- Nome Osti = nome del dipendente così come compare nel sistema Osti, serve a
-- ritrovarlo negli import. Tutte colonne nullable: il codice precedente continua
-- a funzionare con lo schema nuovo (rollback sicuro).

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS nome_osti         VARCHAR(200);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS taglia_pantaloni  VARCHAR(20);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS taglia_maglia     VARCHAR(20);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS taglia_scarpe     VARCHAR(20);
