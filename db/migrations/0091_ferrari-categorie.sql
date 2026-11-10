-- Schede Ferrari: categorie per raggruppare le colonne della tabella (es. LIVREA, DREAMLINE, CARB.).
-- Valgono per tutti i modelli. Ogni categoria ha un elenco di codici o parole: una colonna entra nella categoria se il suo
-- codice e' uno di quelli (o comincia cosi'), oppure se la sua descrizione contiene la parola. Solo tabelle nuove.
CREATE TABLE IF NOT EXISTS ferrari_categoria (
  id        BIGSERIAL   PRIMARY KEY,
  nome      TEXT        NOT NULL,
  ordine    INTEGER     NOT NULL DEFAULT 0,
  creato_da TEXT,
  creato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ferrari_categoria_nome_uq ON ferrari_categoria (lower(nome));

CREATE TABLE IF NOT EXISTS ferrari_categoria_termine (
  categoria_id BIGINT  NOT NULL REFERENCES ferrari_categoria(id) ON DELETE CASCADE,
  termine      TEXT    NOT NULL,
  ordine       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (categoria_id, termine)
);
