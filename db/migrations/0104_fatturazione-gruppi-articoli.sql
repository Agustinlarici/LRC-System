-- Fatturazione: gruppi di articoli (componente + modello) a cui si assegnano le regole di prezzo.
-- Additiva: le colonne vecchie di fatt_regola restano, il codice precedente continua a funzionare.

-- Gruppo di articoli: nome, componente, modello e codici di vendita che ne fanno parte.
CREATE TABLE IF NOT EXISTS fatt_gruppo_articoli (
  nome          TEXT        PRIMARY KEY,
  componente    TEXT        NOT NULL DEFAULT '',
  modello       TEXT        NOT NULL DEFAULT '',
  codici        TEXT[]      NOT NULL DEFAULT '{}',
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Regola -> gruppo (per nome). NULL = vale per tutti gli articoli.
ALTER TABLE fatt_regola ADD COLUMN IF NOT EXISTS gruppo_articoli TEXT;

-- Le regole che erano su un codice singolo diventano un gruppo con quel solo codice.
INSERT INTO fatt_gruppo_articoli (nome, codici)
  SELECT DISTINCT article_code, ARRAY[article_code] FROM fatt_regola WHERE article_code <> '*'
  ON CONFLICT DO NOTHING;
UPDATE fatt_regola SET gruppo_articoli = article_code WHERE article_code <> '*' AND gruppo_articoli IS NULL;

-- Il nuovo editor conosce una sola catena di passi per regola (senza «tutte/qualsiasi» né eccezioni).
-- Le regole che non si possono esprimere così vengono disattivate e marcate, per non applicarle in modo sbagliato.
UPDATE fatt_regola
   SET attiva = false, nome = nome || ' (da rivedere)'
 WHERE (jsonb_array_length(condizioni) > 1 OR jsonb_array_length(eccezioni) > 0)
   AND nome NOT LIKE '% (da rivedere)';
