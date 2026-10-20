-- ============================================================
-- LRC-System — Backfill: i ticket riaperti non devono avere resolved_at/closed_at
-- Prima di questo fix, riaprire un ticket non puliva resolved_at/closed_at,
-- quindi l'SLA e il grafico "Totale aperti" continuavano a considerarlo
-- risolto anche se lo stato diceva "riaperto".
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: tocca solo righe con status = 'riaperto'
-- ============================================================

UPDATE tickets
SET resolved_at = NULL, closed_at = NULL
WHERE status = 'riaperto' AND (resolved_at IS NOT NULL OR closed_at IS NOT NULL);
