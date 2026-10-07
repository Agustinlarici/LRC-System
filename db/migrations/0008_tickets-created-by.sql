-- ============================================================
-- LRC-System — Traccia l'utente loggato che ha aperto il ticket
-- (per poter mostrare "i miei ticket" a chi lo ha creato)
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by_user_id);
