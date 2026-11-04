-- HR: le categorie ITALIANO / UE / EXTRA UE non stanno più in "nazionalita" (ora c'è tipo_nazionalita, vedi 0075).
-- Si svuota "nazionalita" solo dove la categoria è già stata copiata nel campo nuovo: nessun dato va perso.
-- La nazionalità vera arriva da Osti con la sincronizzazione.

UPDATE hr_employee
   SET nazionalita = NULL
 WHERE tipo_nazionalita IS NOT NULL
   AND upper(btrim(nazionalita)) IN ('ITALIANO', 'UE', 'EXTRA UE');
