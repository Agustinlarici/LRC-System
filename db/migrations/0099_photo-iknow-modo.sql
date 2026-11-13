-- Photo Station: da dove arrivano gli ordini di iKnow. Un solo interruttore, mai due fonti insieme:
--   off = nessuna (gli ordini manuali dalla pagina funzionano sempre)
--   db  = copia del database di iKnow (provvisorio)
--   api = chiamata POST /api/delibere/accettate
ALTER TABLE photo_feed_config ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE photo_feed_config DROP CONSTRAINT IF EXISTS photo_feed_config_mode_check;
ALTER TABLE photo_feed_config ADD CONSTRAINT photo_feed_config_mode_check CHECK (mode IN ('off', 'db', 'api'));
UPDATE photo_feed_config SET mode = 'db' WHERE enabled AND mode = 'off';
