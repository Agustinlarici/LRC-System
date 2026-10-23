-- Spedizione Bucci: la scansione salva solo il codice letto; il seriale viene risolto da iKnow
-- in blocco alla chiusura (seriale NULL = cofano non ancora verificato)
ALTER TABLE bucci_shipment_item ALTER COLUMN seriale DROP NOT NULL;
