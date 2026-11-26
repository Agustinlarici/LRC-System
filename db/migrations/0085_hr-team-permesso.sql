-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- ============================================================
-- LRC-System — HR: permesso 'hr_team' per i capi
-- Dà accesso a: il proprio team (Dipendenti), Richieste, Scadenze del team e Organigramma.
-- 'hr' resta il permesso HR completo (Documenti, Analisi, Evoluzione, tutto il personale).
-- ============================================================
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'hr_team';
