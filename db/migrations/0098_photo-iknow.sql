-- Photo Station: ordini che arrivano da iKnow (POST /api/delibere/accettate).
-- Un ordine per chiamata: seriale, componente e versione attesi restano sull'ordine (servono alla fase IA).
ALTER TABLE photo_jobs ADD COLUMN IF NOT EXISTS seriale    TEXT;
ALTER TABLE photo_jobs ADD COLUMN IF NOT EXISTS componente TEXT;
ALTER TABLE photo_jobs ADD COLUMN IF NOT EXISTS versione   TEXT;
ALTER TABLE photo_jobs ADD COLUMN IF NOT EXISTS event_at   TIMESTAMPTZ;   -- data_ora dichiarata da iKnow

-- Un solo ordine aperto per commessa + fase + seriale + componente (prima: solo commessa + fase).
-- Gli ordini manuali non hanno seriale né componente: per loro non cambia nulla.
DROP INDEX IF EXISTS photo_jobs_uno_aperto;
CREATE UNIQUE INDEX IF NOT EXISTS photo_jobs_uno_aperto
  ON photo_jobs (commessa, phase, COALESCE(seriale, ''), COALESCE(componente, ''))
  WHERE status IN ('pending', 'claimed');

-- Token con cui iKnow si autentica (lo decide l'azienda e ce lo manda): nel DB solo l'hash. Una sola riga.
CREATE TABLE IF NOT EXISTS photo_iknow_config (
  id         SMALLINT    PRIMARY KEY CHECK (id = 1),
  token_hash TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Origine "copia del DB di iKnow" (webthron_events_history) oltre alla chiamata API: stesso ordine, stessa funzione.
ALTER TABLE photo_jobs DROP CONSTRAINT IF EXISTS photo_jobs_source_check;
ALTER TABLE photo_jobs ADD CONSTRAINT photo_jobs_source_check CHECK (source IN ('manual', 'iknow', 'iknow_db'));

-- L'idempotenza non dipende dall'origine: lo stesso evento arrivato dalla copia e poi dall'API non fa due ordini.
DROP INDEX IF EXISTS photo_jobs_external;
CREATE UNIQUE INDEX IF NOT EXISTS photo_jobs_external ON photo_jobs (external_ref) WHERE external_ref IS NOT NULL;

-- Nome esatto della fase in iKnow (es. 'DELIBERA FINALE PROX'): se manca vale il codice normalizzato.
ALTER TABLE photo_phases ADD COLUMN IF NOT EXISTS iknow_fase TEXT;

-- Alimentatore dalla copia del DB di iKnow. Spento di default; non guarda mai prima di enabled_since
-- (accendendolo non si fotografa lo storico). esiti_ok = esiti di delibera che contano come "accettata".
CREATE TABLE IF NOT EXISTS photo_feed_config (
  id            SMALLINT    PRIMARY KEY CHECK (id = 1),
  enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  esiti_ok      TEXT[]      NOT NULL DEFAULT '{}',
  enabled_since TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);
