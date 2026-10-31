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
5. Merge: solo quando l'utente lo chiede esplicitamente (es. "mergealo") **e** tutti i
   controlli della CI sono verdi; se uno è rosso, non fare il merge e spiegare cosa fallisce.
   Il deploy lo fa sempre l'utente sul server con `./deploy.sh update`.

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

## Design del frontend (nuovo design system)

Il design è unificato con token e componenti. **Non usare colori Tailwind diretti** (`gray-*`,
`blue-*`, `red-*`...) né `rounded-lg/xl` nelle pagine nuove o migrate: usare i token.

- **Token** in `frontend/tailwind.config.ts`: `brand` (rosso STR: solo marchio, voce attiva del
  menu, contatori), `ink` (grigio scuro = azione primaria, come il menu), `accent` (celeste:
  evidenziazioni, focus, info; per il testo `accent-ink`), `canvas`, `line`, `muted` (testo
  secondario), `success/warning/danger/info`, raggi `rounded-card`/`rounded-ctl`, ombre
  `shadow-card`/`shadow-float`. Il rosso STR **non** indica errori: per quelli c'è `danger`.
- **Font**: Outfit, file locale in `src/app/fonts` (nessun download da Google).
- **Componenti** in `src/components/ui/`: `PageHeader` (un solo H1 per pagina: `back`, `title`,
  `badge`, `description`, `actions` — l'azione principale per ultima, a destra), `Button`,
  `StatusBadge`, `Tabs` (solapas standard, con contatori), `EmptyState`, `CountUp`, `Skeleton`/
  `SkeletonTable`. Classi globali in `globals.css`: `.btn-primary/.btn-secondary/.btn-danger`,
  `.card`, `.input`, `.label`, `.badge-*`, tabelle fogli `.sheet-th/.sheet-td/.sheet-sticky`.
  `.input` non è in `@layer`: per sovrascriverla servono le classi con `!`.
- **Regole di pagina**: titolo e azioni sempre con `PageHeader`; solapas sempre con `Tabs`;
  filtri e tabella nella stessa card; stati con `StatusBadge`; caricamento con skeleton; vuoti con
  `EmptyState`; niente emoji (icone SVG). Impostazioni resta com'era: modulo "Sistema" del gruppo IT
  e pulsante Impostazioni di ogni modulo (con ingranaggio: `group-gear` + `<IconSettings className="gear ..."/>`).
- **Microinterazioni**: brevi, solo con hover, disattivate con "riduci movimento". Classi `.nudge`,
  `.nudge-x`, `.nudge-icon`, `.group-gear`, `.animate-pageIn` (`app/template.tsx`).
- **Schermate kiosk — NON cambiare il loro aspetto**: andon a schermo intero (`/monitor/<n>`,
  resumen e parate per numero), mappa fullscreen/maranello, modalità tablet (`/qualita/tablet`,
  `/…/tablet`), Packing di reparto (spedizione, operatore, scan, tablet) e `/device-pair`. Sono
  elencate in `src/lib/kiosk.ts` (`KIOSK_PATTERN`); lì `html.legacy-ui` ripristina font e classi
  globali originali. Una nuova schermata kiosk va aggiunta a quel pattern e non va migrata.
- **Stampa**: i fogli stampabili (`.print-a4`, `d-print-none`, `only-print`, `.sheet-*`) devono
  restare uguali in stampa (griglia a bordi pieni). Verificare generando il PDF (`page.pdf` con
  `emulateMedia({ media: 'print' })`).
- **Come migrare un modulo**: (1) branch nuovo da `dev`; (2) sostituire i colori Tailwind con i
  token (gray→`stone`/`muted`/`ink`, blue→`accent`/`ink`, green/yellow/red→`success`/`warning`/
  `danger`); (3) intestazioni con `PageHeader`, solapas con `Tabs`, badge con `StatusBadge`;
  (4) `type-check` e `lint`; (5) controllo visivo con Playwright (già installato) simulando le API
  con `page.route('**:3001/**')` e `next dev` su una porta libera; (6) PR verso `dev`. Per
  fermare `next dev` usare `pkill -f "[n]ext-server"` (le parentesi evitano di uccidere la propria shell).
- **Vetro/trasparenze (Liquid Glass)**: scartato di proposito. Non aggiungerlo.

## Documenti utili

- `db/README.md` — migrazioni
- `docs/DISASTER-RECOVERY.md` — backup, ripristino, procedure di emergenza
