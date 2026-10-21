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
| Ogni `./deploy.sh update` con novità | backup `pre-deploy` (se fallisce, l'aggiornamento si ferma) | ultimi 10 |
| Ogni ripristino | backup `pre-restore` dello stato attuale | ultimi 10 |
| Dopo ogni backup giornaliero/manuale | copia **cifrata** in rete (`offsite.sh`, se `BACKUP_OFFSITE_SMB` è impostato) | ultime 30 in rete |

Obiettivi: **RPO ≤ 24h** (al massimo si perde un giorno di dati), **RTO ≈ 30 min**.

Se un backup o una verifica falliscono si apre un avviso critico nella pagina **Sistema**
(`backup_failed` / `backup_verify_failed`), che si chiude da solo al successivo esito positivo.
Stato rapido: `cat /srv/lrc-backups/last-backup.status /srv/lrc-backups/last-verify.status`.
Log: `/srv/lrc-backups/logs/` (output del cron in `logs/cron.log`).

## Installazione (una volta)

```bash
# 1. (consigliato) montare un secondo disco su /srv/lrc-backups
# 2. impostare BACKUP_DIR in .env se diverso da /srv/lrc-backups
scripts/backup/install-cron.sh                       # (sudo se BACKUP_DIR è di root)
BACKUP_KIND=manual scripts/backup/backup.sh          # primo backup
sudo scripts/backup/verify-restore.sh                # prova di ripristino
```

> ⚠️ I backup locali stanno sullo stesso server: per la rottura del server/disco serve la
> **copia in rete**. Attivazione (una volta):
> ```bash
> # in .env: BACKUP_OFFSITE_SMB=\\server\share\percorso   (credenziali SMB_* già presenti)
> scripts/backup/offsite.sh --init     # genera la chiave e prova la scrittura
> ```
> La chiave `BACKUP_ENCRYPTION_KEY` va **conservata anche fuori dal server** (gestore
> password, busta in cassaforte): se il server è perso, senza chiave le copie non si aprono.
> Stato: `cat <BACKUP_DIR>/last-offsite.status`; errore → avviso `backup_offsite_failed`.

## Procedure

> **Chi esegue cosa**: tutto dall'utente che possiede il repository (gruppo docker).
> `sudo` serve solo se `BACKUP_DIR` è una cartella di root (es. `/srv/lrc-backups`);
> con `BACKUP_DIR=/home/<utente>/lrc-backups` nel `.env` togliere `sudo` dai comandi qui sotto.
>
> **Quale backup**: `latest` = ultimo giornaliero/manuale · `latest-pre-deploy` = quello fatto
> prima dell'ultimo update · `latest-pre-restore` = stato salvato prima dell'ultimo ripristino
> (mai scelto in automatico) · oppure il percorso di una cartella precisa.

### A. Dati cancellati o corrotti (server funzionante)

```bash
sudo scripts/backup/restore.sh latest                # oppure una cartella precisa:
sudo scripts/backup/restore.sh /srv/lrc-backups/daily/2026-10-07_023000
# Solo DB:   aggiungere --db-only     Solo file: --files-only
```
Lo script mostra tipo e data del backup scelto, verifica i checksum, chiede di scrivere
`RIPRISTINA`, salva lo stato attuale in `pre-restore/` e ripristina in un **database
temporaneo**: la produzione viene sostituita solo se il ripristino è riuscito (altrimenti
resta intatta e il backend riparte). Il database sostituito resta come
`lrc_system_pre_restore` fino al ripristino successivo.
Per annullare il ripristino: `sudo scripts/backup/restore.sh latest-pre-restore`.

### B. Aggiornamento andato male

`./deploy.sh update` si protegge da solo: backup prima; se migrazioni, controllo schema,
build o avvio del backend falliscono, torna automaticamente alla versione precedente
(codice **e** immagini Docker, senza ricompilare).
Se il problema si scopre dopo (es. un errore funzionale):

```bash
./deploy.sh rollback                                 # codice e immagini precedenti, DB invariato
# Se servono anche i dati di prima dell'update:
sudo scripts/backup/restore.sh latest-pre-deploy
```

### C. Server nuovo (il vecchio è perso, il disco dei backup è salvo)

```bash
# 1. Installare Ubuntu + Docker, montare il disco dei backup su /srv/lrc-backups
#    (la cartella del progetto può essere diversa da quella del vecchio server)
git clone -b <branch di produzione> <repo> LRC-System && cd LRC-System
#    git_commit in manifest.txt dice la versione che girava: se diversa dall'ultima,
#    git reset --hard <git_commit>   (resta sul branch, i futuri update funzionano)
docker volume create lrc-system-pgdata-prod
#    Se il disco dei backup è perso: recuperare l'ultima copia dalla rete
#    (serve un .env minimo con BACKUP_DIR, BACKUP_OFFSITE_SMB, SMB_USER/PASS/DOMAIN,
#     BACKUP_ENCRYPTION_KEY e l'immagine con smbclient: BACKUP_OFFSITE_IMAGE=dperson/samba)
#    scripts/backup/offsite.sh --fetch latest
# 2. Prima i file: riporta .env, certificati e allegati nella cartella del progetto
sudo scripts/backup/restore.sh --no-safety --files-only latest
# 3. Poi il database (avvia PostgreSQL e lo ripristina)
sudo scripts/backup/restore.sh --no-safety --db-only latest
# 4. Se cambia l'IP: aggiornare SERVER_IP / NEXT_PUBLIC_API_URL / CORS_ORIGINS in .env
./deploy.sh
sudo scripts/backup/install-cron.sh
```

## Controlli periodici (manuali)

- **Ogni mese**: verificare che `last-verify.status` e `last-offsite.status` siano `OK` e recenti.
- **Ogni 3 mesi**: provare `offsite.sh --fetch latest` + `verify-restore.sh latest` (la copia in rete si apre).
- **Ogni 6 mesi**: provare la procedura C su una macchina di test.
