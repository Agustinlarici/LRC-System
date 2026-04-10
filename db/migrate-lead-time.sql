-- ============================================================
-- LRC-System — Lead Time Dashboard Migration
-- Run with: psql -U <user> -d <db> -f migrate-lead-time.sql
-- Safe to re-run: all statements use IF NOT EXISTS
-- ============================================================

-- Permanent store of all WebThron production events.
-- Mirror of webthron_prod_cache but never deleted.
-- The sync writes to both tables; this one accumulates history.
CREATE TABLE IF NOT EXISTS webthron_events_history (
  id               SERIAL       PRIMARY KEY,
  fase             VARCHAR(200) NOT NULL,
  modello          VARCHAR(200) NOT NULL,
  componente       VARCHAR(200) NOT NULL,
  cod_seriale      VARCHAR(200) NOT NULL,
  commessa         VARCHAR(200),
  esito_delibera   VARCHAR(200),
  data_inserimento TIMESTAMPTZ  NOT NULL,
  data_cache       DATE         NOT NULL
);

-- Add commessa to existing tables (safe on re-run)
ALTER TABLE webthron_events_history ADD COLUMN IF NOT EXISTS commessa VARCHAR(200);

-- Same dedup key as webthron_prod_cache
CREATE UNIQUE INDEX IF NOT EXISTS idx_weh_dedup
  ON webthron_events_history (fase, cod_seriale, data_inserimento);

-- Fast lookup by date (for production-day checks)
CREATE INDEX IF NOT EXISTS idx_weh_data_cache
  ON webthron_events_history (data_cache);

-- Fast lookup by commessa + fase (core lead-time query)
CREATE INDEX IF NOT EXISTS idx_weh_seriale_fase
  ON webthron_events_history (cod_seriale, fase);

-- Fast lookup by fase + componente (for filtering)
CREATE INDEX IF NOT EXISTS idx_weh_fase_componente
  ON webthron_events_history (fase, componente);

-- ============================================================
-- Mapping: iKnow componente name ↔ SPMA component category
-- Used to:
--   1. Filter webthron_events_history by SPMA category
--   2. Link SPMA planned_ts to webthron componente when fase = 'SPMA_PIANO'
-- ============================================================
CREATE TABLE IF NOT EXISTS spma_componente_map (
  id                    SERIAL       PRIMARY KEY,
  componente_iknow      VARCHAR(200) NOT NULL,
  component_category_id INTEGER      NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  active                BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (componente_iknow, component_category_id)
);

CREATE INDEX IF NOT EXISTS idx_scm_cat
  ON spma_componente_map (component_category_id) WHERE active = TRUE;

-- ============================================================
-- Backfill history from existing cache (run once on first deploy)
-- ============================================================
INSERT INTO webthron_events_history
  (fase, modello, componente, cod_seriale, esito_delibera, data_inserimento, data_cache)
SELECT fase, modello, componente, cod_seriale, esito_delibera, data_inserimento, data_cache
FROM webthron_prod_cache
ON CONFLICT (fase, cod_seriale, data_inserimento) DO NOTHING;

-- ============================================================
-- Lead Time Zones: configurable colour bands per (category, fase_a, fase_b)
-- verde_max:    hours_net ≤ verde_max           → green zone
-- amarillo_max: verde_max < hours_net ≤ amarillo_max → yellow zone
--               hours_net > amarillo_max         → red zone
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_time_zones (
  id            SERIAL      PRIMARY KEY,
  category_id   INTEGER     NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  fase_a        VARCHAR(200) NOT NULL,
  fase_b        VARCHAR(200) NOT NULL,
  verde_max     NUMERIC(8,2) NOT NULL,
  amarillo_max  NUMERIC(8,2) NOT NULL,
  direction     VARCHAR(20)  NOT NULL DEFAULT 'higher_worse',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, fase_a, fase_b)
);
ALTER TABLE lead_time_zones ADD COLUMN IF NOT EXISTS direction VARCHAR(20) NOT NULL DEFAULT 'higher_worse';
