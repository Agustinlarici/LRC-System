-- Schede Ferrari: validazione degli Excel di allestimento con due analisi indipendenti
-- (VM deterministica + PC IA) e confronto. Vedi docs/FERRARI-FLUSSO.md.
-- Solo tabelle nuove (nessuna modifica a tabelle esistenti).

-- ─── Configurazione ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_config (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ferrari_config (key, value) VALUES
  ('sampling_pct',        '100'),    -- % di schede VERDI che passano comunque da revisione (100 = tutte)
  ('four_eyes',           'true'),   -- chi propone una regola non può approvarla
  ('conoscenza_versione', '0'),      -- sale a ogni approvazione/revoca di regole
  ('ia_attesa_ore',       '48')      -- oltre queste ore senza risposta IA la scheda è segnalata
ON CONFLICT (key) DO NOTHING;

-- ─── Scheda (file Ferrari) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_file (
  id              SERIAL      PRIMARY KEY,
  filename        TEXT        NOT NULL,
  sha256          CHAR(64)    NOT NULL UNIQUE,
  size_bytes      INTEGER     NOT NULL,
  original        BYTEA       NOT NULL,                 -- originale immutabile (trigger sotto)
  stato           TEXT        NOT NULL DEFAULT 'IN_ATTESA_IA'
                  CHECK (stato IN ('QUARANTENA','IN_ATTESA_IA','IN_REVISIONE','ACCETTATO_AUTO',
                                   'VALIDATO','RIFIUTATO','SOSTITUITO')),
  ia_stato        TEXT        NOT NULL DEFAULT 'in_attesa'
                  CHECK (ia_stato IN ('in_attesa','ricevuta','assente')),
  esito           TEXT        CHECK (esito IN ('VERDE','AMBRA','ROSSO')),
  campione        BOOLEAN     NOT NULL DEFAULT FALSE,   -- VERDE ma estratta a campione per la revisione
  commessa        TEXT,
  modello         TEXT,
  versione        TEXT,
  mercato_codice  TEXT,
  paese           TEXT,
  matricola       TEXT,
  canonico        JSONB,                                -- JSON canonico (NULL se in quarantena)
  quarantena_motivo TEXT,
  sostituito_da   INTEGER     REFERENCES ferrari_file(id),
  dati_validati   JSONB,
  rev             INTEGER     NOT NULL DEFAULT 0,       -- blocco ottimistico: sale a ogni decisione
  caricato_da_id  INTEGER,
  caricato_da     TEXT        NOT NULL,
  caricato_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  inviato_ia_at   TIMESTAMPTZ,
  chiuso_da       TEXT,
  chiuso_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ferrari_file_stato    ON ferrari_file (stato, caricato_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferrari_file_commessa ON ferrari_file (commessa);
CREATE INDEX IF NOT EXISTS idx_ferrari_file_modello  ON ferrari_file (modello);

-- L'originale e il suo hash non si toccano mai.
CREATE OR REPLACE FUNCTION ferrari_file_immutabile() RETURNS trigger AS $fn$
BEGIN
  IF NEW.original IS DISTINCT FROM OLD.original OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.filename IS DISTINCT FROM OLD.filename THEN
    RAISE EXCEPTION 'ferrari_file: originale, nome e hash sono immutabili';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ferrari_file_immutabile ON ferrari_file;
CREATE TRIGGER trg_ferrari_file_immutabile BEFORE UPDATE ON ferrari_file
  FOR EACH ROW EXECUTE FUNCTION ferrari_file_immutabile();

-- ─── Analisi (VM e IA), una riga per esecuzione: non si modificano ────────────
CREATE TABLE IF NOT EXISTS ferrari_analisi (
  id                   SERIAL      PRIMARY KEY,
  file_id              INTEGER     NOT NULL REFERENCES ferrari_file(id),
  fonte                TEXT        NOT NULL CHECK (fonte IN ('vm','ia')),
  risultato            JSONB       NOT NULL,
  versione_conoscenza  INTEGER     NOT NULL DEFAULT 0,
  bundle_id            UUID,                              -- solo per fonte = 'ia'
  creata_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ferrari_analisi_file ON ferrari_analisi (file_id, fonte, id DESC);

-- ─── Confronto VM / IA ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_confronto (
  id               SERIAL      PRIMARY KEY,
  file_id          INTEGER     NOT NULL REFERENCES ferrari_file(id),
  analisi_vm_id    INTEGER     NOT NULL REFERENCES ferrari_analisi(id),
  analisi_ia_id    INTEGER     REFERENCES ferrari_analisi(id),   -- NULL = revisione senza IA
  esito            TEXT        NOT NULL CHECK (esito IN ('VERDE','AMBRA','ROSSO')),
  risultato        JSONB       NOT NULL,
  creato_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ferrari_confronto_file ON ferrari_confronto (file_id, id DESC);

-- ─── Decisioni umane (solo inserimenti) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_decisione (
  id             SERIAL      PRIMARY KEY,
  file_id        INTEGER     NOT NULL REFERENCES ferrari_file(id),
  confronto_id   INTEGER     NOT NULL REFERENCES ferrari_confronto(id),
  item_key       TEXT        NOT NULL,
  decisione      TEXT        NOT NULL
                 CHECK (decisione IN ('conferma_vm','conferma_ia','correggi','ignora','verificato_immagini')),
  valore_dopo    JSONB,
  motivo         TEXT,
  proposta_id    INTEGER,                                 -- regola proposta in questa decisione
  riportata_da   INTEGER,                                 -- id della decisione originale se e' stata riportata dopo una rianalisi
  user_id        INTEGER,
  username       TEXT        NOT NULL,
  creata_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ferrari_decisione_file ON ferrari_decisione (file_id, confronto_id, item_key);

-- ─── Conoscenza: codici opzione e componenti del testo libero ─────────────────
-- ambito: modello = NULL → tutti i modelli; altrimenti solo quel modello (es. F171VS).
-- Una regola nasce 'proposta' e vale solo dopo l'approvazione di un supervisore.
CREATE TABLE IF NOT EXISTS ferrari_codice (
  id              SERIAL      PRIMARY KEY,
  codice          TEXT        NOT NULL,
  modello         TEXT,
  significato     TEXT        NOT NULL,
  categoria       TEXT,
  stato           TEXT        NOT NULL DEFAULT 'proposta' CHECK (stato IN ('proposta','approvata','rifiutata','revocata')),
  proposto_da     TEXT        NOT NULL,
  proposto_da_id  INTEGER,
  proposto_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deciso_da       TEXT,
  deciso_da_id    INTEGER,
  deciso_at       TIMESTAMPTZ,
  motivo          TEXT,
  file_origine_id INTEGER     REFERENCES ferrari_file(id),
  versione_in     INTEGER                                  -- versione conoscenza in cui è entrata
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ferrari_codice_approvato
  ON ferrari_codice (codice, COALESCE(modello, '')) WHERE stato = 'approvata';
CREATE INDEX IF NOT EXISTS idx_ferrari_codice_stato ON ferrari_codice (stato);

CREATE TABLE IF NOT EXISTS ferrari_componente (
  id              SERIAL      PRIMARY KEY,
  pattern         TEXT        NOT NULL,                    -- testo normalizzato da cercare (es. 'BLU ELDER')
  tipo            TEXT        NOT NULL,                    -- ZONA, MATERIALE, COLORE, ...
  valore          TEXT        NOT NULL,                    -- forma canonica (es. 'BLU ELDER')
  modello         TEXT,
  esempio_testo   TEXT,                                    -- testo originale da cui è stata imparata
  stato           TEXT        NOT NULL DEFAULT 'proposta' CHECK (stato IN ('proposta','approvata','rifiutata','revocata')),
  proposto_da     TEXT        NOT NULL,
  proposto_da_id  INTEGER,
  proposto_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deciso_da       TEXT,
  deciso_da_id    INTEGER,
  deciso_at       TIMESTAMPTZ,
  motivo          TEXT,
  file_origine_id INTEGER     REFERENCES ferrari_file(id),
  versione_in     INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ferrari_componente_approvato
  ON ferrari_componente (pattern, tipo, COALESCE(modello, '')) WHERE stato = 'approvata';
CREATE INDEX IF NOT EXISTS idx_ferrari_componente_stato ON ferrari_componente (stato);

-- ─── Pacchetti scambiati con la PC IA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_bundle (
  bundle_id    UUID        PRIMARY KEY,
  tipo         TEXT        NOT NULL CHECK (tipo IN ('to-ai','from-ai','knowledge')),
  direzione    TEXT        NOT NULL CHECK (direzione IN ('out','in')),
  batch_id     UUID,
  in_reply_to  UUID,
  stato        TEXT        NOT NULL CHECK (stato IN ('creato','importato','rifiutato')),
  motivo       TEXT,
  manifest     JSONB,
  file_ids     INTEGER[]   NOT NULL DEFAULT '{}',
  sha256       CHAR(64),
  contenuto    BYTEA,                                      -- zip dei pacchetti in uscita (per riscaricarli)
  creato_da    TEXT        NOT NULL,
  creato_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ferrari_bundle_tipo ON ferrari_bundle (tipo, creato_at DESC);

-- Un pacchetto rifiutato non ha un bundle_id affidabile: il rifiuto si registra qui.
CREATE TABLE IF NOT EXISTS ferrari_bundle_rifiutato (
  id         SERIAL      PRIMARY KEY,
  filename   TEXT,
  sha256     CHAR(64),
  motivo     TEXT        NOT NULL,
  utente     TEXT        NOT NULL,
  creato_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Storico append-only con catena di hash ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrari_audit (
  id         BIGSERIAL   PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INTEGER,
  username   TEXT,
  azione     TEXT        NOT NULL,
  entita     TEXT,
  entita_id  TEXT,
  dettagli   JSONB,
  hash_prec  CHAR(64)    NOT NULL,
  hash       CHAR(64)    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ferrari_audit_entita ON ferrari_audit (entita, entita_id);

CREATE OR REPLACE FUNCTION ferrari_solo_append() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION '% e'' di sola aggiunta: % non consentito', TG_TABLE_NAME, TG_OP;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ferrari_file_nodelete ON ferrari_file;
CREATE TRIGGER trg_ferrari_file_nodelete BEFORE DELETE ON ferrari_file
  FOR EACH ROW EXECUTE FUNCTION ferrari_solo_append();

DROP TRIGGER IF EXISTS trg_ferrari_audit_append ON ferrari_audit;
CREATE TRIGGER trg_ferrari_audit_append BEFORE UPDATE OR DELETE ON ferrari_audit
  FOR EACH ROW EXECUTE FUNCTION ferrari_solo_append();

DROP TRIGGER IF EXISTS trg_ferrari_analisi_append ON ferrari_analisi;
CREATE TRIGGER trg_ferrari_analisi_append BEFORE UPDATE OR DELETE ON ferrari_analisi
  FOR EACH ROW EXECUTE FUNCTION ferrari_solo_append();

DROP TRIGGER IF EXISTS trg_ferrari_decisione_append ON ferrari_decisione;
CREATE TRIGGER trg_ferrari_decisione_append BEFORE UPDATE OR DELETE ON ferrari_decisione
  FOR EACH ROW EXECUTE FUNCTION ferrari_solo_append();
