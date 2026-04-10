-- ============================================================
-- LRC-System — SPMA Module Migration
-- Sequencing & Planning for Manufacturing Assembly
-- Run with: psql -U <user> -d <db> -f migrate-spma.sql
-- Safe to re-run: all statements use IF NOT EXISTS
-- ============================================================

-- ============================================================
-- ENUM (already in schema.sql, guard with DO block)
-- ============================================================

-- Drop existing enum if it exists with wrong values
DROP TYPE IF EXISTS spma_plan_status CASCADE;

-- Create the enum
CREATE TYPE spma_plan_status AS ENUM ('PENDING','PICKED','CONFIRMED','SENT','SKIPPED');

-- ============================================================
-- TABLES
-- ============================================================

-- Clean up any existing tables
DROP TABLE IF EXISTS spma_plan CASCADE;
DROP TABLE IF EXISTS spma_line_component_station CASCADE;
DROP TABLE IF EXISTS spma_model_component_req CASCADE;
DROP TABLE IF EXISTS spma_component_category CASCADE;
DROP TABLE IF EXISTS spma_commessa CASCADE;
DROP TABLE IF EXISTS spma_line_calendar CASCADE;
DROP TABLE IF EXISTS spma_line_alias CASCADE;
DROP TABLE IF EXISTS spma_line CASCADE;

-- Production lines (e.g. "Linea 1", "Linea Alfa")
CREATE TABLE spma_line (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  UNIQUE (name)
);

-- Aliases for matching Excel sheet names to lines
CREATE TABLE spma_line_alias (
  id         SERIAL PRIMARY KEY,
  alias      VARCHAR(200) NOT NULL,
  alias_norm VARCHAR(200) NOT NULL,
  line_id    INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (alias_norm)
);

-- Work-shift calendar per line (optional, for future calendar alignment)
CREATE TABLE spma_line_calendar (
  id         SERIAL PRIMARY KEY,
  line_id    INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  work_date  DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  UNIQUE (line_id, work_date, start_time)
);

-- Vehicles in the customer production sequence
CREATE TABLE spma_commessa (
  id             SERIAL PRIMARY KEY,
  commessa_code  VARCHAR(100) NOT NULL,
  model_code     VARCHAR(100) NOT NULL DEFAULT '-',
  line_id        INTEGER REFERENCES spma_line(id) ON DELETE SET NULL,
  line_entry_ts  TIMESTAMPTZ,
  pos_index      INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commessa_code)
);

CREATE INDEX spma_commessa_line_entry_idx ON spma_commessa (line_id, line_entry_ts);

-- Component categories (types of parts we supply, e.g. "Paraurti Anteriore")
CREATE TABLE spma_component_category (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name)
);

-- Which model needs which component categories
CREATE TABLE spma_model_component_req (
  id                    SERIAL PRIMARY KEY,
  model_code            VARCHAR(100) NOT NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  producer_name         VARCHAR(200),
  UNIQUE (model_code, component_category_id)
);

-- At which station each component is assembled on each line
-- station_index = N means: take the Nth next vehicle's entry_ts as planned_ts
CREATE TABLE spma_line_component_station (
  id                    SERIAL PRIMARY KEY,
  line_id               INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  station_index         INTEGER NOT NULL,
  UNIQUE (line_id, component_category_id)
);

-- Calculated delivery plan: when to prepare/send each component for each vehicle
CREATE TABLE spma_plan (
  id                    SERIAL PRIMARY KEY,
  commessa_id           INTEGER NOT NULL REFERENCES spma_commessa(id) ON DELETE CASCADE,
  commessa_code         VARCHAR(100) NOT NULL,
  model_code            VARCHAR(100),
  line_id               INTEGER REFERENCES spma_line(id) ON DELETE SET NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  planned_ts            TIMESTAMPTZ,
  status                spma_plan_status NOT NULL DEFAULT 'PENDING',
  picked_at             TIMESTAMPTZ,
  confirmed_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  confirmed_item_code   VARCHAR(100),
  batch_id              BIGINT,
  generated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (commessa_id, component_category_id)
);

CREATE INDEX spma_plan_status_idx  ON spma_plan (status);
CREATE INDEX spma_plan_planned_idx ON spma_plan (planned_ts);

-- Mapping componente iKnow → SPMA category (optional, for future integration)
CREATE TABLE IF NOT EXISTS spma_componente_map (
  id                    SERIAL PRIMARY KEY,
  componente_iknow      VARCHAR(200) NOT NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (componente_iknow, component_category_id)
);

-- Import history log
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
