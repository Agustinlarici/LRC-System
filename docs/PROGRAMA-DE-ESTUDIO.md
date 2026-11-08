# Programa de estudio — LRC System

Objetivo: poder **operar, vigilar y recuperar** el sistema sin ayuda.
Programar cambios nuevos es otro nivel (Clase 9, opcional).

Tiempo estimado: 1 clase ≈ 1–2 h. Total clases 1–8 ≈ 2 semanas a ritmo tranquilo.

---

## Clase 1 — El mapa: qué es el sistema

**Idea:** el sistema son 4 programas que hablan entre sí, corriendo en un servidor Ubuntu.

```
Navegador (PC/tablet de fábrica)
        │
   FRONTEND  (lo que se ve: páginas)      puerto 3000
        │
   BACKEND   (la lógica: reglas, cálculos) puerto 3001
        │
   BASE DE DATOS (donde se guardan los datos) PostgreSQL
```

Más: el backend lee datos de otros sistemas de la empresa:
- **Business Central** (artículos, sincroniza 03:00)
- **WebThron** (datos de monitores de máquinas)
- **Osti** (empleados RRHH, solo lectura)

**Vocabulario:**
| Palabra | Significa |
|---|---|
| Servidor | La computadora Ubuntu donde corre todo |
| Frontend | Las pantallas |
| Backend / API | El "cerebro" que responde al frontend |
| Base de datos | Un Excel gigante y ordenado (tablas) con todo guardado |
| PostgreSQL | El programa que maneja esa base de datos |
| Producción | El sistema real que usa la fábrica |

**Ejercicio:** abrir el sistema, y por cada módulo del menú (tickets, HR, EDI, Ferrari, monitor, etc.) decir con tus palabras para qué sirve y quién lo usa.

---

## Clase 2 — Docker (la caja donde vive cada programa)

**Idea:** Docker mete cada programa en una "caja" (*contenedor*) con todo lo que necesita. Así funciona igual en cualquier máquina.

Archivo clave: `docker-compose.yml` = la lista de cajas. Las que tenés:

| Contenedor | Qué es |
|---|---|
| `db` | PostgreSQL (la base de datos) |
| `migrate` | Corre una vez, actualiza la estructura de la base y termina |
| `backend` | La lógica |
| `frontend` | Las pantallas |
| `nginx` | Da acceso seguro (HTTPS) a las tablets (puertos 3443/3444) |
| `adminer` | Pantalla web para mirar la base de datos (puerto 8888) |

**Comandos que tenés que saber (en el servidor):**
```bash
docker ps                      # qué cajas están encendidas
docker compose logs -f backend # ver qué dice el backend en vivo (Ctrl+C sale)
docker compose ps              # estado de todas
```

**Ojo:** nunca `docker compose up` ni `git pull` a mano en producción. Solo `./deploy.sh` (Clase 6).

**Ejercicio:** en el servidor, correr `docker ps` y reconocer cada contenedor de la tabla.

---

## Clase 3 — Base de datos (PostgreSQL) sin miedo

**Idea:** una base de datos = tablas (como hojas de Excel) con filas y columnas. SQL es el idioma para pedirle cosas.

```sql
SELECT * FROM tickets LIMIT 10;      -- mirar 10 filas (solo lee, seguro)
SELECT count(*) FROM tickets;        -- contar
```
- `SELECT` = leer (seguro). `UPDATE` / `DELETE` / `DROP` = **cambian o borran** (peligroso).
- **Regla de oro:** en producción solo `SELECT`. Si hay que modificar datos: backup antes, y pedir revisión.

**Cómo mirarla:** Adminer en `http://IP-del-servidor:8888` (usuario/clave en `.env`). Solo mirar.

**Migraciones** (muy importante, lee `db/README.md`):
- La estructura de la base (qué tablas existen) se cambia con archivos numerados en `db/migrations/` (0001, 0002 … 0089).
- Cada archivo se aplica **una sola vez**. **Nunca editar uno ya existente**: el deploy se frena. Para corregir → archivo nuevo.
- Hoy hay ~89 migraciones. Los nombres cuentan la historia: `0036_audit-log`, `0044_device-auth`, etc.

**Ejercicio:** entrar a Adminer, abrir la tabla de tickets, ver columnas y 10 filas. No tocar nada.

---

## Clase 4 — Backend: qué hace por dentro (solo leer)

**Idea:** no hace falta programar; hace falta saber **dónde mirar**.

Carpeta `backend/src/modules/` — una carpeta por módulo: `tickets`, `hr`, `edi`, `ferrari`, `monitor`, `packing`, `qualita`, `webddt`, `spma`, etc. Si algo falla en "EDI", se mira `modules/edi`.

Otras piezas:
| Archivo/carpeta | Para qué |
|---|---|
| `app.ts`, `index.ts` | Arranque del backend |
| `scheduler.ts` | **Tareas automáticas** con horario (ver abajo) |
| `middleware/` | Controles de login/permisos antes de cada pedido |
| `edi_generators/` | Genera archivos EDI para clientes (Ferrari, Audi, McLaren) — **no tocar sin confirmar** |
| `ia/` | Conexión con la IA (Anthropic) |

**Tareas automáticas (`scheduler.ts`):** hay ~12 relojes. Ejemplos: 00:05, 01:00, 02:00, 03:00 (sync Business Central), cada 10 min, cada minuto, 06/10/14/18 h. Un horario cron se lee `minuto hora día mes díaSemana`; `*/10 * * * *` = cada 10 minutos.

