-- ============================================================
-- LRC-System — Force password change on first login
-- Safe to re-run: ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
