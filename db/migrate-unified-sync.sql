-- ============================================================
-- Unified WebThron sync migration
-- 1. Converts webthron_prod_cache from table → VIEW on history
-- 2. Creates lookup tables for fasi and modello/componente combos
--    (refreshed once per day from WebThron — no on-demand queries)
-- ============================================================

-- Step 1: drop old table, create view backed by history
-- The view is read-only; all writes go to webthron_events_history only.
DROP TABLE IF EXISTS webthron_prod_cache CASCADE;

CREATE OR REPLACE VIEW webthron_prod_cache AS
  SELECT id, fase, modello, componente, cod_seriale, commessa,
         esito_delibera, data_inserimento, data_cache
  FROM webthron_events_history
  WHERE data_cache = CURRENT_DATE;

-- Step 2: lookup table — distinct fasi from WebThron
CREATE TABLE IF NOT EXISTS webthron_lookup_fasi (
  fase       VARCHAR(200) PRIMARY KEY,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Step 3: lookup table — distinct modello/componente combos from WebThron
CREATE TABLE IF NOT EXISTS webthron_lookup_combos (
  modello    VARCHAR(200) NOT NULL,
  componente VARCHAR(200) NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (modello, componente)
);
