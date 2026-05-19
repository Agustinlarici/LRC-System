-- Monitor Resumen: gruppi configurabili di linee andon
CREATE TABLE IF NOT EXISTS monitor_resumen (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_resumen_linee (
  resumen_id INTEGER NOT NULL REFERENCES monitor_resumen(id) ON DELETE CASCADE,
  linea_id   INTEGER NOT NULL REFERENCES monitor_linea(id)   ON DELETE CASCADE,
  ordine     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (resumen_id, linea_id)
);
