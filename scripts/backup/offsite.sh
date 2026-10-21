#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Copia CIFRATA dei backup su una cartella di rete (SMB)
#
# Protegge dalla perdita del server/disco: i backup locali stanno sullo stesso
# disco del database. Ogni copia è un unico file cifrato AES-256: chi apre la
# cartella di rete vede solo dati illeggibili (contiene .env e dati HR).
#
# Configurazione in .env:
#   BACKUP_OFFSITE_SMB=//strlan.local/data/Pubblico/Portale STR/IT/Backup/lrc-system
#   BACKUP_ENCRYPTION_KEY=...      (generata con --init: CONSERVARLA ANCHE FUORI DAL SERVER)
#   BACKUP_OFFSITE_KEEP=30         (copie da tenere in rete)
#   Credenziali: SMB_USER / SMB_PASS / SMB_DOMAIN (le stesse degli EDI), oppure
#   BACKUP_OFFSITE_USER / BACKUP_OFFSITE_PASS / BACKUP_OFFSITE_DOMAIN
#
# Uso:
#   scripts/backup/offsite.sh --init            → genera la chiave e prova l'accesso
#   scripts/backup/offsite.sh <cartella-backup> → copia (lo fa backup.sh da solo)
#   scripts/backup/offsite.sh --list            → elenco delle copie in rete
#   scripts/backup/offsite.sh --fetch [latest|<file>]
#                                               → scarica, verifica e decifra in $BACKUP_DIR/manual/
#                                                 (poi: scripts/backup/restore.sh latest)
#
# smbclient gira in un container (immagine del backend, che lo contiene già):
# niente da installare sul server, niente sudo.
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TARGET="$(env_get BACKUP_OFFSITE_SMB "")"
KEY="$(env_get BACKUP_ENCRYPTION_KEY "")"
KEEP="$(env_get BACKUP_OFFSITE_KEEP 30)"
SMB_IMAGE="$(env_get BACKUP_OFFSITE_IMAGE "")"
O_USER="$(env_get BACKUP_OFFSITE_USER "$(env_get SMB_USER "")")"
O_PASS="$(env_get BACKUP_OFFSITE_PASS "$(env_get SMB_PASS "")")"
O_DOMAIN="$(env_get BACKUP_OFFSITE_DOMAIN "$(env_get SMB_DOMAIN "")")"
STATUS_FILE="$BACKUP_DIR/last-offsite.status"

# Immagine con smbclient: di default quella del backend (<progetto compose>-backend)
if [ -z "$SMB_IMAGE" ]; then
  proj="$(grep -m1 -E '^name:' docker-compose.yml 2>/dev/null | awk '{print $2}')"
  SMB_IMAGE="${proj:-lrc-system}-backend"
fi

[ -n "$TARGET" ] || die "BACKUP_OFFSITE_SMB non impostato in .env"
TARGET="${TARGET//\\//}"                                   # accetta anche \\server\share\...
SHARE="$(echo "$TARGET" | cut -d/ -f1-4)"                   # //server/share
SUBDIR="$(echo "$TARGET" | cut -d/ -f5-)"                   # percorso dentro la share

WORK="$(mktemp -d "$BACKUP_DIR/.offsite-XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Credenziali in un file (non nella riga di comando: sarebbero visibili con ps)
umask 077
printf 'username = %s\npassword = %s\n' "$O_USER" "$O_PASS" > "$WORK/auth"
[ -n "$O_DOMAIN" ] && printf 'domain = %s\n' "$O_DOMAIN" >> "$WORK/auth"

# smbclient gira con lo stesso utente di questo script: l'immagine del backend
# usa l'utente "node", che non potrebbe leggere i file temporanei (permessi 600)
RUN_AS="$(id -u):$(id -g)"

# smbclient nella cartella di destinazione; i file locali stanno in /x
smb() {
  local cmd="$1" cd_cmd=""
  [ -n "$SUBDIR" ] && cd_cmd="cd \"$SUBDIR\"; "
  docker run --rm --network host --user "$RUN_AS" -e HOME=/tmp --entrypoint smbclient -v "$WORK:/x" "$SMB_IMAGE" \
    "$SHARE" -A /x/auth -c "${cd_cmd}${cmd}" 2>&1
}

# Crea il percorso livello per livello (mkdir di smbclient non crea i genitori)
smb_mkdirs() {
  local path="" part
  IFS='/' read -r -a parts <<< "$SUBDIR"
  for part in "${parts[@]}"; do
    [ -z "$part" ] && continue
    path="${path:+$path/}$part"
    docker run --rm --network host --user "$RUN_AS" -e HOME=/tmp --entrypoint smbclient -v "$WORK:/x" "$SMB_IMAGE" \
      "$SHARE" -A /x/auth -c "mkdir \"$path\"" >/dev/null 2>&1 || true
  done
}

# Elenco dei file lrc-*.tar.enc in rete, dal più vecchio
remote_list() {
  smb "ls lrc-*.tar.enc" | awk '/\.tar\.enc/ {print $1}' | sort
}

