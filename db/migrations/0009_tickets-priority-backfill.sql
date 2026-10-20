-- ============================================================
-- LRC-System — Backfill delle regole di priorità mancanti
-- Categorie create prima che POST /admin/categories generasse
-- automaticamente le regole restavano invisibili nella tab
-- "Priorità automatica". Questo backfill le completa una tantum.
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ON CONFLICT DO NOTHING
-- ============================================================

INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority)
SELECT DISTINCT category, TRUE, 'alta'::ticket_priority_enum FROM ticket_categories
ON CONFLICT (category, blocca_lavoro) DO NOTHING;

INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority)
SELECT DISTINCT category, FALSE, 'media'::ticket_priority_enum FROM ticket_categories
ON CONFLICT (category, blocca_lavoro) DO NOTHING;
