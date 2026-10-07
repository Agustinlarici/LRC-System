# Database — migrazioni

Lo schema si costruisce **solo** con i file in `db/migrations/`, applicati in ordine da
`db/migrate.sh` (servizio docker `migrate`, parte da solo prima del backend).
Ogni file viene applicato **una volta** e registrato in `schema_migrations`.

## Aggiungere una modifica allo schema

1. Creare `db/migrations/NNNN_descrizione.sql` con il numero successivo all'ultimo
   (minuscole, numeri e trattini: `0054_hr-note-dipendente.sql`).
2. Provare in locale: `db/test-migrations.sh` (serve Docker; lo esegue anche la CI).
3. Deploy: `./deploy.sh update` fa backup → migrazioni → nuove immagini.

## Regole

- **Mai modificare un file già applicato.** Il runner confronta il checksum e si ferma
  ("MODIFICATA dopo essere stata applicata"). Per correggere: nuova migrazione.
- Ogni file gira in **una transazione**: se fallisce, nessuna modifica resta a metà e il
  backend non parte con uno schema incompleto.
- `ALTER TYPE ... ADD VALUE` non può essere usato nella stessa transazione: in quel caso
  mettere `-- migrate:no-transaction` nella **prima riga** e scrivere il file in modo
  idempotente (`IF NOT EXISTS`).
- Due rami con lo stesso numero: il runner lo segnala; rinumerare prima del merge.

## Comandi

```bash
docker compose run --rm migrate --status   # cosa è applicato / cosa manca
docker compose run --rm migrate            # applica (lo fa già deploy.sh)
db/check-drift.sh                          # confronta lo schema di produzione con le migrazioni
db/test-migrations.sh                      # test completi su DB temporanei
```

## Passaggio dal vecchio sistema

Prima `deploy.sh` rieseguiva tutti i file `db/migrate-*.sql` a ogni deploy ignorando gli
errori. Alla prima esecuzione su un DB esistente (senza `schema_migrations`) il runner fa
la stessa cosa **una sola volta** (modalità *legacy*), registra tutto e da lì in poi vale
il sistema nuovo. Gli errori tollerati vengono mostrati nel log.

`db/scripts/` contiene correzioni una-tantum da eseguire a mano, non migrazioni.
