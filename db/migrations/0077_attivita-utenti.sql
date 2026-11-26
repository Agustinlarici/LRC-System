-- Analytics di utilizzo (pannello /admin/attivita, solo admin):
-- una riga per ogni pagina aperta + presenza (ultimo segnale) di ogni utente.
CREATE TABLE IF NOT EXISTS page_views (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  path       TEXT        NOT NULL,
  module     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at DESC);
CREATE INDEX IF NOT EXISTS page_views_user_idx       ON page_views (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS page_views_module_idx     ON page_views (module, created_at DESC);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_path TEXT        NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
