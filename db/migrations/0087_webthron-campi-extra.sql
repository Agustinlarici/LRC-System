-- ============================================================
-- WebThron: campi extra nello storico eventi
-- Colonne nuove, tutte nullable (il codice vecchio regge lo schema nuovo):
--   versione          campo iKnow 44  (lato DX/SX e versione del componente)
--   operatore         campo iKnow 21
--   colore            campo iKnow 28
--   protocollo_cesta  campo iKnow 554
-- Le righe già presenti restano NULL finché la rilettura notturna / il backfill del giorno non le riempie.
-- ============================================================

ALTER TABLE webthron_events_history ADD COLUMN IF NOT EXISTS versione         VARCHAR(200);
ALTER TABLE webthron_events_history ADD COLUMN IF NOT EXISTS operatore        VARCHAR(200);
ALTER TABLE webthron_events_history ADD COLUMN IF NOT EXISTS colore           VARCHAR(200);
ALTER TABLE webthron_events_history ADD COLUMN IF NOT EXISTS protocollo_cesta VARCHAR(200);
