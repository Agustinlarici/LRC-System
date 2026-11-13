-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- Photo Station: la VM tiene la coda degli ordini di foto. La PC Camere (Photo Station) chiama la VM,
-- prende l'ordine, scatta, carica le foto e chiude l'ordine. Solo tabelle nuove.
-- Nessun permesso assegnato: finché non lo decide l'admin, il modulo lo vede solo l'admin.
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'photo_station';

-- Fasi che arrivano da iKnow (es. delibera_finale, delibera_finale_proximiti). Ogni fase ha le sue
-- stazioni e il suo flusso: un ordine di una fase lo prende solo una stazione abilitata a quella fase.
CREATE TABLE IF NOT EXISTS photo_phases (
  key        TEXT        PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label      TEXT        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stazioni autorizzate (PC Camere, in futuro PC IA): token lungo, nel DB solo l'hash.
-- phases vuoto = non serve nessuna fase (minimo privilegio: va abilitata esplicitamente).
CREATE TABLE IF NOT EXISTS photo_stations (
  id           SERIAL      PRIMARY KEY,
  name         TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  token_hash   TEXT        NOT NULL UNIQUE,
  phases       TEXT[]      NOT NULL DEFAULT '{}',
  created_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- Un ordine di foto per commessa. 'analyzing' e 'done' sono per la fase PC IA (non ancora usate).
CREATE TABLE IF NOT EXISTS photo_jobs (
  id            BIGSERIAL   PRIMARY KEY,
  commessa      TEXT        NOT NULL CHECK (length(commessa) BETWEEN 1 AND 64),
  phase         TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'iknow')),
  external_ref  TEXT,                                   -- id della chiamata iKnow (idempotenza), se c'è
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'claimed', 'captured', 'analyzing', 'done', 'failed', 'cancelled')),
  station_id    INTEGER     REFERENCES photo_stations(id) ON DELETE SET NULL,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  capture_status TEXT       CHECK (capture_status IN ('ok', 'partial', 'failed')),
  capture_errors JSONB      NOT NULL DEFAULT '[]'::jsonb,
  error         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un solo ordine aperto per commessa E fase (la stessa commessa passa per più fasi): un doppio clic o una
-- doppia chiamata non crea doppioni.
CREATE UNIQUE INDEX IF NOT EXISTS photo_jobs_uno_aperto ON photo_jobs (commessa, phase) WHERE status IN ('pending', 'claimed');
CREATE UNIQUE INDEX IF NOT EXISTS photo_jobs_external ON photo_jobs (source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS photo_jobs_stato ON photo_jobs (status, id);

CREATE TABLE IF NOT EXISTS photo_job_files (
  id         BIGSERIAL   PRIMARY KEY,
  job_id     BIGINT      NOT NULL REFERENCES photo_jobs(id) ON DELETE CASCADE,
  camera     TEXT        NOT NULL,
  filename   TEXT        NOT NULL,                      -- nome sul disco della VM, deciso dal server
  bytes      INTEGER     NOT NULL,
  sha256     CHAR(64)    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, camera)
);
