-- ─────────────────────────────────────────────────────────────────────────────
-- Alert history — incidents raised by the alert manager
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_alerts (
  id               SERIAL        PRIMARY KEY,
  alert_key        VARCHAR(100)  NOT NULL,
  severity         VARCHAR(20)   NOT NULL DEFAULT 'warning',
  title            VARCHAR(200)  NOT NULL,
  message          TEXT,
  resolved_at      TIMESTAMPTZ,
  resolved_message TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_key      ON system_alerts (alert_key);
CREATE INDEX IF NOT EXISTS idx_system_alerts_created  ON system_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_open     ON system_alerts (created_at DESC) WHERE resolved_at IS NULL;