fail() {
  log "COPIA IN RETE FALLITA: $*" >&2
  echo "FAILED $(date -Iseconds) $*" > "$STATUS_FILE"
  raise_alert "backup_offsite_failed" "Copia dei backup in rete fallita" "$* — vedi $BACKUP_DIR/logs"
  exit 1
}

case "${1:-}" in
  --init)
    if [ -z "$KEY" ]; then
      KEY="$(openssl rand -base64 32)"
      printf '\nBACKUP_ENCRYPTION_KEY=%s\n' "$KEY" >> .env
      echo "════════════════════════════════════════════════════════════════"
      echo " Chiave di cifratura generata e salvata in .env:"
      echo
      echo "     $KEY"
      echo
      echo " CONSERVARLA ANCHE FUORI DAL SERVER (gestore password / cassaforte)."
      echo " Senza questa chiave le copie in rete NON si possono aprire."
      echo "════════════════════════════════════════════════════════════════"
    else
      echo "Chiave già presente in .env."
    fi
    smb_mkdirs
    echo "prova" > "$WORK/lrc-test-scrittura.txt"
    out="$(smb "lcd /x; put lrc-test-scrittura.txt; del lrc-test-scrittura.txt")" \
      || { echo "$out"; die "Accesso a $TARGET non riuscito (credenziali o permessi)"; }
    echo "$out" | grep -qiE "NT_STATUS_[A-Z_]*(DENIED|FAIL|BAD|NOT_FOUND|INVALID)" && { echo "$out"; die "Accesso a $TARGET non riuscito"; }
    log "✓ Scrittura in $TARGET riuscita"
    exit 0 ;;
  --list)
    remote_list; exit 0 ;;
  --fetch)
    [ -n "$KEY" ] || die "BACKUP_ENCRYPTION_KEY mancante: inserirla in .env"
    name="${2:-latest}"
    [ "$name" = latest ] && name="$(remote_list | tail -n1)"
    [ -n "$name" ] || die "Nessuna copia trovata in $TARGET"
    log "Scarico $name..."
    smb "lcd /x; get \"$name\"; get \"$name.sha256\"" >/dev/null
    (cd "$WORK" && sha256sum --quiet -c "$name.sha256") || die "Checksum NON valido: copia danneggiata"
    mkdir -p "$BACKUP_DIR/manual"
    LRC_KEY="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:LRC_KEY \
      -in "$WORK/$name" | tar -xf - -C "$BACKUP_DIR/manual" || die "Decifratura fallita (chiave sbagliata?)"
    log "✓ Copia ripristinata in $BACKUP_DIR/manual/ — ora: scripts/backup/restore.sh latest"
    exit 0 ;;
  ""|-*) die "Uso: offsite.sh --init | --list | --fetch [latest|file] | <cartella-backup>" ;;
esac

# ─── Copia di una cartella di backup ─────────────────────────────
SRC="$(realpath "$1")"
[ -d "$SRC" ] && [ -f "$SRC/SHA256SUMS" ] || fail "cartella di backup non valida: $SRC"
[ -n "$KEY" ] || fail "BACKUP_ENCRYPTION_KEY mancante (eseguire scripts/backup/offsite.sh --init)"

kind="$(basename "$(dirname "$SRC")")"
name="lrc-${kind}-$(basename "$SRC").tar.enc"
log "Copia cifrata in rete: $name → $TARGET"

tar -C "$(dirname "$SRC")" -cf - "$(basename "$SRC")" \
  | LRC_KEY="$KEY" openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:LRC_KEY -out "$WORK/$name" \
  || fail "cifratura non riuscita"
(cd "$WORK" && sha256sum "$name" > "$name.sha256")
size="$(stat -c %s "$WORK/$name")"

smb_mkdirs
out="$(smb "lcd /x; put \"$name\"; put \"$name.sha256\"")" || fail "upload non riuscito: $(echo "$out" | tail -n1)"
echo "$out" | grep -q "NT_STATUS_" && fail "upload non riuscito: $(echo "$out" | grep -m1 NT_STATUS_)"

# Verifica: il file in rete deve avere la stessa dimensione
remote_size="$(smb "ls \"$name\"" | awk -v n="$name" '$1==n {print $3}')"
[ "$remote_size" = "$size" ] || fail "verifica non riuscita: in rete ${remote_size:-?} byte, attesi $size"
log "  ✓ caricato e verificato ($(numfmt --to=iec "$size" 2>/dev/null || echo "$size B"))"

# Rotazione in rete: restano le ultime $KEEP copie
mapfile -t files < <(remote_list)
excess=$(( ${#files[@]} - KEEP ))
if [ "$excess" -gt 0 ]; then
  for old in "${files[@]:0:$excess}"; do
    smb "del \"$old\"; del \"$old.sha256\"" >/dev/null && log "  rimossa in rete $old"
  done
fi

echo "OK $(date -Iseconds) $name" > "$STATUS_FILE"
resolve_alert "backup_offsite_failed" "Copia in rete OK: $name"
