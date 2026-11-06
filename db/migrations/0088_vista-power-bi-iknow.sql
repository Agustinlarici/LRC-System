-- ============================================================
-- Vista per Power BI: eventi iKnow degli ultimi 3 mesi
-- Si aggiorna da sola: il filtro usa la data di oggi, quindi Power BI vede sempre
-- gli ultimi 3 mesi e non serve cambiare nulla nella query.
-- Sola lettura. Il filtro è su data_cache (ha già un indice).
-- Power BI → PostgreSQL → vista v_iknow_ultimi_3_mesi
-- ============================================================

CREATE OR REPLACE VIEW v_iknow_ultimi_3_mesi AS
SELECT
  data_cache                                              AS giorno,
  data_inserimento,
  (data_inserimento AT TIME ZONE 'Europe/Rome')           AS data_inserimento_roma,
  fase,
  modello,
  componente,
  cod_seriale,
  commessa,
  esito_delibera,
  versione,
  operatore,
  colore,
  protocollo_cesta
FROM webthron_events_history
WHERE data_cache >= (CURRENT_DATE - INTERVAL '3 months')::date;
