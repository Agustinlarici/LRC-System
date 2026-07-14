-- ============================================================
-- LRC-System — Consente di cambiare categoria/sottocategoria di un ticket
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: ADD VALUE IF NOT EXISTS
-- ============================================================

ALTER TYPE ticket_action_enum ADD VALUE IF NOT EXISTS 'categoria_cambiata';
