-- ============================================================
-- LRC-System — SPMA Alerts Migration
-- Phase sequences, calendar defaults, alert thresholds
-- Run: psql -U <user> -d <db> -f migrate-spma-alerts.sql
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT
-- ============================================================

-- ── Calendar defaults: shift hours per day of week ───────────────────────────

CREATE TABLE IF NOT EXISTS spma_calendar_defaults (
  id          SERIAL PRIMARY KEY,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  shift_start TIME,
  shift_end   TIME,
  is_working  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (day_of_week)
);

-- Seed Italian factory defaults (Mon-Fri 06-22, Sat 06-14, Sun off)
INSERT INTO spma_calendar_defaults (day_of_week, shift_start, shift_end, is_working) VALUES
  (0, NULL,    NULL,    FALSE),
  (1, '06:00', '22:00', TRUE),
  (2, '06:00', '22:00', TRUE),
  (3, '06:00', '22:00', TRUE),
  (4, '06:00', '22:00', TRUE),
  (5, '06:00', '22:00', TRUE),
  (6, '06:00', '14:00', TRUE)
ON CONFLICT (day_of_week) DO NOTHING;

-- ── Update spma_line_calendar: one block per day + auto_generated flag ────────

ALTER TABLE spma_line_calendar
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT TRUE;

-- Replace 3-column unique with 2-column (one working block per day)
ALTER TABLE spma_line_calendar
  DROP CONSTRAINT IF EXISTS spma_line_calendar_line_id_work_date_start_time_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'spma_line_calendar_line_id_work_date_key'
  ) THEN
    ALTER TABLE spma_line_calendar
      ADD CONSTRAINT spma_line_calendar_line_id_work_date_key UNIQUE (line_id, work_date);
  END IF;
END;
$$;

-- ── Phase sequence per component category ────────────────────────────────────

CREATE TABLE IF NOT EXISTS spma_fase_sequence (
  id                    SERIAL PRIMARY KEY,
  component_category_id INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
  order_index           SMALLINT NOT NULL,
  fase_name             VARCHAR(200) NOT NULL,
  duration_minutes      INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  UNIQUE (component_category_id, order_index),
  UNIQUE (component_category_id, fase_name)
);

CREATE INDEX IF NOT EXISTS spma_fase_seq_cat_idx
  ON spma_fase_sequence (component_category_id, order_index);

-- ── Alert thresholds (singleton row) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spma_alert_config (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  warning_pct  SMALLINT NOT NULL DEFAULT 15 CHECK (warning_pct BETWEEN 1 AND 99),
  critical_pct SMALLINT NOT NULL DEFAULT 30 CHECK (critical_pct BETWEEN 1 AND 100)
);

INSERT INTO spma_alert_config (id, warning_pct, critical_pct)
VALUES (1, 15, 30)
ON CONFLICT (id) DO NOTHING;
