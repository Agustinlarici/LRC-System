-- System configuration key-value store
CREATE TABLE IF NOT EXISTS system_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Default iKnow (WebThron) flags — all enabled by default
INSERT INTO system_config (key, value) VALUES
  ('iknow_enabled',        'true'),
  ('iknow_andon_enabled',  'true'),
  ('iknow_buffer_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
