-- Schede Ferrari: «non e' una sigla» (colore, codice di materiale...), decisione presa dal programma, sotto-sigla legata a una voce,
-- e l'elenco dei modelli (creati da una persona, errori di scrittura di un modello).
ALTER TABLE ferrari_sigla ADD COLUMN IF NOT EXISTS nosigla BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ferrari_sigla ADD COLUMN IF NOT EXISTS auto    BOOLEAN NOT NULL DEFAULT FALSE;   -- deciso dal programma perche' sicuro (altri modelli d'accordo)
ALTER TABLE ferrari_sigla ADD COLUMN IF NOT EXISTS padre   TEXT;                              -- sotto-sigla: la voce (colonna) dentro cui compare; vuoto = in qualsiasi voce

CREATE TABLE IF NOT EXISTS ferrari_modello_noto (
  modello   TEXT        PRIMARY KEY,
  creato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ferrari_modello_alias (
  sbagliato TEXT PRIMARY KEY,
  giusto    TEXT NOT NULL
);
