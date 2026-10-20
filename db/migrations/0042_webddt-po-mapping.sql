-- WebDDT: tabella codice articolo → PO number, usata quando la riga non ha commessa
CREATE TABLE IF NOT EXISTS webddt_po_mapping (
  id           SERIAL       PRIMARY KEY,
  article_code VARCHAR(50)  NOT NULL UNIQUE,
  po_number    VARCHAR(20)  NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
