-- Schede Ferrari: collegamento con la PC IA (vedi docs/FERRARI-CONNESSIONE-IA.md).
-- Tutto nuovo e solo in aggiunta: con l'interruttore spento (ferrari_config.ia_attiva) queste tabelle restano vuote.

-- Un lavoro di analisi IA per scheda. Uno solo attivo per scheda (indice parziale sotto).
CREATE TABLE IF NOT EXISTS ferrari_ia_job (
  id                    BIGSERIAL   PRIMARY KEY,
  file_id               INTEGER     NOT NULL REFERENCES ferrari_file(id) ON DELETE CASCADE,
  sha256                CHAR(64)    NOT NULL,
  richiesta_id          UUID        NOT NULL DEFAULT gen_random_uuid(),   -- idempotenza: un invio perso non crea doppioni
  id_remoto             TEXT,
  stato                 TEXT        NOT NULL DEFAULT 'in_coda'
                        CHECK (stato IN ('in_coda', 'inviato', 'in_analisi', 'confronto', 'fatto', 'attesa_ia', 'errore', 'annullato')),
  passo                 TEXT        NOT NULL DEFAULT 'ricevuta'
                        CHECK (passo IN ('ricevuta', 'letta', 'inviata', 'analisi', 'confronto', 'pronta')),
  avanzamento           JSONB       NOT NULL DEFAULT '{}'::jsonb,         -- {fatti, totale, etichetta} dalla PC IA
  tentativi             INTEGER     NOT NULL DEFAULT 0,
  prossimo_tentativo_at TIMESTAMPTZ,
  errore                TEXT,
  versione_sigle        TEXT,
  creato_da             TEXT        NOT NULL,
  creato_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  inviato_at            TIMESTAMPTZ,
  finito_at             TIMESTAMPTZ,
  aggiornato_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ferrari_ia_job_uno_attivo
  ON ferrari_ia_job (file_id) WHERE stato IN ('in_coda', 'inviato', 'in_analisi', 'confronto', 'attesa_ia');
CREATE INDEX IF NOT EXISTS ferrari_ia_job_da_fare ON ferrari_ia_job (stato, prossimo_tentativo_at);
CREATE INDEX IF NOT EXISTS ferrari_ia_job_file ON ferrari_ia_job (file_id, id DESC);

-- Linea del tempo di un lavoro (solo aggiunte): alimenta lo schermo «Elaborazione».
CREATE TABLE IF NOT EXISTS ferrari_ia_passo (
  id        BIGSERIAL   PRIMARY KEY,
  job_id    BIGINT      NOT NULL REFERENCES ferrari_ia_job(id) ON DELETE CASCADE,
  passo     TEXT        NOT NULL,
  stato     TEXT        NOT NULL CHECK (stato IN ('in_corso', 'ok', 'attenzione', 'errore', 'saltato')),
  dettaglio TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ferrari_ia_passo_job ON ferrari_ia_passo (job_id, id);

-- Cosa ha risposto la IA (lettura di controllo, avvisi, metriche) e il confronto per codice fatto dalla VM.
CREATE TABLE IF NOT EXISTS ferrari_ia_risultato (
  job_id      BIGINT      PRIMARY KEY REFERENCES ferrari_ia_job(id) ON DELETE CASCADE,
  lettura     JSONB       NOT NULL,
  avvisi      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metriche    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  esito       TEXT        NOT NULL CHECK (esito IN ('uguale', 'discrepanze')),
  discrepanze JSONB       NOT NULL DEFAULT '[]'::jsonb,
  creato_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
