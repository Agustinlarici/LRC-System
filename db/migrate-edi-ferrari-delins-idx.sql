CREATE INDEX IF NOT EXISTS edi_ferrari_delins_contratto_order_idx
  ON edi_ferrari_delins (num_contratto, num_programma, data_consegna, codice_articolo);

CREATE INDEX IF NOT EXISTS edi_ferrari_delins_num_programma_sched_idx
  ON edi_ferrari_delins (num_programma, tipo_schedulazione, tipo_documento);

ANALYZE edi_ferrari_delins;
