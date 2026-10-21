#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Controllo di salute del server (ogni 15 minuti da cron)
#
# Apre un avviso nella pagina Sistema (system_alerts) quando qualcosa non va
# e lo chiude da solo quando torna a posto:
#   monitor_backup_old      ultimo backup riuscito più vecchio di 26 ore
#   monitor_offsite_old     ultima copia in rete più vecchia di 26 ore (se configurata)
#   monitor_verify_old      ultimo test di ripristino più vecchio di 8 giorni
#   monitor_disk_<mount>    disco oltre l'85% (warning) / 95% (critical)
#   monitor_container_<x>   container db/backend/frontend fermo o non sano
#   monitor_health          /health del backend non risponde "ok"
#
# Uso:  scripts/monitor/health-check.sh          (silenzioso se tutto ok)
#       scripts/monitor/health-check.sh -v       (mostra ogni controllo)
# Soglie modificabili in .env: MONITOR_DISK_WARN=85 MONITOR_DISK_CRIT=95
#   MONITOR_BACKUP_MAX_H=26 MONITOR_VERIFY_MAX_D=8
# Stato: <BACKUP_DIR>/monitor.status (anche se il DB è giù e l'avviso non si può scrivere)
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail     # niente -e: un controllo che fallisce non deve fermare gli altri
source "$(dirname "${BASH_SOURCE[0]}")/../backup/lib.sh"

VERBOSE=0; [ "${1:-}" = "-v" ] && VERBOSE=1
DISK_WARN="$(env_get MONITOR_DISK_WARN 85)"
DISK_CRIT="$(env_get MONITOR_DISK_CRIT 95)"
BACKUP_MAX_H="$(env_get MONITOR_BACKUP_MAX_H 26)"
VERIFY_MAX_D="$(env_get MONITOR_VERIFY_MAX_D 8)"
STATUS="$BACKUP_DIR/monitor.status"
problems=()

ok()   { [ "$VERBOSE" = 1 ] && echo "  ✓ $*"; return 0; }
bad()  {  # key severity title message
  echo "  ✗ $3: $4"
  problems+=("$3")
  raise_alert "$1" "$3" "$4" "$2"
}
good() {  # key message
  resolve_alert "$1" "$2"
}

# Età in ore di un file di stato "OK <data ISO> ..." (vuoto se mai riuscito)
status_age_h() {
  local f="$1" when
  [ -f "$f" ] || return 1
  grep -q '^OK ' "$f" || return 1
  when="$(awk '{print $2}' "$f")"
  echo $(( ( $(date +%s) - $(date -d "$when" +%s) ) / 3600 ))
}

check_age() {  # key file max_ore titolo
  local key="$1" file="$2" max="$3" title="$4" age
  if age="$(status_age_h "$file")" && [ "$age" -le "$max" ]; then
    ok "$title: ${age}h fa"; good "$key" "$title di nuovo regolare"
  else
    bad "$key" critical "$title" "nessun esito positivo nelle ultime ${max}h ($(cat "$file" 2>/dev/null | head -c 120 || echo 'mai eseguito'))"
  fi
}

# ─── 1. Backup ───────────────────────────────────────────────────
check_age monitor_backup_old "$BACKUP_DIR/last-backup.status" "$BACKUP_MAX_H" "Backup giornaliero"
if [ -n "$(env_get BACKUP_OFFSITE_SMB "")" ]; then
  check_age monitor_offsite_old "$BACKUP_DIR/last-offsite.status" "$BACKUP_MAX_H" "Copia dei backup in rete"
fi
check_age monitor_verify_old "$BACKUP_DIR/last-verify.status" $(( VERIFY_MAX_D * 24 )) "Test di ripristino"

# ─── 2. Spazio su disco (progetto, backup, dati docker) ──────────
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
declare -A seen=()
for p in "$LRC_DIR" "$BACKUP_DIR" "$docker_root"; do
  [ -e "$p" ] || continue
  read -r mount pct < <(df -P "$p" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $6, $5}')
  [ -n "${mount:-}" ] || continue
  [ -n "${seen[$mount]:-}" ] && continue; seen[$mount]=1
  key="monitor_disk_$(echo "$mount" | tr -c 'a-zA-Z0-9' '_')"
  if [ "$pct" -ge "$DISK_CRIT" ]; then
    bad "$key" critical "Disco quasi pieno ($mount)" "${pct}% usato (soglia ${DISK_CRIT}%)"
  elif [ "$pct" -ge "$DISK_WARN" ]; then
    bad "$key" warning "Disco in esaurimento ($mount)" "${pct}% usato (soglia ${DISK_WARN}%)"
  else
    ok "disco $mount: ${pct}%"; good "$key" "Spazio su $mount di nuovo sufficiente (${pct}%)"
  fi
done

# ─── 3. Container ────────────────────────────────────────────────
for svc in db backend frontend; do
  st="$(dc ps --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | head -n1)"
  if [[ "$st" == running* ]] && [[ "$st" != *unhealthy* ]]; then
    ok "container $svc: $st"; good "monitor_container_$svc" "Container $svc di nuovo attivo"
  else
    bad "monitor_container_$svc" critical "Container $svc non attivo" "stato: ${st:-assente}"
  fi
done

# ─── 4. Backend /health ──────────────────────────────────────────
h="$(dc exec -T backend wget -qO- -T 15 http://localhost:3001/health 2>/dev/null || true)"
if echo "$h" | grep -q '"status":"ok"'; then
  ok "backend /health ok"; good monitor_health "Backend di nuovo regolare"
elif echo "$h" | grep -q '"status":"degraded"'; then
  # degraded = PostgreSQL ok ma un sistema esterno (WebThron) non raggiungibile
  bad monitor_health warning "Backend con un servizio esterno non raggiungibile" "$(echo "$h" | head -c 200)"
else
  bad monitor_health critical "Backend non risponde" "${h:-nessuna risposta da /health}"
fi

# ─── Esito ───────────────────────────────────────────────────────
if [ "${#problems[@]}" -eq 0 ]; then
  echo "OK $(date -Iseconds)" > "$STATUS"
  [ "$VERBOSE" = 1 ] && echo "Tutto regolare."
  exit 0
fi
{ echo "PROBLEMI $(date -Iseconds)"; printf '%s\n' "${problems[@]}"; } > "$STATUS"
exit 1
