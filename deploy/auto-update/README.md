# Auto-update del sistema operativo (Ubuntu)

Sistema automatico de actualización, backup y reinicio del **servidor Ubuntu**
donde corre LRC-System. No es parte de la aplicación: corre a nivel de sistema
operativo, separado del stack Docker.

Como `docker-compose.yml` ya usa `restart: unless-stopped`, tras un reinicio
del SO los contenedores de LRC-System vuelven a levantar solos (siempre que
Docker esté habilitado como servicio, que es el comportamiento por defecto).

## Qué hace

Cada noche (03:00 por defecto), `update-system.sh`:

1. Verifica espacio en disco y que los servicios críticos (`docker`, `ssh`)
   estén activos. Si algo ya está mal, aborta sin tocar nada.
2. Corre un dry-run (`apt-get -s upgrade`) y lo deja logueado.
3. Hace backup de `/etc` (tar) y guarda la lista exacta de versiones de
   paquetes instalados.
4. Aplica las actualizaciones:
   - `UPDATE_MODE=security` (default): solo parches de seguridad, vía
     `unattended-upgrades`.
   - `UPDATE_MODE=full`: todas las actualizaciones disponibles.
5. Healthcheck: revisa que los servicios críticos sigan activos (y,
   opcionalmente, un endpoint HTTP tuyo).
6. Si el healthcheck falla → rollback automático de paquetes a las versiones
   previas (usando la lista guardada en el paso 3) y **no reinicia**.
7. Si todo salió bien y el sistema pide reinicio (ej. nuevo kernel) →
   reinicia. Si no hace falta reinicio, no reinicia.
8. Limpia backups y logs de más de 14 días (configurable).

Todo queda registrado en `/var/log/auto-update/`. No manda notificaciones
externas (elegiste solo log local) — conviene revisar el log de vez en
cuando o, más adelante, agregar un webhook si querés alertas.

## Instalación (en el servidor Ubuntu, como root)

```bash
# copiar esta carpeta al servidor, ej. vía scp/git pull
cd deploy/auto-update
sudo bash install.sh
```

Esto instala los scripts en `/usr/local/bin/auto-update/`, la config en
`/etc/default/auto-update`, y activa un `systemd timer` que corre todas las
noches a las 03:00 (con hasta 10 min de jitter aleatorio).

## Configuración

Editar `/etc/default/auto-update` en el servidor (no el archivo del repo):

```bash
sudo nano /etc/default/auto-update
```

Variables clave:

- `UPDATE_MODE=security|full` — hoy dejalo en `security`; cuando quieras
  pasar a actualizar todo, cambialo a `full` y ya está, no hay que tocar
  scripts.
- `CRITICAL_SERVICES="docker ssh"` — agregá otros servicios si tenés (ej. un
  reverse proxy nginx fuera de Docker).
- `HEALTHCHECK_URL=""` — si tu backend expone `/health` (lo hace, según
  `deploy.sh`), podés poner algo como
  `HEALTHCHECK_URL="http://localhost:3001/health"` para que el healthcheck
  también valide que la app responde, no solo que Docker esté activo.

## Probarlo sin esperar a la noche

```bash
sudo systemctl start auto-update.service
sudo journalctl -u auto-update.service -f
```

Revisá el log generado en `/var/log/auto-update/update-*.log`.

## Ver el estado

```bash
systemctl status auto-update.timer
systemctl list-timers auto-update.timer   # próxima ejecución programada
```

## Rollback manual

Si necesitás forzar un rollback a mano (por ejemplo, algo falló y no se
disparó solo):

```bash
sudo bash /usr/local/bin/auto-update/rollback.sh
# o especificando un backup puntual:
sudo bash /usr/local/bin/auto-update/rollback.sh /var/backups/auto-update/pkgs-versions-2026-09-23_030000.txt
```

## Limitación importante

Sin snapshot de disco (LVM/Btrfs/ZFS o snapshot de infraestructura cloud),
el rollback automático solo cubre **paquetes** (reinstala las versiones
exactas previas) y deja un backup de `/etc` para restaurar configuración a
mano si hiciera falta algo más profundo. Es un nivel de seguridad razonable
para actualizaciones de sistema, pero no es un "deshacer todo" garantizado
al 100%. Si en el futuro migrás a un disco con LVM o a un volumen cloud,
conviene sumar un snapshot real antes del paso 4 (backup) — avisame y lo
agregamos.

## Desinstalar

```bash
sudo systemctl disable --now auto-update.timer
sudo rm /etc/systemd/system/auto-update.{service,timer}
sudo rm -rf /usr/local/bin/auto-update
sudo systemctl daemon-reload
```

(Los backups en `/var/backups/auto-update` y logs en `/var/log/auto-update`
no se borran solos; borralos a mano si ya no los necesitás.)
