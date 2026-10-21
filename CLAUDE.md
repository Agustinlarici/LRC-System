# LRC System — istruzioni per Claude Code

Gestionale interno di fabbrica: backend Hono + TypeScript (`backend/`), frontend Next.js
(`frontend/`), PostgreSQL 16, Docker compose. Produzione: server Ubuntu in rete interna,
branch `dev`, aggiornato solo con `./deploy.sh update`.
Commenti nel codice e messaggi di commit in **italiano**, come il resto del progetto.
L'utente scrive in spagnolo: rispondere in spagnolo, in modo breve e concreto.

## Flusso di lavoro (sempre)

1. Partire da `dev` aggiornato: `git checkout dev && git pull`.
2. Lavorare su un **branch nuovo** (mai commit diretti su `dev`).
3. Prima di proporre il commit, eseguire i controlli (sezione sotto) e dire all'utente l'esito.
4. Commit + push del branch + **PR verso `dev`**. La CI deve essere verde prima del merge.
5. Il merge lo fa l'utente. Il deploy lo fa l'utente sul server con `./deploy.sh update`.

Non eseguire mai comandi contro il server di produzione e non suggerire `git pull` o
`docker compose up` a mano sul server: solo `./deploy.sh update` / `./deploy.sh rollback`.

## Database: migrazioni (regole rigide, vedi `db/README.md`)

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

## Controlli prima di ogni commit

```bash
cd backend  && npm run type-check && npm test
cd frontend && npm run type-check && npm run lint
db/test-migrations.sh            # se sono cambiate le migrazioni (serve Docker)
shellcheck -S warning scripts/backup/*.sh scripts/monitor/*.sh deploy.sh   # se sono cambiati script
```

## Da non toccare senza chiedere

- `deploy.sh`, `scripts/backup/`, `scripts/monitor/`, `db/migrate.sh`, `docker-compose.yml`:
  backup, disaster recovery e deploy della produzione. Ogni modifica va provata in Docker.
- Versioni delle immagini Docker (sono fissate apposta) e versioni principali delle dipendenze.
- `.env` e segreti: mai committarli, mai stamparli nelle risposte.
- Generatori EDI (`backend/edi_generators/`): quello che producono arriva ai clienti
  (Ferrari, Audi, McLaren); ogni cambio va confermato con l'utente.

## Documenti utili

- `db/README.md` — migrazioni
- `docs/DISASTER-RECOVERY.md` — backup, ripristino, procedure di emergenza
