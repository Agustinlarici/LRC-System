-- Fatturazione: le regole di prezzo tornano a essere per articolo singolo (i prezzi cambiano troppo per usare gruppi).
-- Additiva: la tabella fatt_gruppo_articoli e la colonna fatt_regola.gruppo_articoli restano (non più usate).

-- Una regola assegnata a un gruppo diventa una regola per ogni codice del gruppo (stessa catena di parole e stesso prezzo).
INSERT INTO fatt_regola (ordine, nome, attiva, article_code, prezzo, logica, condizioni, eccezioni, creato_da)
  SELECT r.ordine, r.nome, r.attiva, c, r.prezzo, 'tutte', r.condizioni, '[]'::jsonb, r.creato_da
  FROM fatt_regola r
  JOIN fatt_gruppo_articoli g ON g.nome = r.gruppo_articoli
  CROSS JOIN LATERAL unnest(g.codici) AS c
  WHERE r.gruppo_articoli IS NOT NULL AND r.article_code = '*';

-- L'originale (quella del gruppo) resta ma disattivata, per non perdere nulla né contare il prezzo due volte.
UPDATE fatt_regola
   SET attiva = false, nome = nome || ' (gruppo)', gruppo_articoli = NULL
 WHERE gruppo_articoli IS NOT NULL AND article_code = '*';

-- Le regole su un codice singolo (convertite in gruppo dalla 0104) hanno già article_code giusto.
UPDATE fatt_regola SET gruppo_articoli = NULL WHERE gruppo_articoli IS NOT NULL;

-- La tabella mostra al massimo 3 parole per regola: quelle con più passi vanno riviste.
UPDATE fatt_regola
   SET attiva = false, nome = nome || ' (da rivedere)'
 WHERE jsonb_array_length(COALESCE(condizioni->0->'passi', '[]'::jsonb)) > 3
   AND nome NOT LIKE '% (da rivedere)';
