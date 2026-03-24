-- ============================================================
-- LRC-System PostgreSQL Schema
-- Migrated from MySQL (ProduzioneSTR)
-- ============================================================

-- Enable UUID extension (optional, for future use)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE estado_orden_enum AS ENUM ('pendiente', 'en_proceso', 'completado');
CREATE TYPE spma_plan_status AS ENUM ('PENDING', 'PICKED', 'CONFIRMED', 'SENT', 'SKIPPED');

-- ============================================================
-- LEGACY / PRODUCTION PLANNING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS calendario_laboral (
    id            SERIAL PRIMARY KEY,
    anio          INTEGER NOT NULL,
    mes           INTEGER NOT NULL,
    dia           INTEGER NOT NULL,
    es_laboral    BOOLEAN NOT NULL DEFAULT FALSE,
    hora_inicio   TIME DEFAULT NULL,
    hora_fin      TIME DEFAULT NULL,
    date          DATE DEFAULT NULL,
    UNIQUE (anio, mes, dia)
);

CREATE TABLE IF NOT EXISTS sectores (
    id_sector         SERIAL PRIMARY KEY,
    nombre_sector     VARCHAR(100) NOT NULL,
    descripcion       TEXT
);

CREATE TABLE IF NOT EXISTS productos (
    id_producto   SERIAL PRIMARY KEY,
    nombre        VARCHAR(255) NOT NULL,
    descripcion   TEXT
);

