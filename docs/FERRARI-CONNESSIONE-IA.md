# Schede Ferrari — collegamento VM ↔ PC IA (piano)

Stato: **Fase 1 (VM) implementata e provata contro una PC IA finta; Fase 2 (PC IA) da fare** — vedi §12. Sostituisce, per le schede, il vecchio scambio a pacchetti zip
(`docs/FERRARI-FLUSSO.md`, §«Scambio»). Le decisioni qui sotto sono state prese con l'utente.

## 1. Decisioni prese

| Tema | Decisione |
|---|---|
| Chi apre la connessione | **La VM chiama la PC IA** (HTTP). La PC IA espone una piccola API v1; la PC IA non chiama mai la VM. |
| Cosa si manda | **L'Excel originale** a ogni scheda. Le **sigle** (colonne, sotto-sigle, alias, modelli) si **sincronizzano una volta** (`PUT /v1/sigle`, con un numero di versione) e ogni scheda indica solo la `versione_sigle`; se la PC IA non la ha risponde `409 sigle_obsolete` e la VM le rimanda. |
| Cosa fa la IA | **Due cose**: (1) riassume i testi liberi; (2) legge la scheda per conto suo (lettura di controllo). |
| Chi confronta | **La VM, per codice di sigla.** La IA puo' riscrivere le descrizioni, i codici no: il confronto per codice e' ripetibile, testabile e funziona anche con la IA spenta. |
| Quando si vede il risultato | **Subito** (lettura della VM per codice); la IA **arricchisce dopo** (riassunti, avvisi). Nessuno aspetta la IA. |
| Fonte di verita' delle sigle | **La VM.** La PC IA le riceve a ogni lavoro e non ha decisioni proprie (le sue pagine Sigle/Modelli/Componenti diventano di sola lettura). |
| Revisione umana | **Nella VM** (editor). La correzione resta nella VM e torna alla IA come esempio. |
| Se la IA non risponde | **La scheda resta usabile** (lettura per codice) e segnata «IA in attesa»; la VM riprova da sola con attesa crescente. |
| Interruttore | **IA attiva/spenta** in Impostazioni; con la IA spenta tutto funziona come oggi. |
| Volume | Fino a ~20 schede per tanda (configurabile): coda semplice, una scheda alla volta. |

## 2. Architettura

```
 cartella / upload ─▶ VM: legge l'Excel (codice) ─▶ tabella subito pronta
                            │
                            │ (se IA attiva) coda ferrari_ia_job
                            ▼
                    VM  ──HTTP firmato──▶  PC IA  (API v1)  ──▶ Ollama
                    │  POST /v1/analisi   (Excel + snapshot sigle)
                    │  GET  /v1/analisi/{id}   (avanzamento + risultato)
                    ▼
            VM: confronto per codice ─▶ avvisi / «da rivedere» ─▶ stessa tabella di oggi
```

Principi: la VM e' l'unica fonte di verita'; la IA e' **consultiva** (mai blocca, mai decide); ogni passo e' idempotente
e visibile; il collegamento e' spento di default fino a quando non e' provato.

## 3. Flusso per scheda (quello che si «colora» in schermo)

Passi, in ordine. Ogni scheda mostra una barra a tappe; ogni tappa ha uno stato e un colore (token del design system).

| # | Passo | Chi | Colore in corso | Esito |
|---|---|---|---|---|
| 1 | **Ricevuta** (cartella o caricamento) | VM | accento | verde |
| 2 | **Letta** (parser + sigle per codice) | VM | accento | verde / rosso se non e' una scheda |
| 3 | **Inviata alla IA** | VM | accento | verde |
| 4 | **Analisi IA** (lettura + riassunti `x/y`) | PC IA | accento con avanzamento | verde |
| 5 | **Confronto** per codice | VM | accento | verde se uguale, **ambra** se ci sono discrepanze |
| 6 | **Pronta** | — | — | verde |

Stati finali/laterali: **Pronta senza IA** (IA spenta: tappe 3-5 grigie «saltate»), **IA in attesa** (ambra, con prossimo
tentativo), **Errore** (rosso, con motivo e «Riprova»). Grigio = da fare. Le tappe 3-5 non bloccano mai la 6 (la scheda e'
usabile dalla tappa 2).

