-- Schede Ferrari: lettura automatica degli Excel da una cartella (senza IA).
-- La cartella, l'orario e l'on/off stanno in ferrari_config (chiavi cartella_percorso, cartella_auto, cartella_ora).
-- ferrari_cartella_visto: file gia' letti (stesso nome e stessa data di modifica = non si rileggono).
-- ferrari_cartella_run: storico delle letture (automatiche e manuali).
CREATE TABLE IF NOT EXISTS ferrari_cartella_visto (
  nome        TEXT        PRIMARY KEY,
  mtime       TIMESTAMPTZ,
  sha256      TEXT,
  esito       TEXT        NOT NULL,
  commessa    TEXT,
  visto_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ferrari_cartella_run (
  id          BIGSERIAL   PRIMARY KEY,
  tipo        TEXT        NOT NULL CHECK (tipo IN ('auto', 'manuale')),
  utente      TEXT,
  avviato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finito_at   TIMESTAMPTZ,
  trovati     INTEGER     NOT NULL DEFAULT 0,   -- file da leggere (nuovi o cambiati)
  invariati   INTEGER     NOT NULL DEFAULT 0,   -- gia' letti, saltati
  nuovi       INTEGER     NOT NULL DEFAULT 0,
  duplicati   INTEGER     NOT NULL DEFAULT 0,
  quarantena  INTEGER     NOT NULL DEFAULT 0,
  errori      INTEGER     NOT NULL DEFAULT 0,
  dettaglio   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  errore      TEXT
);
CREATE INDEX IF NOT EXISTS ferrari_cartella_run_avviato ON ferrari_cartella_run (avviato_at DESC);
