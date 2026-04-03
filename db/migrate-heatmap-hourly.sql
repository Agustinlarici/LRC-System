-- Hourly OEE snapshot table for the monthly heatmap (line × hour × day)
-- Applied manually: psql -U lrc -d lrc_system_dev -f db/migrate-heatmap-hourly.sql

CREATE TABLE IF NOT EXISTS monitor_oee_hourly (
    id            SERIAL PRIMARY KEY,
    linea_id      INTEGER  NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data          DATE     NOT NULL,
    ora           SMALLINT NOT NULL CHECK (ora >= 0 AND ora <= 23),
    pezzi_reali   INTEGER  NOT NULL DEFAULT 0,
    pezzi_attesi  INTEGER  NOT NULL DEFAULT 0,
    minuti_fermo  INTEGER  NOT NULL DEFAULT 0,
    fermi_count   INTEGER  NOT NULL DEFAULT 0,
    disponibilita NUMERIC(5,1) NOT NULL DEFAULT 0,
    performance   NUMERIC(5,1) NOT NULL DEFAULT 0,
    oee           NUMERIC(5,1) NOT NULL DEFAULT 0,
    has_data      BOOLEAN  NOT NULL DEFAULT FALSE,
    computed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (linea_id, data, ora)
);

CREATE INDEX IF NOT EXISTS idx_monitor_oee_hourly_linea_data ON monitor_oee_hourly(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_oee_hourly_data       ON monitor_oee_hourly(data);
