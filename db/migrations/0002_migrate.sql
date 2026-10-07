-- ============================================================
-- LRC-System — Migration script
-- Esegui questo script sulla produzione per aggiornare lo schema
-- È idempotente: può essere rieseguito senza errori
-- ============================================================

-- monitor_linea_combo (aggiunta dopo il deploy iniziale)
CREATE TABLE IF NOT EXISTS monitor_linea_combo (
    id          SERIAL PRIMARY KEY,
    linea_id    INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    modello     VARCHAR(200) NOT NULL,
    componente  VARCHAR(200) NOT NULL
);

-- buffer module (aggiunto dopo il deploy iniziale)
CREATE TABLE IF NOT EXISTS buffer_linea (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(100) NOT NULL,
    attivo     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buffer_linea_fase (
    id         SERIAL PRIMARY KEY,
    linea_id   INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE,
    fase       VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS buffer_linea_combo (
    id         SERIAL PRIMARY KEY,
    linea_id   INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE,
    modello    VARCHAR(200) NOT NULL,
    componente VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS buffer_soglie (
    id             SERIAL PRIMARY KEY,
    linea_id       INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE UNIQUE,
    soglia_verde   INTEGER NOT NULL DEFAULT 10,
    soglia_giallo  INTEGER NOT NULL DEFAULT 5
);

-- mappa buffer (aggiunto dopo il deploy iniziale)
CREATE TABLE IF NOT EXISTS mappa_shape_buffer (
    shape_tag  VARCHAR(50) PRIMARY KEY,
    buffer_id  INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_buffer_linea_attivo ON buffer_linea(attivo);
CREATE INDEX IF NOT EXISTS idx_monitor_linestop_linea_data ON monitor_linestop(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_qta_linea_data ON monitor_quantita_giorno(linea_id, data);
