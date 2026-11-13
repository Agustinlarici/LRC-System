# Frontend — regole per le sessioni

Il design è unificato con token e componenti. **Non usare colori Tailwind diretti** (`gray-*`,
`blue-*`, `red-*`...) né `rounded-lg/xl` nelle pagine nuove o migrate: usare i token.

- **Token** in `frontend/tailwind.config.ts`: `brand` (rosso STR: solo marchio e contatori; la voce attiva del menu è celeste `accent`), `ink` (grigio scuro = azione primaria, come il menu), `accent` (celeste:
  evidenziazioni, focus, info; per il testo `accent-ink`), `canvas`, `line`, `muted` (testo
  secondario), `success/warning/danger/info`, raggi `rounded-card`/`rounded-ctl`, ombre
  `shadow-card`/`shadow-float`. Il rosso STR **non** indica errori: per quelli c'è `danger`.
- **Font**: Inter, file locale in `src/app/fonts` (nessun download da Google).
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


## Buone pratiche

- Prima di una pagina nuova, guardare una già migrata e copiarne la struttura (`PageHeader`, `Tabs`,
  card con filtri + tabella, skeleton, `EmptyState`).
- Chiamate API solo tramite `src/lib/api.ts`; niente URL scritti a mano.
- Eseguire `npm run type-check && npm run lint` e dire l'esito prima di proporre il commit.
- Per ogni cambio visivo: controllo con Playwright e, se la pagina è stampabile, anche il PDF.
- Sicurezza: niente segreti o chiavi in codice frontend né in variabili `NEXT_PUBLIC_*`; evitare
  `dangerouslySetInnerHTML` (se serve, chiedere); nascondere una voce di menu per permesso è solo UX,
  il controllo reale è nel backend. Nessun dato reale di persone/clienti in screenshot o fixture.
