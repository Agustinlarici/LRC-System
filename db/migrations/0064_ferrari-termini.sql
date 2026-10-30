-- Schede Ferrari: sigle o parole da cercare per ogni modello (colonne della tabella commesse).
CREATE TABLE IF NOT EXISTS ferrari_termine (
  modello    TEXT        NOT NULL,
  termine    TEXT        NOT NULL,
  ordine     INTEGER     NOT NULL,
  creato_da  TEXT,
  creato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modello, termine)
);
