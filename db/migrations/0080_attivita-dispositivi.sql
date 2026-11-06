-- Analytics di utilizzo: distingue i dispositivi (kiosk/tablet senza password) dagli utenti.
-- Più dispositivi possono condividere lo stesso utente, quindi la presenza è per (utente, dispositivo).
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS device_id INTEGER REFERENCES device_tokens(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS page_views_device_idx ON page_views (device_id, created_at DESC);

ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS device_id INTEGER REFERENCES device_tokens(id) ON DELETE CASCADE;
ALTER TABLE user_presence DROP CONSTRAINT IF EXISTS user_presence_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS user_presence_user_device_uq ON user_presence (user_id, (coalesce(device_id, 0)));
