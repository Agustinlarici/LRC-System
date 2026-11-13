-- ============================================================
-- LRC-System — HR: taglia campera (vestiario)
-- ============================================================
-- Colonna nullable: il codice precedente continua a funzionare con lo schema nuovo.

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS taglia_campera VARCHAR(20);
