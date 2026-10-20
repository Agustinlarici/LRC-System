-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- WebDDT: tracking downloads spedizioni Ferrari
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'webddt';

CREATE TABLE IF NOT EXISTS webddt_downloads (
  shipment_id   TEXT        PRIMARY KEY,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  downloaded_by TEXT
);
