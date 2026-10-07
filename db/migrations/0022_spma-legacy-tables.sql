-- ============================================================
-- SPMA — tabelle legacy (spostate da schema.sql)
-- schema.sql conteneva una versione vecchia delle tabelle SPMA che, essendo
-- creata per prima, impediva a migrate-spma.sql di creare quella attuale
-- (CREATE TABLE IF NOT EXISTS saltava). Qui restano solo le tabelle che
-- esistevano esclusivamente in schema.sql, con la definizione originale.
-- ============================================================

CREATE TABLE IF NOT EXISTS spma_category_keywords (
    id           SERIAL PRIMARY KEY,
    category_id  INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
    keyword      VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS spma_skip_reason (
    id    SERIAL PRIMARY KEY,
    code  VARCHAR(50) UNIQUE NOT NULL,
    label VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS spma_picking_session (
    id           SERIAL PRIMARY KEY,
    operator_id  INTEGER REFERENCES pack_operator(id),
    started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at     TIMESTAMP DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS spma_picking_issue_log (
    id          SERIAL PRIMARY KEY,
    plan_id     INTEGER NOT NULL REFERENCES spma_plan(id) ON DELETE CASCADE,
    session_id  INTEGER REFERENCES spma_picking_session(id),
    reason_code VARCHAR(50),
    note        TEXT,
    logged_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
