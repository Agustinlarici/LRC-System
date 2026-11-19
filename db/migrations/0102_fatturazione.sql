-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- Fatturazione (Amministrazione): prezzo di vendita stimato STR per riga di spedizione, calcolato con regole sulla descrizione dell'ordine di vendita.
-- Solo tabelle nuove: il codice precedente continua a funzionare con questo schema.
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'fatturazione';

-- Regole di prezzo per codice di vendita (article_code; '*' = tutti).
-- passi = catena di ricerche nella descrizione; vuota = la regola vale sempre (prezzo base del componente).
CREATE TABLE IF NOT EXISTS fatt_regola (
  id            BIGSERIAL PRIMARY KEY,
  ordine        INTEGER       NOT NULL,
  nome          TEXT          NOT NULL,
  attiva        BOOLEAN       NOT NULL DEFAULT true,
  article_code  TEXT          NOT NULL DEFAULT '*',
  prezzo        NUMERIC(12,2) NOT NULL,
  passi         JSONB         NOT NULL DEFAULT '[]'::jsonb,
  creato_da     TEXT,
  aggiornato_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fatt_regola_ordine ON fatt_regola (ordine, id);

-- Gruppi di parole riusabili nelle regole (es. COLORI), citati come @COLORI.
CREATE TABLE IF NOT EXISTS fatt_gruppo (
  nome          TEXT        PRIMARY KEY,
  parole        TEXT[]      NOT NULL DEFAULT '{}',
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conti cliente (Destination No_) le cui spedizioni compaiono in Fatturazione.
CREATE TABLE IF NOT EXISTS fatt_conto (
  conto         TEXT        PRIMARY KEY,
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fatt_conto (conto) VALUES ('C558') ON CONFLICT DO NOTHING;
