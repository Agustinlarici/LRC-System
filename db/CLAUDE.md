# Database — regole per le sessioni

- Ogni modifica allo schema = **nuovo file** `db/migrations/NNNN_descrizione.sql` con il numero
  successivo all'ultimo (minuscole, numeri, trattini).
- **Mai modificare** un file di migrazione esistente: il runner confronta il checksum e il
  deploy si ferma. Per correggere, nuova migrazione.
- Mai file `.sql` direttamente in `db/` (il deploy si blocca).
- Mai creare/alterare tabelle dal codice del backend all'avvio (`CREATE TABLE` in `index.ts`):
  va in una migrazione.
- `ALTER TYPE ... ADD VALUE` → mettere `-- migrate:no-transaction` nella prima riga e scrivere
  il file idempotente (`IF NOT EXISTS`).
- Preferire migrazioni che **aggiungono** (colonne nullable, tabelle nuove): il rollback del
  codice funziona solo se il codice vecchio regge lo schema nuovo.


## Buone pratiche

- Prima di creare un file, controllare l'ultimo numero in `db/migrations/` **anche nei branch/PR aperti**:
  due rami con lo stesso numero vanno rinumerati prima del merge.
- Una migrazione = un cambiamento coerente; nome che dice cosa fa.
- Mai `DROP`/`DELETE`/`TRUNCATE` di dati senza conferma dell'utente.
- Provare sempre con `db/test-migrations.sh` (serve Docker) e riportare l'esito.
