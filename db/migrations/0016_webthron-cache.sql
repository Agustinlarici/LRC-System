-- PostgreSQL cache for WebThron production events.
-- Populated incrementally every 5 min — only new rows fetched from WebThron.
-- Eliminates long read locks on WebThron's MyISAM tables.

CREATE TABLE IF NOT EXISTS webthron_prod_cache (
  id               SERIAL       PRIMARY KEY,
  fase             VARCHAR(200) NOT NULL,
  modello          VARCHAR(200) NOT NULL,
  componente       VARCHAR(200) NOT NULL,
  cod_seriale      VARCHAR(200) NOT NULL,
  esito_delibera   VARCHAR(200),
  data_inserimento TIMESTAMPTZ  NOT NULL,
  data_cache       DATE         NOT NULL   -- production day (Italian time)
);

-- Dedup: same document can't appear twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_wpc_dedup
  ON webthron_prod_cache (fase, cod_seriale, data_inserimento);

-- Fast queries by production day
CREATE INDEX IF NOT EXISTS idx_wpc_data_cache
  ON webthron_prod_cache (data_cache);

-- Fast filter by line combo
CREATE INDEX IF NOT EXISTS idx_wpc_fase_combo
  ON webthron_prod_cache (fase, modello, componente);
