-- ============================================================
-- LRC-System — SPMA email alert configuration
-- Safe to re-run
-- ============================================================

ALTER TABLE spma_alert_config
  ADD COLUMN IF NOT EXISTS smtp_host   TEXT,
  ADD COLUMN IF NOT EXISTS smtp_port   INTEGER DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS smtp_user   TEXT,
  ADD COLUMN IF NOT EXISTS smtp_pass   TEXT,
  ADD COLUMN IF NOT EXISTS smtp_from   TEXT,
  ADD COLUMN IF NOT EXISTS smtp_to     TEXT;
