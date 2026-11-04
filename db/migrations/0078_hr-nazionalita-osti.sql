-- HR: "Extra UE / Italia" diventa un campo a sé (tipo_nazionalita), calcolato dal paese della nazionalità.
-- Il campo "nazionalita" passa a contenere la nazionalità come arriva da Osti (ITALIANA, MOLDAVA…).
-- Finora in "nazionalita" c'erano le categorie ITALIANO / UE / EXTRA UE: si copiano nel campo nuovo.
-- Colonna nullable e nessun valore cancellato: il codice precedente continua a funzionare.

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS tipo_nazionalita VARCHAR(20);

UPDATE hr_employee
   SET tipo_nazionalita = upper(btrim(nazionalita))
 WHERE tipo_nazionalita IS NULL
   AND upper(btrim(nazionalita)) IN ('ITALIANO', 'UE', 'EXTRA UE');
