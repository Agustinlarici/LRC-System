# LRC System — Backup e Disaster Recovery

## Cosa viene salvato

| Cosa | Dove nel backup |
|---|---|
| Database PostgreSQL completo (inclusi documenti HR in `bytea`) | `db.dump` |
| Allegati ticket (`TICKETS_UPLOADS_HOST`) | `files.tar.gz` |
| Certificati HTTPS (`certs/`) e configurazione `.env` | `files.tar.gz` |
| Percorsi extra (`BACKUP_EXTRA_PATHS`) | `files.tar.gz` |

Ogni backup ha `manifest.txt` (data, commit git, n° tabelle) e `SHA256SUMS`.

## Pianificazione

| Quando | Cosa | Conservazione |
|---|---|---|
| Ogni giorno 02:30 | `backup.sh` | 7 giornalieri, 4 settimanali (domenica), 12 mensili (giorno 1) |
| Domenica 04:30 | `verify-restore.sh` — ripristino di prova in un container isolato | — |
| Ogni `./deploy.sh update` | backup `pre-deploy` (se fallisce, l'aggiornamento si ferma) | ultimi 5 |
| Ogni ripristino | backup `pre-restore` dello stato attuale | ultimi 5 |

Obiettivi: **RPO ≤ 24h** (al massimo si perde un giorno di dati), **RTO ≈ 30 min**.

Se un backup o una verifica falliscono si apre un avviso critico nella pagina **Sistema**
(`backup_failed` / `backup_verify_failed`), che si chiude da solo al successivo esito positivo.
Stato rapido: `cat /srv/lrc-backups/last-backup.status /srv/lrc-backups/last-verify.status`.
Log: `/srv/lrc-backups/logs/`.

## Installazione (una volta)

```bash
# 1. (consigliato) montare un secondo disco su /srv/lrc-backups
# 2. impostare BACKUP_DIR in .env se diverso da /srv/lrc-backups
sudo scripts/backup/install-cron.sh
sudo BACKUP_KIND=manual scripts/backup/backup.sh     # primo backup
sudo scripts/backup/verify-restore.sh                # prova di ripristino
```

> ⚠️ I backup stanno sullo stesso server. Proteggono da errori umani, bug, migrazioni
> sbagliate e corruzione del DB, ma **non** dalla rottura del server/disco. Per questo è
> fortemente consigliato un disco dedicato per `/srv/lrc-backups`.

## Procedure

### A. Dati cancellati o corrotti (server funzionante)

```bash
sudo scripts/backup/restore.sh latest                # oppure una cartella precisa:
sudo scripts/backup/restore.sh /srv/lrc-backups/daily/2026-10-07_023000
# Solo DB:   aggiungere --db-only     Solo file: --files-only
```
Lo script verifica i checksum, chiede di scrivere `RIPRISTINA`, salva lo stato attuale in
`pre-restore/` e ripristina in un **database temporaneo**: la produzione viene sostituita
solo se il ripristino è riuscito (altrimenti resta intatta e il backend riparte).
Il database sostituito resta come `lrc_system_pre_restore` fino al ripristino successivo.
Per annullare: ripristinare l'ultima cartella in `pre-restore/`.

### B. Aggiornamento andato male

```bash
git checkout <commit-precedente>                     # vedi git_commit in manifest.txt
sudo scripts/backup/restore.sh "$(ls -d /srv/lrc-backups/pre-deploy/*/ | tail -1)"
docker compose up -d --build
```

### C. Server nuovo (il vecchio è perso, il disco dei backup è salvo)

```bash
# 1. Installare Ubuntu + Docker, montare il disco dei backup su /srv/lrc-backups
git clone <repo> LRC-System && cd LRC-System
git checkout <git_commit del manifest>
docker volume create lrc-system-pgdata-prod
# 2. Prima i file: riporta .env, certificati e allegati (non serve il DB)
sudo scripts/backup/restore.sh --no-safety --files-only latest
# 3. Poi il database (avvia PostgreSQL e lo ripristina)
sudo scripts/backup/restore.sh --no-safety --db-only latest
# 4. Se cambia l'IP: aggiornare SERVER_IP / NEXT_PUBLIC_API_URL / CORS_ORIGINS in .env
./deploy.sh
sudo scripts/backup/install-cron.sh
```

## Controlli periodici (manuali)

- **Ogni mese**: verificare che `last-verify.status` sia `OK` e recente.
- **Ogni 6 mesi**: provare la procedura C su una macchina di test.
