-- ============================================================
-- LRC-System — Backfill di resolved_at per ticket chiusi senza passare da "risolto"
-- Prima di questo fix, chiudere un ticket direttamente (senza lo stato
-- intermedio "risolto") lasciava resolved_at NULL per sempre — l'SLA e
-- il grafico "Totale aperti" continuavano a considerarlo aperto.
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: solo tocca righe con resolved_at ancora NULL
-- ============================================================

UPDATE tickets
SET resolved_at = COALESCE(closed_at, updated_at)
WHERE status = 'chiuso' AND resolved_at IS NULL;
