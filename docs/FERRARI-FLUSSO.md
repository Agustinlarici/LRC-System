# Validazione Excel Ferrari — flusso completo (bozza v0.1)

Stato: **bozza da approvare**. Questo file e' identico in `STR-LocalAI/docs/ferrari/FLUSSO.md`
e `LRC-System/docs/FERRARI-FLUSSO.md`: se cambia uno, cambia l'altro.

## 1. Principi

1. **Due analisi indipendenti.** La VM (senza IA) e la PC IA analizzano *ciascuna per conto proprio*
   lo stesso Excel. Nessuna delle due vede il risultato dell'altra prima del confronto.
2. **La VM e' la fonte di verita'.** L'output della IA e' un dato non fidato: entra solo come
   "seconda opinione" da confrontare. Cio' che la IA dice deve avere un'**evidenza** (cella + citazione
   testuale) che la VM puo' verificare nell'originale.
3. **Niente apprendimento automatico.** Le correzioni umane diventano *proposte*; diventano regole/esempi
   solo dopo approvazione di un supervisore, e viaggiano in un **pacchetto di conoscenza versionato**.
4. **Il trasporto e' intercambiabile.** Cartella condivisa, USB, OneDrive o rete: il contenuto e' sempre
   lo stesso **bundle** (zip + manifest firmato). Cambiare trasporto non cambia il sistema.
5. **Originali immutabili e storico completo** (append-only).

## 2. Attori e sistemi

| Attore | Dove | Ruolo |
|---|---|---|
| Ferrari | esterno | Invia gli Excel |
| VM Ubuntu (LRC-System, sezione IT) | dominio, rete interna | Ricezione, normalizzazione, analisi deterministica, confronto, revisione, risultato, storico |
| PC IA (STR-LocalAI) | fuori dominio (oggi anche fuori sede) | Analisi con IA locale (Ollama) |
| Operatore | UI su VM | Rivede/corregge le discrepanze |
| Supervisore | UI su VM | Approva regole/esempi e casi sensibili |

La PC IA **non** riceve mai credenziali di dominio ne' accede al DB della VM. Non esiste un canale
VM -> PC IA iniziato dalla VM.

## 3. Flusso

```
Ferrari --Excel--> [VM] 1 Ricezione: originale read-only + SHA-256
                        2 Normalizzazione: Excel -> JSON canonico (celle, coordinate, nascoste, formule)
                        3 Analisi deterministica (parole chiave, tabelle, regole STR)  --------+
                        4 Bundle "to-ai"  ==(trasporto)==>  [PC IA] 5 Analisi IA                 |
                                                                  modello, codici, testo libero |
                                                                  -> JSON con evidenze          |
                        6 Bundle "from-ai" <==(trasporto)==         |                           |
                        7 Verifica evidenze + schema                                            |
                        8 Confronto IA vs deterministica  <-------------------------------------+
                           |- VERDE  -> accettato in automatico
                           |- AMBRA/ROSSO -> coda di revisione
                        9 Revisione operatore (decisione registrata)
                       10 Proposte di regola/esempio -> approvazione supervisore
                       11 Bundle "knowledge" vN ==(trasporto)==> [PC IA] (esempi, dizionario)
                       12 Schermata risultato finale + consulta + storico
```

### Passi

