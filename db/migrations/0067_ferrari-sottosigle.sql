-- Schede Ferrari: sotto-sigle = codici dentro un testo libero (es. TML5 dentro LIVR). Si decidono come le sigle
-- (va / non va, per modello o per tutti) ma non sono una colonna: compaiono dentro la cella dell'opzione che le contiene.
ALTER TABLE ferrari_sigla          ADD COLUMN IF NOT EXISTS sub BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ferrari_sigla_proposta ADD COLUMN IF NOT EXISTS sub BOOLEAN NOT NULL DEFAULT FALSE;
