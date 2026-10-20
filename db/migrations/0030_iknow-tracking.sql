-- ============================================================
-- iKnow Tracked Fasi / Modelli / Componenti
-- Three independent lists whose cross product defines all
-- (fase, modello, componente) combinations to track from
-- iKnow/WebThron independently of monitor and buffer config.
-- Used as a third UNION source in getActiveLineeWithCombos().
-- ============================================================

CREATE TABLE IF NOT EXISTS iknow_tracked_fasi (
  id         SERIAL       PRIMARY KEY,
  fase       VARCHAR(200) NOT NULL UNIQUE,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iknow_tracked_modelli (
  id         SERIAL       PRIMARY KEY,
  modello    VARCHAR(200) NOT NULL UNIQUE,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iknow_tracked_componenti (
  id         SERIAL       PRIMARY KEY,
  componente VARCHAR(200) NOT NULL UNIQUE,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
