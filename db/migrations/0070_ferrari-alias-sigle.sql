-- Schede Ferrari: alias = «questo codice e' un errore di scrittura di quest'altro» (deciso da una persona).
-- Es. TLM15 scritto al posto di TLM16, oppure BLC2 al posto di BIC2: si legge come il codice giusto, con un avviso.
ALTER TABLE ferrari_sigla          ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE ferrari_sigla_proposta ADD COLUMN IF NOT EXISTS alias TEXT;
