-- HR: altri campi dell'anagrafica che arrivano dal database Osti (dip_*).
-- Tutte colonne nullable: il codice precedente continua a funzionare con lo schema nuovo.

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS badge                VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS transponder          VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS terminale            VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS qualifica            VARCHAR(100);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS indeterminato        BOOLEAN;
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS indeterminato_data   DATE;
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS part_time            VARCHAR(30);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS luogo_nascita        VARCHAR(150);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS domicilio_indirizzo  VARCHAR(255);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS domicilio_citta      VARCHAR(100);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS domicilio_provincia  VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS domicilio_cap        VARCHAR(10);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS titolo_studio        VARCHAR(100);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS stato_civile         VARCHAR(50);
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS note_hr              TEXT;
