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

## Fases (iKnow)

iKnow manda **fases** (`delibera_finale`, `delibera_finale_proximiti`, ...). Cada fase es una cola independiente con
sus estaciones: una estación solo recibe pedidos de las fases que se le habilitaron (sin fases = no recibe nada).
La misma commessa puede tener un pedido abierto **por fase**. Cada fase corre su propia instalación de Photo Station
(token y `settings.json` propios: cámaras, resolución, nombres). Lo que difiere en el *flujo* de cada fase
(cuántas fotos, qué se analiza) todavía no está definido: la VM solo enruta; el análisis por fase se define con la PC IA.
Las fases se crean en la página (código = el que manda iKnow) y no se aceptan pedidos de fases desconocidas o desactivadas.

## Cómo entran los pedidos desde iKnow

**Selector de origen** (página Photo Station → Collegamento iKnow): *Spento / Database (copia) / Chiamata API*,
una sola a la vez. Por defecto **Spento**. Con «API», la copia deja de leer; con «Database» o «Spento» la llamada de
iKnow se responde 200 pero **se ignora** (no se crea nada; la página cuenta las llamadas ignoradas para que no pasen
inadvertidas). Los pedidos manuales de la página funcionan siempre. Para pasar a «API» hace falta haber cargado el token;
para «Database», haber elegido los esiti.

Dos vías, **la misma función** (`events.ts`), así que pasar de una a otra no cambia nada ni duplica pedidos
(clave de idempotencia = seriale + commessa + fase + componente + data_ora al segundo; no incluye la versione ni el origen):

1. **API (definitiva)** — la llamada que pedimos a la empresa:
   `POST http://<VM>:3000/api/delibere/accettate`, `Authorization: Bearer <token>`, body
   `{seriale, commessa, fase, componente, versione, data_ora}`. El puerto 3000 funciona porque Next.js ya hace proxy de
   `/api/*` al backend. Respuestas: **200** siempre que el cuerpo sea válido (también duplicado, o fase aún no
   configurada: queda un pedido *anulado* con el motivo, visible, y se relanza con «Riprova» tras crear la fase);
   401 token errado; 503 token aún no cargado (iKnow reintenta); 400 cuerpo inválido. El token lo elige la empresa:
   se carga en la página (solo se guarda el hash). `data_ora` sin huso horario se interpreta con la hora del servidor.
2. **Copia del DB de iKnow (provisoria)** — `webthron_events_history`, que ya llena el sync de Andon. Cada minuto
   (`feed.ts`) busca eventos recientes con esito «aceptado» y fase del catálogo. **Apagada por defecto**; al encenderla
   se fija `enabled_since` y nunca mira antes (no fotografía el histórico). Hay que elegir qué *esiti* valen como
   «aceptada» (la página muestra los reales de los últimos 7 días). Respeta el interruptor general de iKnow
   (`iknow_enabled`/`iknow_andon_enabled`): con iKnow apagado (p. ej. entorno de desarrollo) no crea pedidos.

**Fase → Photo Station:** cada fase del catálogo tiene un *código* y, opcionalmente, el *nombre exacto en iKnow*
(`DELIBERA FINALE`, `DELIBERA FINALE PROX`); si falta, se usa el nombre normalizado (`delibera_finale`). La estación
habilitada para esa fase es la que recibe el pedido. Cuando llegue la API se apaga la copia y no se cambia nada más.

Límites conocidos: el pedido se crea por evento (seriale+componente); si dos componentes del mismo paragolpes se
aceptan por separado se hacen dos pedidos/series de fotos (falta decidir si conviene agruparlos). Si la `versione`
llega tarde a la copia, el pedido queda con versione vacía.

## Cómo probarlo hoy (sin iKnow)

1. Admin → Impostazioni sistema: dar el permiso `Photo Station` a quien corresponda (el admin ya lo tiene).
2. Menú **Photo Station**: crear las fases (ej. `delibera_finale`), luego **Stazioni → Crea** marcando sus fases: el token se muestra **una sola vez**.
3. En la PC Camere, en `%APPDATA%\STRVision\settings.json`: `vm_enabled: true`, `vm_url`, `vm_token`.
4. En la VM, escribir una commessa, elegir la fase y **Scatta foto**: la PC Camere dispara sola, sube las fotos y se ven en la lista.

## API

Usuarios (cookie de sesión, módulo `photo_station`; escrituras requieren `can_manage`):

| Ruta | Qué hace |
|---|---|
| `GET /api/photo-station/jobs` · `GET /jobs/:id` | lista / detalle con fotos |
| `POST /jobs {commessa, phase}` | crea el pedido (400 fase desconocida; 409 si ya hay uno abierto para commessa+fase) |
| `GET/POST /phases` · `PUT /phases/:key {active}` | catálogo de fases |
| `PUT /stations/:id/phases {phases}` | fases que sirve la estación |
| `POST /jobs/:id/cancel` · `/retry` | anula / reencola (failed, cancelled) |
| `GET /jobs/:id/files/:fileId` | la foto (image/jpeg) |
| `GET/POST /stations` · `POST /stations/:id/revoke` | estaciones; el token se muestra solo al crear |

Estación (`Authorization: Bearer <token>`, solo hash en la DB), prefijo `/api/photo-station/device`:

| Ruta | Qué hace |
|---|---|
| `POST /claim` | devuelve `{job:{id,commessa,phase}}` (solo de sus fases) o `{job:null}`; sirve de "estoy vivo"; reentrega su propio pedido si la app se reinició |
| `PUT /jobs/:id/photos/:camera` | cuerpo = JPEG crudo (máx 25 MB, validado); responde `sha256` calculado por la VM |
| `POST /jobs/:id/complete {status, photos:[{camera,sha256}], errors}` | 409 con `missing` si alguna foto no llegó igual; el pedido sigue abierto |
| `POST /jobs/:id/fail {error}` | la estación no pudo ni intentar (ej. sin cámaras) |


## Fase PC IA (pendiente)

Con `captured`, la VM enviará las fotos a Vision AI (`POST /api/groups/...` ya existe en Vision AI para analizar un
grupo de fotos de un mismo paragolpes) y guardará el resultado; hoy Vision AI no tiene una API "máquina a máquina" con
token ni devuelve resultado por pedido: eso hay que definirlo cuando haya PC para probar.

## Operación

- Fotos en `UPLOAD_DIR/photo-station/<id>/CAMxx.jpg` (volumen `TICKETS_UPLOADS_HOST`, ya existente). **No hay
  limpieza automática**: ~2-4 MB × cámaras × pedidos; hay que decidir retención.
- Tokens: revocar desde la página si se pierde una PC.
