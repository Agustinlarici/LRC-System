CREATE TABLE IF NOT EXISTS spma_onedrive_processed (
  id            SERIAL      PRIMARY KEY,
  file_id       TEXT        NOT NULL UNIQUE,
  file_name     TEXT        NOT NULL,
  last_modified TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
