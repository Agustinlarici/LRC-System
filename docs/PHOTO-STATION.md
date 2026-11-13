# Photo Station — ordini di foto (VM ↔ PC Camere)

Stato: **tratto iKnow→VM→PC Camere→VM implementato**. Falta: la chiamata iKnow (ancora non definita) e il tratto
PC IA (Vision AI, sin PC para probarlo).

## Flujo

```
iKnow ──API──▶ VM (LRC-System)  ◀──claim (cada 3 s)── PC Camere (Photo Station)
                  │ cola photo_jobs                        │ saca las fotos
                  │ ◀────── PUT foto (hash SHA-256) ───────┘
                  │ ◀────── complete (ok / partial / failed)
                  ▼
        (siguiente fase) VM ──▶ PC IA (Vision AI) ──▶ resultado ──▶ VM ──▶ usuario
```

- **Quien llama a quien:** la PC Camere llama siempre a la VM (HTTP saliente; ningún puerto abierto en la PC Windows).
  La cola vive en la VM: si la PC está apagada el pedido espera; si cae a mitad, vuelve a la cola a los 5 min
  (3 intentos y pasa a `failed`). Para la PC IA se mantiene la decisión de `FERRARI-CONNESSIONE-IA.md`
  (la VM llama a la PC IA).
- **Las fotos viajan a la VM** (no solo OneDrive): la VM es el único punto que ve todo; Photo Station sigue
  guardando su copia local/OneDrive como siempre.
- **Estados** de `photo_jobs.status`: `pending → claimed → captured` (o `failed`/`cancelled`); `analyzing`/`done`
  reservados para la fase PC IA. Un solo pedido abierto por commessa (409 si se repite).

## Cómo probarlo hoy (sin iKnow)

1. Admin → Impostazioni sistema: dar el permiso `Photo Station` a quien corresponda (el admin ya lo tiene).
2. Menú **Photo Station → Stazioni → Crea**: se muestra el token **una sola vez**.
3. En la PC Camere, en `%APPDATA%\STRVision\settings.json`: `vm_enabled: true`, `vm_url`, `vm_token`.
4. En la VM, escribir una commessa y **Scatta foto**: la PC Camere dispara sola, sube las fotos y se ven en la lista.

## API

Usuarios (cookie de sesión, módulo `photo_station`; escrituras requieren `can_manage`):

| Ruta | Qué hace |
|---|---|
| `GET /api/photo-station/jobs` · `GET /jobs/:id` | lista / detalle con fotos |
| `POST /jobs {commessa}` | crea el pedido (409 si ya hay uno abierto) |
| `POST /jobs/:id/cancel` · `/retry` | anula / reencola (failed, cancelled) |
| `GET /jobs/:id/files/:fileId` | la foto (image/jpeg) |
| `GET/POST /stations` · `POST /stations/:id/revoke` | estaciones; el token se muestra solo al crear |

Estación (`Authorization: Bearer <token>`, solo hash en la DB), prefijo `/api/photo-station/device`:

| Ruta | Qué hace |
|---|---|
| `POST /claim` | devuelve `{job:{id,commessa}}` o `{job:null}`; sirve de "estoy vivo"; reentrega su propio pedido si la app se reinició |
| `PUT /jobs/:id/photos/:camera` | cuerpo = JPEG crudo (máx 25 MB, validado); responde `sha256` calculado por la VM |
| `POST /jobs/:id/complete {status, photos:[{camera,sha256}], errors}` | 409 con `missing` si alguna foto no llegó igual; el pedido sigue abierto |
| `POST /jobs/:id/fail {error}` | la estación no pudo ni intentar (ej. sin cámaras) |

## Cuando llegue la llamada de iKnow

Solo hay que crear el pedido con `source = 'iknow'` y `external_ref` (idempotencia: `UNIQUE (source, external_ref)`).
Hace falta decidir **cómo se autentica iKnow** (token de máquina propio, igual que las estaciones; no una sesión de
usuario) — **no implementado a propósito** hasta conocer la llamada. El resto del flujo no cambia.

## Fase PC IA (pendiente)

Con `captured`, la VM enviará las fotos a Vision AI (`POST /api/groups/...` ya existe en Vision AI para analizar un
grupo de fotos de un mismo paragolpes) y guardará el resultado; hoy Vision AI no tiene una API "máquina a máquina" con
token ni devuelve resultado por pedido: eso hay que definirlo cuando haya PC para probar.

## Operación

- Fotos en `UPLOAD_DIR/photo-station/<id>/CAMxx.jpg` (volumen `TICKETS_UPLOADS_HOST`, ya existente). **No hay
  limpieza automática**: ~2-4 MB × cámaras × pedidos; hay que decidir retención.
- Tokens: revocar desde la página si se pierde una PC.
