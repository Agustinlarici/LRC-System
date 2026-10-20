-- Spedizione Bucci: spedizioni di cofani Bucci con seriali scansionati e risolti da iKnow (WebThron)
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'spedizione_bucci';

CREATE TABLE IF NOT EXISTS bucci_shipment (
  id              SERIAL      PRIMARY KEY,
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note            TEXT,
  created_by_id   INTEGER,
  created_by_name TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  closed_by_name  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bucci_shipment_created ON bucci_shipment (created_at DESC);

CREATE TABLE IF NOT EXISTS bucci_shipment_item (
  id              SERIAL      PRIMARY KEY,
  shipment_id     INTEGER     NOT NULL REFERENCES bucci_shipment(id) ON DELETE CASCADE,
  scanned_code    TEXT        NOT NULL,   -- codice letto dallo scanner (seriale o BUCCxxxx)
  seriale         TEXT        NOT NULL,
  componente      TEXT,
  commessa        TEXT,
  scanned_by_name TEXT        NOT NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, seriale)
);

-- Tipo Lotto Primer: campo iKnow 121 del documento di fase primer (tipdoc 0031)
ALTER TABLE bucci_shipment_item ADD COLUMN IF NOT EXISTS tipo_lotto_primer TEXT;

-- Modello: campo iKnow 43 (id → descrizione via ikExtraTab)
ALTER TABLE bucci_shipment_item ADD COLUMN IF NOT EXISTS modello TEXT;

CREATE INDEX IF NOT EXISTS idx_bucci_item_seriale ON bucci_shipment_item (seriale);

-- Ultima modifica (riapertura, aggiunta/rimozione cofani)
ALTER TABLE bucci_shipment ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;
ALTER TABLE bucci_shipment ADD COLUMN IF NOT EXISTS modified_by_name TEXT;

-- Conto Garanzia: flag per cofano, impostato dall'operatore durante la spedizione
ALTER TABLE bucci_shipment_item ADD COLUMN IF NOT EXISTS conto_garanzia BOOLEAN NOT NULL DEFAULT false;
