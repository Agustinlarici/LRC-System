-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- Fatturazione (Amministrazione): prezzo di vendita stimato STR per riga di spedizione, calcolato con regole sulla descrizione dell'ordine di vendita.
-- Solo tabelle nuove: il codice precedente continua a funzionare con questo schema.
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'fatturazione';

-- Regole di prezzo per codice di vendita (article_code; '*' = tutti).
-- condizioni = elenco di catene di ricerca nella descrizione ({passi:[{cerca:[...],finestra:N|null}]}), combinate con 'logica';
-- eccezioni = stesso formato, se una combacia la regola non si applica. Nessuna condizione = vale sempre (prezzo base).
CREATE TABLE IF NOT EXISTS fatt_regola (
  id            BIGSERIAL PRIMARY KEY,
  ordine        INTEGER       NOT NULL,
  nome          TEXT          NOT NULL,
  attiva        BOOLEAN       NOT NULL DEFAULT true,
  article_code  TEXT          NOT NULL DEFAULT '*',
  prezzo        NUMERIC(12,2) NOT NULL,
  logica        TEXT          NOT NULL DEFAULT 'tutte' CHECK (logica IN ('tutte', 'qualsiasi')),
  condizioni    JSONB         NOT NULL DEFAULT '[]'::jsonb,
  eccezioni     JSONB         NOT NULL DEFAULT '[]'::jsonb,
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

-- Copia locale delle righe di spedizione (da BC, ogni ora): le pagine leggono da qui e le regole si ricalcolano al volo.
CREATE TABLE IF NOT EXISTS fatt_riga (
  shipment_id      TEXT        NOT NULL,
  line_no          INTEGER     NOT NULL,
  shipment_date    DATE,
  customer_account TEXT        NOT NULL,
  article_code     TEXT        NOT NULL,
  quantity         NUMERIC(14,3) NOT NULL DEFAULT 0,
  order_no         TEXT        NOT NULL DEFAULT '',
  descrizione      TEXT        NOT NULL DEFAULT '',
  sincronizzata_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_fatt_riga_data ON fatt_riga (shipment_date DESC);

-- Stato dell'ultima sincronizzazione (una sola riga).
CREATE TABLE IF NOT EXISTS fatt_sync_stato (
  id          INTEGER     PRIMARY KEY CHECK (id = 1),
  ultima_sync TIMESTAMPTZ,
  in_corso_da TIMESTAMPTZ,
  errore      TEXT
);
INSERT INTO fatt_sync_stato (id) VALUES (1) ON CONFLICT DO NOTHING;
