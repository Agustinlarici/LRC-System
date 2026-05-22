-- EDI — Electronic Data Interchange
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'edi';

-- ─── Clienti EDI ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edi_clients (
  id                          SERIAL       PRIMARY KEY,
  customer_account            VARCHAR(20)  NOT NULL UNIQUE,
  description                 TEXT         NOT NULL,
  edi_type                    VARCHAR(50)  NOT NULL,

  -- CDT: mittente (chi spedisce)
  cdt_company_name            VARCHAR(35)  NOT NULL DEFAULT '',
  cdt_vat                     VARCHAR(20)  NOT NULL DEFAULT '',
  cdt_address_1               VARCHAR(35),
  cdt_address_2               VARCHAR(35),
  cdt_address_3               VARCHAR(35),
  cdt_address_4               VARCHAR(35),

  -- SDT: venditore/fornitore
  sdt_vat                     VARCHAR(20)  NOT NULL DEFAULT '',
  sdt_ferrari_supplier_code   VARCHAR(6)   NOT NULL,

  -- CSG: destinatario Ferrari
  csg_establishment_code      VARCHAR(3)   NOT NULL
                              CHECK (csg_establishment_code IN ('021','023','025','029','030','SSF')),
  csg_company_name            VARCHAR(35)  NOT NULL DEFAULT '',
  csg_address_1               VARCHAR(35),
  csg_address_2               VARCHAR(35),
  csg_address_3               VARCHAR(35),
  csg_address_4               VARCHAR(35),
  csg_supply_point            VARCHAR(17),

  output_folder               TEXT         NOT NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Sequenza annuale numeri avviso ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edi_sequence (
  year           INTEGER PRIMARY KEY,
  last_sequence  INTEGER NOT NULL DEFAULT 0
);

-- ─── Storico generazioni EDI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edi_history (
  id               SERIAL       PRIMARY KEY,
  shipment_id      TEXT         NOT NULL,
  customer_account VARCHAR(20)  NOT NULL,
  edi_type         VARCHAR(50)  NOT NULL,
  filename         TEXT         NOT NULL,
  generated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status           VARCHAR(10)  NOT NULL CHECK (status IN ('sent', 'error')),
  error_message    TEXT,
  file_content     TEXT,
  is_regeneration  BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_edi_history_shipment_id      ON edi_history (shipment_id);
CREATE INDEX IF NOT EXISTS idx_edi_history_customer_account ON edi_history (customer_account);
CREATE INDEX IF NOT EXISTS idx_edi_history_generated_at     ON edi_history (generated_at DESC);

-- ─── Permessi (tutti gli utenti esistenti) ────────────────────────────────────
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'edi'::module_key_enum, TRUE, TRUE
FROM users u
ON CONFLICT (user_id, module_key) DO UPDATE SET can_view = TRUE, can_manage = TRUE;
