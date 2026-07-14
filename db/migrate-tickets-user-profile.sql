-- ============================================================
-- LRC-System — User profile fields for ticket auto-fill
-- Run AFTER migrate-tickets.sql / migrate-auth.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES ticket_departments(id);
