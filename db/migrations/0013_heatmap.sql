-- Daily OEE snapshot table for the monthly heatmap
-- New installations: this file is mounted as 04_heatmap.sql in docker-compose
-- Existing installations: run manually →
--   psql -U lrc -d lrc_system_dev -f db/migrate-heatmap.sql

CREATE TABLE IF NOT EXISTS monitor_oee_daily (
    id                SERIAL PRIMARY KEY,
    linea_id          INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data              DATE NOT NULL,
    pezzi_reali       INTEGER NOT NULL DEFAULT 0,
    pezzi_pianificati INTEGER NOT NULL DEFAULT 0,
    pezzi_conformi    INTEGER NOT NULL DEFAULT 0,
    pezzi_deliberati  INTEGER NOT NULL DEFAULT 0,
    minuti_turno      INTEGER NOT NULL DEFAULT 0,
    minuti_fermo      INTEGER NOT NULL DEFAULT 0,
    disponibilita     NUMERIC(5,1) NOT NULL DEFAULT 0,
    performance       NUMERIC(5,1) NOT NULL DEFAULT 0,
    qualita           NUMERIC(5,1) NOT NULL DEFAULT 100,
    oee               NUMERIC(5,1) NOT NULL DEFAULT 0,
    fermi_count       INTEGER NOT NULL DEFAULT 0,
    computed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (linea_id, data)
);

CREATE INDEX IF NOT EXISTS idx_monitor_oee_daily_linea_data ON monitor_oee_daily(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_oee_daily_data       ON monitor_oee_daily(data);
