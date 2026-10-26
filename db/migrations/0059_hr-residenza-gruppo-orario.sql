-- ============================================================
-- LRC-System — HR: residenza completa e gruppo orario
-- ============================================================
-- Si affiancano a "indirizzo" (già presente). Tutte colonne nullable: il codice
-- precedente continua a funzionare con lo schema nuovo (rollback sicuro).

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS citta         VARCHAR(100);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS provincia     VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS cap           VARCHAR(10);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS gruppo_orario VARCHAR(100);
