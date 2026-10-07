-- Monitor Stop Events: categorie, motivi e registrazione fermate di linea

CREATE TABLE IF NOT EXISTS monitor_stop_categories (
  id      SERIAL       PRIMARY KEY,
  nome    VARCHAR(100) NOT NULL,
  colore  VARCHAR(20)  NOT NULL DEFAULT '#6b7280',
  ordine  INT          NOT NULL DEFAULT 0,
  attivo  BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS monitor_stop_reasons (
  id          SERIAL       PRIMARY KEY,
  category_id INT          REFERENCES monitor_stop_categories(id) ON DELETE SET NULL,
  descrizione VARCHAR(200) NOT NULL,
  ordine      INT          NOT NULL DEFAULT 0,
  attivo      BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS monitor_stop_events (
  id            SERIAL      PRIMARY KEY,
  linea_id      INT         NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  reason_id     INT         REFERENCES monitor_stop_reasons(id) ON DELETE SET NULL,
  note          TEXT,
  operatore     VARCHAR(100),
  registrato_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (linea_id, started_at)
);

CREATE INDEX IF NOT EXISTS idx_stop_events_linea_started ON monitor_stop_events(linea_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_events_started       ON monitor_stop_events(started_at DESC);

-- Distingue fermate rilevate automaticamente da gap di produzione vs aperte manualmente dall'operaio
ALTER TABLE monitor_stop_events ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'auto';
UPDATE monitor_stop_events SET source = 'auto' WHERE source IS NULL;