CREATE TABLE IF NOT EXISTS ordenes_produccion (
    id_orden        SERIAL PRIMARY KEY,
    id_producto     INTEGER NOT NULL REFERENCES productos(id_producto) ON DELETE CASCADE,
    cantidad        INTEGER NOT NULL,
    fecha_creacion  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_entrega   TIMESTAMP DEFAULT NULL,
    num_orden       VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS flujo_producto_sector (
    id_flujo                    SERIAL PRIMARY KEY,
    id_producto                 INTEGER NOT NULL REFERENCES productos(id_producto) ON DELETE CASCADE,
    id_sector                   INTEGER NOT NULL REFERENCES sectores(id_sector) ON DELETE CASCADE,
    orden_proceso               INTEGER NOT NULL,
    tiempo_estimado_minutos     INTEGER NOT NULL,
    descripcion_proceso         VARCHAR(50) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS estado_orden (
    id_estado           SERIAL PRIMARY KEY,
    id_orden            INTEGER NOT NULL REFERENCES ordenes_produccion(id_orden) ON DELETE CASCADE,
    id_producto         INTEGER NOT NULL REFERENCES productos(id_producto) ON DELETE CASCADE,
    id_sector           INTEGER NOT NULL REFERENCES sectores(id_sector) ON DELETE CASCADE,
    orden_proceso       INTEGER NOT NULL,
    cantidad_pendiente  INTEGER DEFAULT 0,
    estado              estado_orden_enum DEFAULT 'pendiente',
    fecha_inicio        TIMESTAMP DEFAULT NULL,
    fecha_fin           TIMESTAMP DEFAULT NULL,
    fecha_a_empezar     TIMESTAMP DEFAULT NULL,
    fecha_a_terminar    TIMESTAMP DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS historial_estado_orden (
    id                SERIAL PRIMARY KEY,
    id_orden          INTEGER NOT NULL REFERENCES ordenes_produccion(id_orden),
    id_producto       INTEGER NOT NULL REFERENCES productos(id_producto),
    id_sector         INTEGER NOT NULL REFERENCES sectores(id_sector),
    cantidad_parcial  INTEGER NOT NULL,
    fecha_entrada     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_salida      TIMESTAMP DEFAULT NULL
);

-- ============================================================
-- PACKING MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS pack_commessa_group (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_operator (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_operator_session (
    id           SERIAL PRIMARY KEY,
    operator_id  INTEGER NOT NULL REFERENCES pack_operator(id),
    started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_article (
    code            VARCHAR(50) PRIMARY KEY,
    description     VARCHAR(255) DEFAULT NULL,
    family          VARCHAR(100) DEFAULT NULL,
    commessa_group  INTEGER DEFAULT NULL REFERENCES pack_commessa_group(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pack_article_weight (
    article_code    VARCHAR(50) PRIMARY KEY REFERENCES pack_article(code) ON DELETE CASCADE,
    unit_weight_kg  NUMERIC(10, 4) NOT NULL,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_article_price (
    article_code  VARCHAR(50) NOT NULL REFERENCES pack_article(code) ON DELETE CASCADE,
    currency      VARCHAR(10) NOT NULL DEFAULT 'EUR',
    unit_cost     NUMERIC(12, 4) NOT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_code, currency)
);

CREATE TABLE IF NOT EXISTS pack_container (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    length_mm   INTEGER NOT NULL DEFAULT 0,
    width_mm    INTEGER NOT NULL DEFAULT 0,
    height_mm   INTEGER NOT NULL DEFAULT 0,
    tare_kg     NUMERIC(10, 3) NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_article_container (
    article_code   VARCHAR(50) PRIMARY KEY REFERENCES pack_article(code) ON DELETE CASCADE,
    container_id   INTEGER NOT NULL REFERENCES pack_container(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pack_dispatch_destination (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_article_dispatch (
    id              SERIAL PRIMARY KEY,
    article_code    VARCHAR(50) NOT NULL REFERENCES pack_article(code) ON DELETE CASCADE,
    destination_id  INTEGER NOT NULL REFERENCES pack_dispatch_destination(id) ON DELETE CASCADE,
    UNIQUE (article_code, destination_id)
);

CREATE TABLE IF NOT EXISTS pack_dispatch (
    id              SERIAL PRIMARY KEY,
    type            VARCHAR(100),
    destination_id  INTEGER REFERENCES pack_dispatch_destination(id),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_pallet (
    id          SERIAL PRIMARY KEY,
    session_id  INTEGER REFERENCES pack_operator_session(id),
    number      INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_pallet_item (
    id            SERIAL PRIMARY KEY,
    pallet_id     INTEGER NOT NULL REFERENCES pack_pallet(id) ON DELETE CASCADE,
    article_code  VARCHAR(50) NOT NULL REFERENCES pack_article(code),
    quantity      INTEGER NOT NULL DEFAULT 1,
    commessa      VARCHAR(100) DEFAULT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pack_dispatch_pallet (
    id           SERIAL PRIMARY KEY,
    dispatch_id  INTEGER NOT NULL REFERENCES pack_dispatch(id) ON DELETE CASCADE,
    pallet_id    INTEGER NOT NULL REFERENCES pack_pallet(id) ON DELETE CASCADE,
    UNIQUE (dispatch_id, pallet_id)
);

-- ============================================================
-- PRODUCTION ORDERS (from Business Central sync)
-- ============================================================

CREATE TABLE IF NOT EXISTS prod_order (
    id               SERIAL PRIMARY KEY,
    bc_order_no      VARCHAR(50) UNIQUE,
    description      VARCHAR(500),
    item_no          VARCHAR(100),
    quantity         NUMERIC(18, 4),
    due_date         DATE,
    status           VARCHAR(50),
    routing_no       VARCHAR(100),
    present_now      BOOLEAN DEFAULT FALSE,
    last_seen_at     TIMESTAMP DEFAULT NULL,
    row_sig          VARCHAR(64),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_area_montaggio (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50) UNIQUE NOT NULL,
    description  VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS prod_operator_assignment (
    id           SERIAL PRIMARY KEY,
    operator_id  INTEGER NOT NULL REFERENCES pack_operator(id),
    article_code VARCHAR(50),
    assigned_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_commessa_inserimenti (
    id                  SERIAL PRIMARY KEY,
    commessa            VARCHAR(100) NOT NULL,
    linea               VARCHAR(100),
    insertion_line_ts   TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_article_info (
    id            SERIAL PRIMARY KEY,
    article_code  VARCHAR(50) UNIQUE NOT NULL,
    caratteristiche TEXT,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_article_auto (
    id            SERIAL PRIMARY KEY,
    article_code  VARCHAR(50) UNIQUE NOT NULL,
    caratteristiche TEXT,
    generated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_article_color (
    id            SERIAL PRIMARY KEY,
    article_code  VARCHAR(50) UNIQUE NOT NULL,
    colors        TEXT,
    detected_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prod_keyword_rules (
    id       SERIAL PRIMARY KEY,
    keyword  VARCHAR(100) NOT NULL,
    output   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prod_color_keywords (
    id       SERIAL PRIMARY KEY,
    keyword  VARCHAR(100) NOT NULL,
    color    VARCHAR(100) NOT NULL
);

-- ============================================================
-- SPMA (Production Planning) MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS spma_component_category (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS spma_line (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS spma_line_alias (
    id       SERIAL PRIMARY KEY,
    line_id  INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
    alias    VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS spma_line_calendar (
    id          SERIAL PRIMARY KEY,
    line_id     INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
    work_date   DATE NOT NULL,
    shift_start TIME NOT NULL,
    shift_end   TIME NOT NULL,
    UNIQUE (line_id, work_date)
);

CREATE TABLE IF NOT EXISTS spma_line_component_station (
    id           SERIAL PRIMARY KEY,
    line_id      INTEGER NOT NULL REFERENCES spma_line(id) ON DELETE CASCADE,
    category_id  INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
    station_name VARCHAR(100),
    UNIQUE (line_id, category_id)
);

CREATE TABLE IF NOT EXISTS spma_model_component_req (
    id            SERIAL PRIMARY KEY,
    model_code    VARCHAR(100) NOT NULL,
    category_id   INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
    required      BOOLEAN DEFAULT TRUE,
    UNIQUE (model_code, category_id)
);

CREATE TABLE IF NOT EXISTS spma_category_keywords (
    id           SERIAL PRIMARY KEY,
    category_id  INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
    keyword      VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS spma_commessa (
    id              SERIAL PRIMARY KEY,
    commessa_no     VARCHAR(100) NOT NULL UNIQUE,
    line_id         INTEGER REFERENCES spma_line(id),
    model_code      VARCHAR(100),
    line_entry_ts   TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spma_plan (
    id            SERIAL PRIMARY KEY,
    commessa_id   INTEGER NOT NULL REFERENCES spma_commessa(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES spma_component_category(id) ON DELETE CASCADE,
    item_code     VARCHAR(100),
    status        spma_plan_status DEFAULT 'PENDING',
    confirmed_at  TIMESTAMP DEFAULT NULL,
    sent_at       TIMESTAMP DEFAULT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (commessa_id, category_id)
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

-- ============================================================
-- INGRESSO MERCI (Goods Receipt)
-- ============================================================

CREATE TABLE IF NOT EXISTS ingresso_merci (
    id                      SERIAL PRIMARY KEY,
    materiale               TEXT NOT NULL,
    mezzo                   VARCHAR(255) NOT NULL,
    commessa                VARCHAR(100) DEFAULT NULL,
    inserito_da             VARCHAR(100) DEFAULT 'Anonimo',
    orario_arrivo           TIMESTAMP NOT NULL,
    timestamp_inserimento   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingresso_merci_storico (
    id                    SERIAL PRIMARY KEY,
    materiale             TEXT NOT NULL,
    mezzo                 VARCHAR(255) NOT NULL,
    commessa              VARCHAR(100) DEFAULT NULL,
    inserito_da           VARCHAR(100),
    orario_arrivo         TIMESTAMP,
    ricevuto_da           VARCHAR(100) NOT NULL,
    timestamp_ricezione   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MONITOR MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS monitor_linea (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL,
    fase        VARCHAR(200) NOT NULL,
    modello     VARCHAR(200),
    componente  VARCHAR(200),
    attivo      BOOLEAN NOT NULL DEFAULT TRUE,
    logo        VARCHAR(50) DEFAULT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Per database già esistenti: ALTER TABLE monitor_linea ADD COLUMN IF NOT EXISTS logo VARCHAR(50) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS monitor_turno (
    id          SERIAL PRIMARY KEY,
    linea_id    INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data        DATE NOT NULL,
    numero      INTEGER NOT NULL DEFAULT 1,
    ora_inizio  TIME NOT NULL,
    ora_fine    TIME NOT NULL,
    UNIQUE (linea_id, data, numero)
);

CREATE TABLE IF NOT EXISTS monitor_quantita_giorno (
    id                   SERIAL PRIMARY KEY,
    linea_id             INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data                 DATE NOT NULL,
    quantita_giornaliera INTEGER NOT NULL,
    UNIQUE (linea_id, data)
);

CREATE TABLE IF NOT EXISTS monitor_soglie (
    id              SERIAL PRIMARY KEY,
    linea_id        INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    soglia_giallo   INTEGER NOT NULL DEFAULT 50,
    soglia_rosso    INTEGER NOT NULL DEFAULT 20,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (linea_id)
);

CREATE TABLE IF NOT EXISTS monitor_pausa (
    id          SERIAL PRIMARY KEY,
    linea_id    INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data        DATE NOT NULL,
    ora_inizio  TIME NOT NULL,
    ora_fine    TIME NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_linestop (
    id          SERIAL PRIMARY KEY,
    linea_id    INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
    data        DATE NOT NULL,
    inizio_ts   TIMESTAMP WITH TIME ZONE NOT NULL,
    fine_ts     TIMESTAMP WITH TIME ZONE,
    durata_sec  INTEGER  -- compilato quando la linea riprende
);

-- ============================================================
-- BUFFER MODULE
-- ============================================================

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

-- ============================================================
-- MAPPA MODULE
-- ============================================================

CREATE TABLE IF NOT EXISTS mappa_shape_monitor (
    shape_tag   VARCHAR(50) PRIMARY KEY,
    monitor_id  INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mappa_shape_buffer (
    shape_tag  VARCHAR(50) PRIMARY KEY,
    buffer_id  INTEGER NOT NULL REFERENCES buffer_linea(id) ON DELETE CASCADE
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pack_pallet_item_pallet   ON pack_pallet_item(pallet_id);
CREATE INDEX IF NOT EXISTS idx_pack_pallet_item_article  ON pack_pallet_item(article_code);
CREATE INDEX IF NOT EXISTS idx_pack_dispatch_pallet_d    ON pack_dispatch_pallet(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_pack_dispatch_pallet_p    ON pack_dispatch_pallet(pallet_id);
CREATE INDEX IF NOT EXISTS idx_pack_session_operator     ON pack_operator_session(operator_id);
CREATE INDEX IF NOT EXISTS idx_spma_plan_commessa        ON spma_plan(commessa_id);
CREATE INDEX IF NOT EXISTS idx_spma_plan_status          ON spma_plan(status);
CREATE INDEX IF NOT EXISTS idx_prod_order_bc             ON prod_order(bc_order_no);
CREATE INDEX IF NOT EXISTS idx_ingresso_merci_arrivo     ON ingresso_merci(orario_arrivo);
CREATE INDEX IF NOT EXISTS idx_monitor_linea_attivo      ON monitor_linea(attivo);
CREATE INDEX IF NOT EXISTS idx_monitor_turno_linea_data  ON monitor_turno(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_pausa_linea_data    ON monitor_pausa(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_linestop_linea_data ON monitor_linestop(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_monitor_qta_linea_data    ON monitor_quantita_giorno(linea_id, data);
CREATE INDEX IF NOT EXISTS idx_buffer_linea_attivo ON buffer_linea(attivo);
