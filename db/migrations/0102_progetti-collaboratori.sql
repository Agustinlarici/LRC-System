-- ============================================================
-- LRC-System — Progetti: collaboratori e attività condivise
--
-- Un progetto può avere collaboratori (persone con un account, solo lettura): vedono
-- l'avanzamento, le fasi, le novità e SOLO le attività segnate come visibili.
-- I richiedenti dei ticket collegati entrano da soli (source = 'auto'); gli altri si
-- aggiungono a mano (source = 'manual').
-- Solo aggiunte (tabella nuova + colonna con default): il codice precedente regge lo schema nuovo.
-- Run AFTER 0092_progetti-fasi.sql
-- Safe to re-run: IF NOT EXISTS / ON CONFLICT DO NOTHING
-- ============================================================

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  source     VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
  added_by   INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- Attività visibili ai collaboratori e al richiedente. Default FALSE: nulla si espone da solo.
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS visible_to_requester BOOLEAN NOT NULL DEFAULT FALSE;

-- I richiedenti dei ticket già collegati diventano collaboratori (non vedono nulla finché
-- nessuna attività viene segnata come visibile). Mai l'account condiviso «guest» né utenti disattivati.
INSERT INTO project_members (project_id, user_id, source)
SELECT DISTINCT t.project_id, t.created_by_user_id, 'auto'
FROM tickets t JOIN users u ON u.id = t.created_by_user_id
WHERE t.project_id IS NOT NULL AND t.deleted_at IS NULL
  AND u.is_active = TRUE AND u.role <> 'guest'
ON CONFLICT DO NOTHING;
