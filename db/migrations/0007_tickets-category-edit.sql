-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- ============================================================
-- LRC-System — Consente di cambiare categoria/sottocategoria di un ticket
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ADD VALUE IF NOT EXISTS
-- ============================================================

ALTER TYPE ticket_action_enum ADD VALUE IF NOT EXISTS 'categoria_cambiata';
