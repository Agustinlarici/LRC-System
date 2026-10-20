-- ============================================================
-- LRC-System — SPMA Telegram group chat_id
-- Safe to re-run
-- ============================================================

ALTER TABLE spma_alert_config
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
