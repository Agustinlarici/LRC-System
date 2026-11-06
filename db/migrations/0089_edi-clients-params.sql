-- Parametri specifici per tipo EDI (es. DESADV_AUDI D:20B: DUNS, acquirente, indirizzo di scarico,
-- spedizioniere). Colonna nuova con default: il codice vecchio la ignora.
ALTER TABLE edi_clients
  ADD COLUMN IF NOT EXISTS edi_params JSONB NOT NULL DEFAULT '{}'::jsonb;
