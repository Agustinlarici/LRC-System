-- Controllo SOP: le differenze gia' viste da una persona. Una differenza e' identificata da commessa, colonna, valore del SOP e valore della VM:
-- se uno dei due valori cambia (nuovo SOP, regola modificata) e' una differenza diversa e torna «da vedere». Solo una tabella nuova.
CREATE TABLE IF NOT EXISTS ferrari_sop_visto (
  commessa TEXT        NOT NULL,
  colonna  TEXT        NOT NULL,
  sop      TEXT        NOT NULL,
  vm       TEXT        NOT NULL,
  visto_da TEXT,
  visto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (commessa, colonna, sop, vm)
);
