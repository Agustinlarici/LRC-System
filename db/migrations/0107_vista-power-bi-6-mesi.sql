-- ============================================================
-- Vista per Power BI: la finestra passa da 3 a 6 mesi
-- Lo storico si carica e si rilegge ora per 180 giorni (BACKFILL_DAYS), quindi la vista
-- deve mostrare gli stessi 6 mesi.
-- Il nome resta v_iknow_ultimi_3_mesi (storico): così la query di Power BI e l'endpoint
-- /api/powerbi/eventi.csv non cambiano. Stesse colonne, stesso ordine: cambia solo il filtro.
-- Sola lettura. Il filtro è su data_cache (ha già un indice).
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
WHERE data_cache >= (CURRENT_DATE - INTERVAL '6 months')::date;