Dove si vede: scheda **«Elaborazione»** nel gruppo Programma produzione (schede) — elenco vivo con le tappe per scheda e un
riepilogo della tanda (`7/20`) — e un indicatore piccolo nell'intestazione di «Vedere» (`IA attiva / spenta / non raggiungibile`).
Aggiornamento con polling ogni 2 s solo quando c'e' lavoro in corso (stesso schema delle altre pagine; SSE eventualmente dopo).

## 4. Contratto API della PC IA (v1)

Base: `http://<pc-ia>:<porta>/v1`. Tutto JSON tranne l'upload (multipart). Versione nel path; campo `schema` in ogni risposta.

### Autenticazione (firma HMAC, nessun login)
Segreto condiviso = quello gia' esistente (`FERRARI_BUNDLE_SECRET`). Intestazioni su ogni richiesta:
`X-Ferrari-Time` (epoch s), `X-Ferrari-Nonce` (UUID), `X-Ferrari-Signature` = `HMAC-SHA256(secret, metodo \n percorso \n time \n nonce \n sha256(corpo))`.
La PC IA rifiuta se |ora − time| > 5 min, se il nonce e' gia' visto (cache 10 min) o se la firma non torna. In piu': whitelist
dell'IP della VM e `FERRARI_LAN=1` solo sull'interfaccia necessaria. Mai segreti nei log.

