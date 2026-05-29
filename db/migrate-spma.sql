-- ============================================================
-- LRC-System — SPMA Module Migration
-- Sequencing & Planning for Manufacturing Assembly
-- Safe to re-run: no DROP statements, all IF NOT EXISTS
-- ============================================================

-- ── ENUM ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'spma_plan_status') THEN
    CREATE TYPE spma_plan_status AS ENUM ('PENDING','PICKED','CONFIRMED','SENT','SKIPPED');
  END IF;
END$$;

ALTER TYPE spma_plan_status ADD VALUE IF NOT EXISTS 'NA';

-- ── TABLES ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spma_line (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS spma_line_alias (
  id         SERIAL PRIMARY KEY,
  alias      VARCHAR(200) NOT NULL,
  alias_norm VARCHAR(200) NOT NULL,
  line_id    INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (alias_norm)
);

CREATE TABLE IF NOT EXISTS spma_line_calendar (
  id         SERIAL PRIMARY KEY,
  line_id    INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  work_date  DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  UNIQUE (line_id, work_date, start_time)
);

CREATE TABLE IF NOT EXISTS spma_commessa (
  id             SERIAL PRIMARY KEY,
  commessa_code  VARCHAR(100) NOT NULL,
  model_code     VARCHAR(100) NOT NULL DEFAULT '-',
  line_id        INTEGER REFERENCES spma_line(id) ON DELETE SET NULL,
  line_entry_ts  TIMESTAMPTZ,
  pos_index      INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commessa_code)
);

CREATE INDEX IF NOT EXISTS spma_commessa_line_entry_idx ON spma_commessa (line_id, line_entry_ts);

CREATE TABLE IF NOT EXISTS spma_component_category (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS spma_model_component_req (
  id                    SERIAL PRIMARY KEY,
  model_code            VARCHAR(100) NOT NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  producer_name         VARCHAR(200),
  UNIQUE (model_code, component_category_id)
);

CREATE TABLE IF NOT EXISTS spma_line_component_station (
  id                    SERIAL PRIMARY KEY,
  line_id               INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  station_index         INTEGER NOT NULL,
  UNIQUE (line_id, component_category_id)
);

CREATE TABLE IF NOT EXISTS spma_plan (
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

CREATE INDEX IF NOT EXISTS spma_plan_status_idx  ON spma_plan (status);
CREATE INDEX IF NOT EXISTS spma_plan_planned_idx ON spma_plan (planned_ts);

CREATE TABLE IF NOT EXISTS spma_componente_map (
  id                    SERIAL PRIMARY KEY,
  componente_iknow      VARCHAR(200) NOT NULL,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (componente_iknow, component_category_id)
);

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
