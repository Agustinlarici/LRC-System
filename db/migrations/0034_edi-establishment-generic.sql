-- Rimuove il CHECK constraint Ferrari-specifico su csg_establishment_code
-- e allarga la colonna per supportare Odette ID (Audi/VW) e altri formati

ALTER TABLE edi_clients
  DROP CONSTRAINT IF EXISTS edi_clients_csg_establishment_code_check;

ALTER TABLE edi_clients
  ALTER COLUMN csg_establishment_code TYPE VARCHAR(20),
  ALTER COLUMN csg_establishment_code SET DEFAULT '';