### Endpoint
- `GET /v1/salute` → `{ schema, versione_api, ollama: true|false, modello, in_coda, in_corso, versione_prompt }` (senza autenticazione sui dati, solo stato).
- `POST /v1/analisi` (multipart: `file` = Excel, `meta` = JSON) → `202 { id, stato: "in_coda" }`. Idempotente: stesso `sha256` + stessa `versione_sigle` + stessa `versione_prompt` = stesso `id` (non si rifa').
  - `meta`: `{ sha256, commessa?, modello?, versione_sigle, richiesta_id }`. Se la `versione_sigle` non e' nota alla PC IA → `409 { errore.codice: "sigle_obsolete" }` e la VM sincronizza e riprova (senza perdere un tentativo).
- `PUT /v1/sigle` (JSON) → `200 { versione_sigle }`. Corpo: `{ versione_sigle, colonne:[…], sotto_sigle:[{codice, padre?}], alias:{scritto:giusto}, modelli:[…], esempi:[{voce, testo, dettaglio}] }`. `versione_sigle` = sha256 del corpo stabile (stessa versione = stesso contenuto, idempotente). La IA le usa anche per **saltare** i testi delle opzioni che non sono colonne (tempo risparmiato).
- `GET /v1/analisi/{id}` → `{ id, stato, passo, avanzamento:{fatti,totale,etichetta}, tentativi?, secondi, chiamate, risultato? , errore? }`
  - `stato`: `in_coda | in_corso | fatto | errore`; `passo`: `lettura | riassunti | controllo | fine`.
- `DELETE /v1/analisi/{id}` → annulla (se ancora in coda).

### Risultato (`risultato`, quando `stato = fatto`)
```
{ commessa, modello,
  lettura: [ { riga, codice, descrizione, valore, nota, testi:[…] } ],        // la lettura di controllo della IA
  dettagli: [ { codice, chiave, dettaglio, stato: "ok|rivedere", proposta? } ], // riassunti (chiave = hash del testo normalizzato, come oggi)
  avvisi: [ { codice?, riga?, motivo } ],
  metriche: { secondi, chiamate, versione_prompt, modello } }
```
Compatibilita': la `chiave` e' quella gia' usata da `ferrari_dettaglio` (hash testo normalizzato, stessa funzione nelle due parti,
gia' coperta da test di interoperabilita'). Errori: 400 (corpo/firma), 401 (firma), 409 (duplicato in corso), 413 (>10 MB),
422 (non e' una scheda), 503 (Ollama spento). Ogni errore: `{ schema, errore:{ codice, messaggio } }`.

## 5. Confronto (nella VM, per codice)

Per ogni scheda: lettura VM (`canonico.opzioni`) contro `risultato.lettura`, **chiave = codice di sigla**, le descrizioni **non** si confrontano.
Discrepanze: `solo_vm`, `solo_ia`, `valore_diverso` (valori normalizzati: «SI»/«Sì»/spazi/maiuscole), `testo_diverso` (blocchi di testo libero:
stesso insieme di codici/numeri), `ripetuto`. Solo le sigle di interesse (colonne e sotto-sigle) pesano; le altre sono informative.
Esito: nessuna discrepanza → verde; altre → **ambra**, cella della colonna segnata «da rivedere» (meccanismo che c'e' gia')
e elenco nella scheda «Elaborazione». Una discrepanza non cambia mai il valore mostrato: lo decide una persona.
I riassunti dei testi entrano in `ferrari_dettaglio` (come oggi, con `stato`), e la riga si vede nella cella con il riassunto.

## 6. Interruttore e resilienza

- **Interruttore**: `ferrari_config.ia_attiva` (default **false**) in Impostazioni → Avanzate, con stato della connessione («Raggiungibile · Ollama ok · modello»).
  Spenta: non si creano lavori; i risultati gia' arrivati restano; «Analizza con IA» per scheda resta disattivato. Riaccesa: si accodano le schede
  senza IA (con conferma).
- **Tentativi**: attesa crescente con jitter (1, 2, 5, 15, 60 min, tetto 60 min), `max_tentativi` configurabile; poi «IA non riuscita» (ambra) con «Riprova».
- **Interruttore automatico (circuit breaker)**: dopo 3 errori di rete di fila la VM mette l'IA in «non raggiungibile» e smette di inviare; controlla `/v1/salute` ogni minuto e riparte da sola.
- **Timeout**: connessione 5 s, richiesta 30 s; un lavoro oltre 20 min senza avanzamento si considera fallito.
- **Riavvio**: i lavori `inviato` si riprendono con `GET` all'avvio della VM (nessuna perdita); un solo invio alla volta per scheda (lock a livello di database).
- **Idempotenza**: `richiesta_id` + `sha256` evitano doppioni se la risposta di invio si perde.

## 7. Dati nella VM (migrazioni aggiuntive, solo tabelle/colonne nuove)

Migrazione **0080** (verificare il numero libero su `dev` prima del PR).
- `ferrari_ia_job` — `id, file_id, sha256, richiesta_id, id_remoto, stato, passo, avanzamento jsonb, tentativi, prossimo_tentativo_at, errore, versione_sigle, creato_da, creato_at, inviato_at, finito_at, aggiornato_at`; un solo lavoro attivo per scheda (indice parziale unico).
- `ferrari_ia_passo` — log eventi per la linea del tempo (solo aggiunte): `job_id, passo, stato, dettaglio, at`.
- `ferrari_ia_risultato` — `job_id, lettura jsonb, avvisi, metriche, esito, discrepanze jsonb` (lettura di controllo della IA e confronto fatto dalla VM).
- Si **riusa** `ferrari_dettaglio` per i riassunti. Il vecchio flusso a pacchetti (`ferrari_analisi`, `ferrari_confronto`, `ferrari_bundle`) resta intatto e inattivo: si ritirera' in un PR separato.
- Config: `ia_attiva`, `ia_url`, `ia_max_tentativi`, `ia_timeout_s` in `ferrari_config` (nessun segreto nuovo).

## 8. Cosa cambia nella PC IA (STR-LocalAI)

Nuovo blueprint `/v1/*` (stesso Flask, stessa coda a un lavoratore e stesso `elabora_excel`), con firma HMAC, whitelist IP, salute e risultato strutturato.
Le pagine Sigle/Modelli/Componenti diventano di sola lettura (specchio dell'ultimo snapshot ricevuto). Gli endpoint vecchi restano finche' la VM non li usa piu'.
Il lavoro sulla PC IA si fa in una rama dedicata; **la sessione locale della PC non deve toccare il modulo Ferrari durante la migrazione** (e' gia' successo di pestarci i piedi).

## 9. Test

- **Contratto**: stessi file JSON di esempio (`fixtures/ia-v1/*.json`) validati con zod (VM) e con uno schema nella PC IA; se cambia uno, falliscono entrambi.
- **VM**: confronto (tabella di casi), macchina a stati e pianificatore dei tentativi con orologio finto, e integrazione contro una **PC IA finta** (server HTTP nei test) con iniezione di guasti: spenta a meta' lavoro, firma sbagliata, timeout, risposta duplicata, Ollama giu'.
- **PC IA**: client di test Flask (firma, nonce ripetuto, tempo fuori finestra, 413/422/503, idempotenza).
- **Manuale prima del rilascio**: tanda reale di 5 schede con IA accesa, poi con la PC IA spenta, poi riaccesa.

## 10. Fasi (un PR piccolo per fase, interruttore spento di default)

1. **Fase 1 — VM, senza PC IA**: tabelle, macchina a stati, interruttore, schermata «Elaborazione» e client HTTP, provati con la PC IA finta.
2. **Fase 2 — PC IA**: API v1 (firma, salute, analisi, risultato) + test di contratto.
3. **Fase 3 — Integrazione**: invio reale, confronto per codice, riassunti nella tabella, editor di revisione nella VM (e invio degli esempi).
4. **Fase 4 — Rafforzamento e ritiro**: rotazione del segreto, metriche, ritiro del flusso a pacchetti.

## 11. Rischi e punti aperti

- **Rete**: servono una regola di firewall in ingresso sulla PC IA (porta scelta, solo dall'IP della VM) e `FERRARI_LAN=1`. Da verificare con una prova (`curl` dalla VM).
- **Avvio PC IA**: il programma deve partire da solo con Windows (servizio o attivita' pianificata), altrimenti la IA sembra «non raggiungibile» ogni mattina.
- **Latenza**: la IA e' lenta per scheda; per questo il risultato non blocca nulla. Con ~20 schede per tanda basta una coda semplice.
- **Prompt/modello**: un cambio di prompt o modello invalida i risultati (si rifanno): per questo l'idempotenza e' per `richiesta_id` (uno nuovo per ogni invio della VM, quindi un cambio di prompt/modello si rifa' con un nuovo invio).
- **Da decidere con l'utente**: porta da usare; se la tappa «Confronto» deve poter mandare automaticamente a «da rivedere» o solo segnalare (proposta: solo segnalare); dopo quanto tempo una IA «in attesa» diventa «non riuscita» (proposta: 6 tentativi).

## 12. Stato di avanzamento

**Fase 1 — VM (fatta, interruttore spento di default)**: contratto v1 (zod) · firma HMAC · cliente HTTP con timeout ed errori tipizzati ·
snapshot delle sigle con versione · macchina a stati e tappe · confronto per codice · servizio con coda, tentativi con attesa crescente,
corto circuito (3 errori di rete di fila → si ferma e controlla `/salute` ogni minuto), massimo 3 lavori in volo, riavvio senza perdite ·
rotte (`/api/ferrari/ia/*`) · aggancio al caricamento (a mano e da cartella) · pagina **Elaborazione** con le tappe colorate ·
interruttore e prova della connessione in Impostazioni → Avanzate. Provata con una **PC IA finta** (HTTP vero) che simula spenta,
firma sbagliata, timeout, riavvio e sigle sconosciute.

**Fase 2 — PC IA (fatta, repo STR-LocalAI, PR verso `main`)**: blueprint `/v1/*` (firma, nonce, salute, sigle, analisi con avanzamento, risultato) sopra `elabora_excel`,
un solo lavoro pesante alla volta, dalla rete passa solo `/v1/*`, pagina **Attivita'** (tappe, diario, risultati) sulla PC IA. Vettore di contratto condiviso
(`contratto-v1.json`, stesso hash delle sigle nei due repo) e prova end-to-end VM(TS) ↔ API Flask vera. Messa in servizio: `docs/FERRARI-IA-DEPLOY.md`.

**Limiti noti della Fase 1**: i riassunti si mostrano gia' nella tabella (stessa tabella `ferrari_dettaglio` di oggi) ma l'editor di revisione nella VM e
l'invio degli esempi alla IA sono della Fase 3; l'indirizzo della PC IA lo configura chi ha il permesso di gestione (valutare una lista di reti ammesse);
il traffico e' HTTP in rete interna firmato (non cifrato): se serve, mettere un proxy TLS davanti alla PC IA.
