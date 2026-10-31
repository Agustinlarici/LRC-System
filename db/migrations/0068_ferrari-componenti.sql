-- Schede Ferrari: componenti per modello (es. «Paraurti posteriore», «Spoiler») e i termini (sigle o parole) che li compongono.
CREATE TABLE IF NOT EXISTS ferrari_comp (
  modello    TEXT        NOT NULL,
  nome       TEXT        NOT NULL,
  ordine     BIGSERIAL,
  creato_da  TEXT,
  creato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modello, nome)
);

CREATE TABLE IF NOT EXISTS ferrari_comp_termine (
  modello  TEXT    NOT NULL,
  nome     TEXT    NOT NULL,
  termine  TEXT    NOT NULL,
  ordine   INTEGER NOT NULL,
  PRIMARY KEY (modello, nome, termine),
  FOREIGN KEY (modello, nome) REFERENCES ferrari_comp (modello, nome) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Definizioni arrivate dalla PC IA: non valgono finche' una persona non le accetta.
CREATE TABLE IF NOT EXISTS ferrari_comp_proposta (
  modello    TEXT        NOT NULL,
  nome       TEXT        NOT NULL,
  termini    JSONB       NOT NULL,
  conflitto  BOOLEAN     NOT NULL DEFAULT FALSE,   -- esiste un componente locale con lo stesso nome ma termini diversi
  da         TEXT,
  creata_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modello, nome)
);
