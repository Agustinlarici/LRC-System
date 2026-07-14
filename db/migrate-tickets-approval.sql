-- ============================================================
-- LRC-System — Ticket approval workflow (per categoria/sottocategoria)
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ADD VALUE IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TYPE ticket_status_enum ADD VALUE IF NOT EXISTS 'in_attesa_approvazione';
ALTER TYPE ticket_action_enum ADD VALUE IF NOT EXISTS 'approvato';

-- ─── Regole di approvazione per categoria/sottocategoria ──────────────────────

CREATE TABLE IF NOT EXISTS ticket_approval_rules (
  id                SERIAL PRIMARY KEY,
  category          VARCHAR(100) NOT NULL,
  subcategory       VARCHAR(100),
  requires_approval BOOLEAN      NOT NULL DEFAULT FALSE,
  UNIQUE (category, subcategory)
);

-- ─── Stato di approvazione sul ticket ──────────────────────────────────────────

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS approved_by        INTEGER REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS approved_by_name   VARCHAR(100);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;