1. **Ricezione.** Copia dell'originale in archivio read-only, SHA-256, record `ferrari_file`. Se l'hash esiste gia' -> *duplicato* (nessuna rielaborazione). Se il nome/ordine coincide con un file precedente ma l'hash cambia -> *nuova versione*, la precedente resta collegata e archiviata.
2. **Normalizzazione (VM).** Il file Ferrari e' un `.xls` binario (BIFF8). Non va mai alla IA come file Excel. Si genera un JSON canonico: per ogni cella `sheet, row, col, addr, value, type, hidden, formula`; fogli nascosti, macro, celle unite e formule vengono segnalati. Struttura e regole di lettura: §6. Non si interpreta nulla: solo cambio di formato. Entrambe le analisi partono da questo stesso testo.
3. **Analisi deterministica (VM).** Parole chiave, prossimita', tabelle e codici STR. Produce, per riga: modello, campi estratti, **componenti** del testo libero riconosciuti (con frammento) e **token sconosciuti**. Motore nuovo, non riusa `orders.py` ne' `keyword-engine.ts`.
4. **Bundle `to-ai`.** Contiene il JSON canonico dei file del lotto, la versione del pacchetto di conoscenza e il manifest firmato.
5. **Analisi IA (PC IA).** Per ogni riga: identifica il modello, interpreta codici e testo libero, **scompone il testo libero in componenti**, elenca sconosciuti/ambigui/incoerenze. Ogni valore estratto riporta `evidence {addr, quote}`.
6. **Bundle `from-ai`.** Risultati + metadati (modello Ollama, versione prompt, versione conoscenza, durata) + manifest firmato.
7. **Verifica.** La VM controlla firma e hash, schema, e che ogni `quote` esista davvero nella cella indicata. Un valore senza evidenza valida viene scartato come "non supportato".
8. **Confronto.** Per riga e per campo: `uguale / diverso / mancante in uno / sconosciuto`. Esito riga:
   - **VERDE** (accettazione automatica) solo se *tutte* le condizioni valgono:
     modello identico e noto; tutti i campi uguali; zero token sconosciuti/ambigui in entrambe; evidenze valide; regole usate approvate e vigenti; controlli di coerenza superati.
   - **AMBRA**: differenze o dati mancanti risolvibili da un operatore.
   - **ROSSO**: modello non identificato, contraddizioni, evidenze non valide, IA assente.
   - Campione casuale (configurabile, 100% all'inizio) dei VERDI passa comunque da revisione.
9. **Revisione.** Vedi §4.
10. **Apprendimento.** Vedi §5.
11. **Pacchetto conoscenza.** Solo contenuti approvati; versionato, con possibilita' di rollback.
12. **Risultato finale.** Dati validati, errori, discrepanze e stato di ogni file. Pagina di consulta con ricerca per file, ordine, modello, componente, decisione, utente, data.

## 4. Schermata di revisione (prime volte e casi dubbi)

Una riga alla volta, con la **cella a testo libero evidenziata** nella sua posizione originale e le celle vicine come contesto.

- Colonna VM e colonna IA affiancate, con il testo scomposto in **componenti**; ogni componente indica il frammento di origine.
- Per ogni componente l'operatore: *conferma / corregge / "non so"*, e indica l'**ambito**:
  `SOLO QUESTO MODELLO` / `TUTTI I MODELLI` / `IGNORARE`.
  **Modello = la parte prima di " - " in TIPO E MATRICOLA** (es. `F171VS`). Versione (`F171DB850`), mercato (`/27 CHI`) e `MY27` si conservano come attributi, ma l'ambito non scende a quel livello (per ora).
  Un testo che contiene "VEDERE IMMAGINI" va sempre a revisione (§6.4).
- Un componente nuovo puo' essere aggiunto al dizionario, con ambito, come **proposta**.
- Ogni decisione registra utente, data, valori prima/dopo, motivazione facoltativa.
- Man mano che il dizionario cresce compaiono solo gli sconosciuti e le discrepanze.

## 5. Apprendimento supervisionato

- Nessun fine-tuning. Si usano **esempi corretti** (few-shot) e un **dizionario di componenti con ambito**.
- Decisione operatore -> *proposta* -> approvazione supervisore (persona diversa dall'autore) -> entra nel pacchetto `knowledge vN`.
- Il lato deterministico usa le stesse regole approvate (tabelle in DB); il lato IA le riceve come esempi/contesto.
- Mai applicazione automatica; sempre rollback possibile alla versione precedente.

## 6. La scheda Ferrari: struttura reale e lettura

Basata su due schede reali (`.xls`, 1 foglio, 4 colonne A-D, 50 e 107 righe). Gli originali non sono nel repository.

### 6.1 Struttura

- **Testata** (righe etichetta | valore): `COMMESSA`, `VARIANTE` (codice + revisione + data), `TIPO E MATRICOLA` (`F171VS - F171DB850/27 CHI MY27`, matricola, progressivo), `DESTINAZIONE` (paese + `MRKT ... <codice>`), `NUMERO DI TELAIO`.
- **Sezioni** (cella unica, insieme chiuso): `ALLESTIMENTO, ESTERNI, CERCHI, INTERNI, TAPPETI/SOVRATAPPETI, EQUIPAGGIAMENTI, N.D.`; chiusura `NO_TICKET_REQUIRED`. Una sezione puo' ripetersi (es. `INTERNI` due volte).
- **Opzione**: `codice(4) | descrizione | valore | nota`. Valore: `SI`, `EXTRACAMPIONARIO-NOT STANDARD`, un colore/codice o un numero. Nota: es. `CLIENTE`, `SCHEDULATORE`, `*** ATTENZIONE ... ***`.
- **Testo libero**: righe a cella unica, non sezione, **sotto l'opzione a cui appartengono**. Il testo e' spezzato a ~80 caratteri su piu' righe consecutive.
- Tutte le stringhe hanno spazi a destra; valori e descrizioni sono troncati a 30 caratteri.

### 6.2 Regole di lettura (indipendenti dalla posizione: l'ordine delle righe puo' cambiare)

Ogni riga si classifica dalla sua forma, mai dal numero di riga:

1. A in {etichette di testata} -> testata.
2. A in {sezioni} e senza altre celle -> cambia sezione.
3. A = 4 caratteri `[A-Z0-9]` con descrizione in B -> opzione (nuova "opzione corrente").
4. Cella unica che non e' sezione -> **testo libero dell'opzione corrente**. Righe consecutive si uniscono con uno spazio in un blocco; una riga che inizia con `LATO GUIDATORE` / `LATO PASSEGGERO` apre un nuovo blocco.
5. Testo libero senza opzione precedente -> anomalia `testo_orfano` (revisione).
6. Riga non classificabile -> `riga_ignota` (revisione). Mai scartata in silenzio.

Verificato con un prototipo sulle due schede: scheda 1 = 37 opzioni, 0 blocchi; scheda 2 = 65 opzioni, 14 blocchi su 12 opzioni, 0 orfani, 0 righe ignote.

### 6.3 JSON canonico (uscita della normalizzazione, uguale per VM e IA)

```jsonc
{
  "source": { "filename": "...", "sha256": "...", "format": "xls-biff8", "sheet": "..." },
  "header": {
    "commessa": "194070",
    "variante": { "codice": "171009408", "revisione": "0", "data": "2026-10-26T12:58" },
    "tipo_matricola": { "raw": "...", "modello": "F171VS", "versione": "F171DB850/27 CHI MY27",
                        "matricola": "771818027", "progressivo": "346291" },
    "destinazione": { "paese": "CINA", "codice_mercato": "27" },
    "telaio": "110"
  },
  "opzioni": [
    { "riga": 8, "sezione": "ESTERNI", "codice": "PNT1", "descrizione": "VERNICI SU CAMPIONE 2 STRATI",
      "valore": "EXTRACAMPIONARIO-NOT STANDARD", "nota": null,
      "blocchi_testo": [ { "righe": [9, 10], "testo": "VERNICIARE VETTURA IN COLORE ... VEDERE IMMAGINI." } ] }
  ],
  "anomalie": [ { "tipo": "testo_orfano|riga_ignota|numero_come_testo", "riga": 0 } ],
  "celle": [ { "addr": "A10", "value": "..." } ]   // celle grezze: servono come evidenza
}
```

Numeri letti come numeri (`194983.0`, `17.0`) vengono riportati come testo senza `.0`, con anomalia `numero_come_testo` se il campo potrebbe perdere zeri iniziali.

### 6.4 Controlli deterministici (senza IA)

- **Mercato coerente:** codice in `TIPO E MATRICOLA` (`/27`), ultime cifre della matricola (`...027`) e `MRKT ... 27` in testata devono coincidere; l'opzione `MRKT` deve riportare lo stesso paese.
- **Valori troncati/varianti:** `EXTRACAMPIONARIO - NOT STANDAR` e `EXTRACAMPIONARIO-NOT STANDARD` sono lo stesso valore (normalizzazione prima del confronto).
- **"VEDERE IMMAGINI":** qualsiasi blocco che contiene questa frase (anche `COME DA IMMAGINE`) richiede **sempre revisione umana**: le immagini non sono nell'Excel e non possono essere validate da VM ne' IA.
- **Segnaposto:** sequenze tipo `ZZZZ` nel testo libero -> anomalia, revisione.
- **`*** ATTENZIONE ... ***` e codici che rimandano a documenti cartacei** (es. `BOLN`): sempre revisione.
- **Opzione `EXTRACAMPIONARIO-NOT STANDARD` senza testo libero** o testo libero sotto opzione `SI`: segnalato (non e' un errore, e' un'informazione da rivedere nelle prime fasi).

### 6.5 Cosa fa la IA sul testo libero

Scompone ogni blocco in **componenti** con frammento di origine: zona (volante, sedili, plancia, battitacco...), lato, materiale (ULTRASUEDE, ALCANTARA), colore, codici di vernice, filo/cucitura (`816`, `4000`, `411`, `MADEIRA POLYNEON 1810`), logo/scritta, riferimento a immagini. Deve inoltre segnalare **varianti di scrittura** (`NUBUGRING`/`NUBURING`/`NURBURGRING`, `BLU ELDER`/`BLAB BLUE`) e incoerenze interne tra blocchi.

## 7. Bundle (contratto di scambio)

Tre tipi, tutti `.zip` con `manifest.json` nella radice. Nome: `FERRARI_<tipo>_<bundle_id>.zip`
(`to-ai`, `from-ai`, `knowledge`).

```jsonc
// manifest.json
{
  "schema_version": 1,
  "bundle_type": "to-ai | from-ai | knowledge",
  "bundle_id": "uuid",
  "in_reply_to": "uuid | null",          // from-ai risponde a un to-ai
  "batch_id": "uuid",
  "created_at": "2026-10-27T10:00:00Z",
  "producer": "vm | ai",
  "knowledge_version": 12,
  "files": [ { "path": "normalized/<file_id>.json", "sha256": "...", "size": 1234 } ],
  "hmac_sha256": "..."                   // HMAC del manifest (senza questo campo) con segreto condiviso
}
```

- `to-ai`: `normalized/<file_id>.json` (JSON canonico §6.3, hash dell'originale).
- `from-ai`: `results/<file_id>.json` -> per riga: `model`, `fields{nome:{value, evidence{addr,quote}, confidence}}`, `components[{text, label, evidence}]`, `unknown[]`, `ambiguous[]`, `inconsistent[]`; piu' `run{ollama_model, prompt_version, knowledge_version, seconds}`.
- `knowledge`: `dictionary.json`, `examples.jsonl`, `CHANGELOG.md`.
- **Idempotenza:** un `bundle_id` gia' importato viene rifiutato. Importare due volte non crea doppioni.
- **Il segreto HMAC** si scambia una volta, fuori banda, e non viaggia nei bundle.

## 8. Trasporto

Il bundle e' lo stesso per tutti i trasporti. Si usano due cartelle per lato: `outbox/` (cio' che esce) e `inbox/` (cio' che entra); dopo l'import il file si sposta in `processed/` (o `rejected/` con motivo).

| Fase | Trasporto | Quando |
|---|---|---|
| **Prototipo (ora)** | Zip scambiato a mano: USB, cartella condivisa personale o cartella OneDrive aziendale (*da confermare con la sicurezza*) | PC IA fuori sede, senza rete verso la VM |
| Dopo | PC IA contatta la VM via HTTPS con token (pull/push); la VM non apre mai connessioni verso la PC IA | PC IA in sede |

## 9. Casi eccezionali

| Caso | Trattamento |
|---|---|
| Excel corrotto, con password o con macro | Quarantena, nessuna analisi, avviso IT |
| Hash gia' visto | Duplicato, nessuna rielaborazione |
| Nuova versione dello stesso ordine | Sostituisce la precedente (resta archiviata e collegata); decisioni passate non si modificano |
| Modello non identificato | ROSSO |
| Testo con "VEDERE IMMAGINI" | Sempre revisione umana, anche se VM e IA coincidono |
| Segnaposto (`ZZZZ`), testo orfano, riga ignota | AMBRA, revisione |
| Mercato incoerente tra testata, matricola e MRKT | ROSSO |
| IA non disponibile / bundle `from-ai` mancante | L'analisi VM prosegue; stato "solo VM, in attesa IA"; mai accettato in automatico |
| Bundle alterato, firma o hash errati, versione schema ignota | Rifiutato, evento di sicurezza registrato |
| `from-ai` per un `to-ai` sconosciuto o gia' risolto | Rifiutato |
| JSON IA non valido o evidenza inesistente | Valore scartato; se riguarda campi obbligatori -> ROSSO |
| Pacchetto conoscenza non compatibile con la versione usata dalla IA | Avviso; la riga e' confrontata ma segnata "versione diversa" -> AMBRA |
| Due operatori sullo stesso caso | Blocco ottimistico: la seconda decisione viene rifiutata |
| Ferrari corregge dopo la validazione | Riapertura come nuova versione, mai modifica dell'esistente |
| Perdita/ritardo di un bundle | I lotti hanno scadenza; allarme se `to-ai` senza risposta oltre la soglia |

## 10. Controlli e sicurezza

- Originali read-only con hash; storico append-only con catena di hash.
- Ogni analisi salva versione di modello, prompt, regole e conoscenza usate.
- Ruoli: operatore, supervisore, amministratore. Approvazione regole a doppia firma.
- L'output della IA non raggiunge mai EDI/produzione senza passare dal confronto.
- Dati Ferrari solo su sistemi aziendali; log senza contenuti sensibili.
- Il segreto HMAC e i token non entrano mai nel repository.

## 11. Stati di un file

`RICEVUTO -> NORMALIZZATO -> IN_ATTESA_IA -> CONFRONTATO -> (ACCETTATO_AUTO | IN_REVISIONE) -> VALIDATO | RIFIUTATO`
Laterali: `QUARANTENA`, `DUPLICATO`, `SOSTITUITO`, `SOLO_VM`.

## 12. Dove vive il codice

- **STR-LocalAI** (`web/ferrari/`): import bundle `to-ai`, analisi IA, export `from-ai`, import `knowledge`, CLI per il prototipo.
- **LRC-System** (sezione IT, modulo nuovo): tabelle (migrazioni nuove), ricezione, normalizzazione, motore deterministico, import/verifica `from-ai`, confronto, schermata di revisione, risultato finale, consulta.

## 13. Punti aperti

1. Posizione nel menu del modulo IT di LRC-System (non trovato nel codice di `dev`).
2. Tabella dei codici opzione di 4 lettere (significato per STR/produzione). Se non esiste, si costruisce con le prime revisioni.
3. Quali campi servono a produzione dalla scheda (es. colori, carbonio, livrea): definisce cosa estrarre.
4. Trasporto del prototipo: USB / cartella / OneDrive aziendale (conferma sicurezza).
5. Chi e' operatore e chi supervisore; volumi (schede a settimana) e percentuale di campionamento iniziale.
6. Ambito "famiglia" (es. F171 intero) non previsto per ora: aggiungere solo se serve.