**Ejercicio:** abrir `scheduler.ts` y anotar qué hace cada tarea y a qué hora.

---

## Clase 5 — Frontend y diseño (solo leer)

- `frontend/src/app/` — una carpeta por página (`tickets`, `hr`, `monitor`, `mappa`…).
- Diseño con tokens y componentes unificados (reglas en `CLAUDE.md`, sección "Design del frontend").
- **Pantallas kiosk** (monitores de fábrica, tablets): **no cambiar su aspecto**.
- Si una pantalla "se ve rota": 1) F12 → pestaña *Console* para ver errores, 2) probar otro navegador, 3) mirar logs del backend.

**Ejercicio:** abrir una página en el navegador, F12 → Network, recargar, ver a qué direcciones `:3001` llama. Eso es el frontend pidiéndole al backend.

---

## Clase 6 — Deploy: actualizar producción sin romper

**Idea:** el código vive en GitHub; el servidor usa la rama `dev`. Se actualiza **solo** con:

```bash
./deploy.sh update     # backup → trae código → migra base → construye → cambia → verifica
./deploy.sh rollback   # vuelve a la versión anterior
./deploy.sh logs       # ver logs
./deploy.sh stop | restart
```

Qué hace `update` por dentro: (1) backup automático, (2) migraciones, (3) control de "drift" (que la base real = migraciones), (4) construye imágenes nuevas, (5) cambia sin cortar el servicio, (6) verifica `/health`.

**Si falla:** leer el mensaje (casi siempre dice qué hacer). Si el sistema anda mal después: `./deploy.sh rollback`.

**Flujo de cambios (GitHub):** branch nuevo → Pull Request a `dev` → CI en verde (chequeos automáticos en `.github/workflows/ci.yml`) → merge → deploy. Nunca commit directo a `dev`.

**Ejercicio:** en GitHub, abrir un PR cualquiera y reconocer los chequeos de CI (backend, frontend, migraciones).

---

## Clase 7 — Backups y desastre (la clase más importante)

Leer completo: `docs/DISASTER-RECOVERY.md`.

**Idea:** si el servidor muere, los backups te salvan. Ya están automatizados:
- 02:30 backup diario (7 diarios, 4 semanales, 12 mensuales).
- Domingo: restauración de prueba automática (comprueba que el backup sirve).
- Copia cifrada en red (`offsite`).
- Objetivo: perder como máximo 1 día de datos (RPO) y recuperar en ~30 min (RTO).

**Qué revisar vos, cada semana:**
```bash
cat /srv/lrc-backups/last-backup.status /srv/lrc-backups/last-verify.status
```
y la página **Sistema** del programa (muestra alertas de backup, disco, contenedores caídos).

**Ejercicio (el más valioso del curso):** hacer un *ensayo de ripristino* siguiendo el documento, en una máquina de prueba, nunca en producción. Un backup que nunca restauraste es una suposición.

---

## Clase 8 — Cuando algo se rompe (diagnóstico)

Siempre en este orden:

1. **¿Qué ve el usuario?** (pantalla en blanco, error, lento, no entra)
2. **Página Sistema** del programa: ¿hay alertas?
3. `docker compose ps` → ¿hay un contenedor caído?
4. `docker compose logs --tail 100 backend` → ¿qué error aparece?
5. Disco lleno: `df -h` (>90% = problema)
6. Reiniciar lo mínimo: `./deploy.sh restart`
7. Si fue después de un deploy: `./deploy.sh rollback`
8. Si no sabés: **no tocar la base de datos**; copiar el error y pedir ayuda (a Claude Code o al desarrollador).

| Síntoma | Primer sospechoso |
|---|---|
| Nadie entra | `frontend`/`backend` caído, o disco lleno |
| Datos no actualizan | tarea del `scheduler`, o conexión a Business Central / WebThron / Osti |
| Monitores fábrica en negro | backend, o WebThron |
| Tablet no instala la app | `nginx` / certificados en `certs/` (vencimiento) |
| Deploy se frena | migración modificada o *drift*; leer el mensaje |

---

## Clase 9 (opcional) — Modificar cosas con Claude Code

Si querés cambiar el sistema sin saber programar, el método seguro ya está en `CLAUDE.md`:
rama nueva → controles (`type-check`, tests, lint) → PR → CI verde → merge → deploy.
Reglas: leé qué te propone antes de aceptar; no aprobar cambios en backup, deploy, EDI ni `.env` sin entender.

---

## Qué NO tocar nunca (resumen)
- `.env` (claves): no compartir, no subir a GitHub.
- Migraciones ya existentes.
- `deploy.sh`, `scripts/backup/`, `docker-compose.yml`, `edi_generators/`.
- Comandos `DELETE`/`DROP`/`UPDATE` en la base real.

## Glosario rápido
- **Repo:** carpeta del código en GitHub. **Branch:** copia de trabajo. **PR:** pedido de unir cambios.
- **CI:** chequeos automáticos. **Log:** diario de lo que hace un programa.
- **Contenedor:** caja Docker. **Migración:** cambio versionado de la base.
- **Cron:** horario de tareas automáticas. **HTTPS/certificado:** candado seguro (vence).

## Orden recomendado
1 → 2 → 3 → 7 → 8 → 6 → 4 → 5 → 9. (Backups y diagnóstico primero: protegen la fábrica.)
