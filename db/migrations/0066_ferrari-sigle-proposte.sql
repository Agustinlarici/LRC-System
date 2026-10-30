-- Schede Ferrari: proposte sulle sigle arrivate dalla PC IA (non valgono finche' una persona le accetta).
CREATE TABLE IF NOT EXISTS ferrari_sigla_proposta (
  modello    TEXT        NOT NULL,
  codice     TEXT        NOT NULL,
  va         BOOLEAN     NOT NULL,
  nome       TEXT,
  conflitto  BOOLEAN     NOT NULL DEFAULT FALSE,   -- esiste una decisione locale opposta
  da         TEXT,
  creata_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modello, codice)
);
