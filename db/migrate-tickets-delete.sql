-- ============================================================
-- LRC-System — Eliminazione ticket (soft delete)
-- Un ticket eliminato sparisce da ogni lista/ricerca ma resta nel
-- database (recuperabile via SQL diretto), invece di essere perso
-- per sempre — l'eliminazione di un ticket non è consigliata perché
-- si perde lo storico, quindi si preferisce che sia reversibile.
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER REFERENCES users(id);
