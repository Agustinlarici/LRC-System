-- Schede Ferrari: per ogni modello, quali sigle vanno in tabella e quali no (modello '*' = tutti i modelli).
-- Sostituisce l'elenco semplice di 0062 (ferrari_termine, che resta senza uso); le sigle gia' scelte passano qui.
CREATE TABLE IF NOT EXISTS ferrari_sigla (
  modello    TEXT        NOT NULL,
  codice     TEXT        NOT NULL,
  va         BOOLEAN     NOT NULL,
  ordine     BIGSERIAL,
  creato_da  TEXT,
  creato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modello, codice)
);

INSERT INTO ferrari_sigla (modello, codice, va, creato_da)
SELECT modello, termine, TRUE, creato_da FROM ferrari_termine ORDER BY modello, ordine
ON CONFLICT (modello, codice) DO NOTHING;
