-- Add import history log table to SPMA module
-- Safe to re-run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS spma_import_log (
  id             SERIAL PRIMARY KEY,
  file_name      VARCHAR(500) NOT NULL,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_rows     INTEGER NOT NULL DEFAULT 0,
  upserts        INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  deleted_stale  INTEGER NOT NULL DEFAULT 0,
  sheets         TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS spma_componente_map (
  id                    SERIAL PRIMARY KEY,
  componente_iknow      VARCHAR(200) NOT NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (componente_iknow, component_category_id)
);
