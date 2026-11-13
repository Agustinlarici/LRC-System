# Backend — regole per le sessioni

Hono + TypeScript, PostgreSQL (`postgres`), validazione con `zod`. Moduli in `src/modules/<nome>/`.

## Convenzioni

- Un modulo nuovo segue la struttura di uno esistente (route, validazione, test in `__tests__/`).
- Input sempre validato con `zod` (`parseBody` in `src/lib/validate.ts`); query SQL sempre parametrizzate,
  mai concatenare stringhe con dati dell'utente.
- Errori e log tramite gli strumenti esistenti (`middleware/error-handler.ts`, `lib/logger.ts`,
  `lib/audit.ts` per le azioni da tracciare): niente `console.log`.
- Auth e permessi: usare `lib/auth.ts` come fanno le rotte esistenti (es. `modules/tickets/routes.ts`); una rotta nuova non va mai lasciata senza controllo di accesso.
- Mai creare/alterare tabelle dal codice: vedi `db/CLAUDE.md`.
- Un bug corretto = un test che lo riproduce.

## Generatori EDI — confermare sempre con l'utente

`backend/edi_generators/` produce file che arrivano ai clienti (Ferrari, Audi, McLaren).
Ogni cambio va confermato prima, con un esempio di file prima/dopo.

## Controlli

```bash
cd backend && npm run type-check && npm test
```
