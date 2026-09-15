-- ============================================================
-- LRC-System — Device pairing (auth-less kiosk devices)
-- Run AFTER migrate-auth.sql
-- Safe to re-run: IF NOT EXISTS
-- ============================================================

-- ─── Paired devices: long-lived tokens bound to one user ──────────────────────
CREATE TABLE IF NOT EXISTS device_tokens (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  label         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- ─── Short-lived pairing codes: shown/entered once to link a device ────────────
CREATE TABLE IF NOT EXISTS device_pairing_codes (
  code        TEXT        PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
