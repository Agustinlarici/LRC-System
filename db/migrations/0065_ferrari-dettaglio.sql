-- Schede Ferrari: riassunti dei testi lunghi arrivati dalla PC IA (o scritti da una persona sulla PC IA).
-- Valgono solo se il testo della scheda e' ancora quello da cui sono nati (chiave = hash del testo normalizzato).
CREATE TABLE IF NOT EXISTS ferrari_dettaglio (
  commessa       TEXT        NOT NULL,
  codice         TEXT        NOT NULL,
  chiave         TEXT        NOT NULL,
  dettaglio      TEXT        NOT NULL,
  manuale        BOOLEAN     NOT NULL DEFAULT FALSE,   -- scritto da una persona (non dalla IA)
  da             TEXT,
  pacchetto_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- data del pacchetto: uno piu' vecchio non sovrascrive uno piu' nuovo
  aggiornato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (commessa, codice)
);
