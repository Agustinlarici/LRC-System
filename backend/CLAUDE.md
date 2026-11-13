# Backend — regole per le sessioni

Hono + TypeScript, PostgreSQL (`postgres`), validazione con `zod`. Moduli in `src/modules/<nome>/`.

## Convenzioni

- Un modulo nuovo segue la struttura di uno esistente (route, validazione, test in `__tests__/`).
- Input sempre validato con `zod` (`parseBody` in `src/lib/validate.ts`); query SQL sempre parametrizzate,
  mai concatenare stringhe con dati dell'utente.
- Errori e log tramite gli strumenti esistenti (`middleware/error-handler.ts`, `lib/logger.ts`,
  `lib/audit.ts` per le azioni da tracciare): niente `console.log`.
- Auth e permessi (`lib/auth.ts`): ruoli `guest | operator | it | admin`; permessi per modulo con
  `can_view` / `can_manage`. Rotte protette con `requireAuth`, `requireModule('x')` (vedere),
  `requireManage('x')` (modificare). Una rotta nuova non va mai senza controllo di accesso;
  le scritture (POST/PUT/PATCH/DELETE) usano `requireManage`, non solo `requireModule`.
- Un nuovo modulo = nuovo `ModuleKey` in `auth.ts` + permessi nel DB (migrazione) + rotte protette.
- Rotte pubbliche solo se la richiesta lo dice esplicitamente; in quel caso `getOptionalUser` e
  nessun dato sensibile nella risposta.
- Non fidarsi dell'input: validare con `zod`, limitare dimensioni e tipi dei file caricati
  (`lib/mime-check.ts`), mai costruire percorsi file con dati dell'utente.
- Mai restituire campi sensibili (hash password, token, stipendi) se non servono: scegliere le
  colonne, niente `SELECT *` su tabelle utenti/HR.
- Segreti solo da variabili d'ambiente (`JWT_SECRET` ecc.), mai nel codice né nei log.
- Azioni sensibili (login, cambi permessi, dati HR, cancellazioni) → `auditLog` (`lib/audit.ts`).
- Il rate limit del login (`middleware/rate-limit.ts`) e gli header di `app.ts` non si indeboliscono.
- Mai creare/alterare tabelle dal codice: vedi `db/CLAUDE.md`.
- Un bug corretto = un test che lo riproduce.

## Generatori EDI — confermare sempre con l'utente

`backend/edi_generators/` produce file che arrivano ai clienti (Ferrari, Audi, McLaren).
Ogni cambio va confermato prima, con un esempio di file prima/dopo.

## Controlli

```bash
cd backend && npm run type-check && npm test
```
