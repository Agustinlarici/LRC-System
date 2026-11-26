-- Registro delle chiamate di iKnow a POST /api/delibere/accettate: serve a vedere se arrivano e,
-- se no, perché (token errato, origine non «API», corpo non valido...). Mai il token né l'header
-- Authorization: solo l'esito del controllo. Il backend cancella le righe più vecchie di 30 giorni.
CREATE TABLE IF NOT EXISTS photo_iknow_calls (
  id          BIGSERIAL   PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  http_status SMALLINT    NOT NULL,
  esito       TEXT        NOT NULL CHECK (esito IN (
    'ok', 'duplicata', 'fase_sconosciuta', 'ignorata_origine',
    'token_errato', 'token_non_configurato', 'corpo_non_valido', 'errore_interno'
  )),
  dettaglio   TEXT,           -- motivo leggibile (es. «data_ora non valida»)
  seriale     TEXT,           -- campi del corpo, solo dopo che il token è risultato valido
  commessa    TEXT,
  fase        TEXT,
  componente  TEXT,
  versione    TEXT,
  data_ora    TEXT,
  job_id      BIGINT
);

CREATE INDEX IF NOT EXISTS photo_iknow_calls_received_idx ON photo_iknow_calls (received_at DESC);
