# Messa in servizio del collegamento VM ↔ PC IA

Interruttore IA **spento** di default: il `./deploy.sh update` non cambia il comportamento finche' non lo si accende.

## 1. VM (server)
1. `./deploy.sh update` (applica la migrazione `0080_ferrari-ia-collegamento.sql`; solo tabelle nuove).
2. Aprire Schede Ferrari → Impostazioni → Avanzate → «Scambio con la IA» e copiare il segreto (solo supervisori).

## 2. PC IA (Windows)
1. `git pull` del repo STR-LocalAI (branch `main`, dopo il merge della PR) e riavvio del programma.
2. `config.txt`: `WEB_HOST=0.0.0.0`, `FERRARI_BUNDLE_SECRET=<segreto della VM>`, facoltativo `FERRARI_IA_IP_VM=<IP della VM>`.
3. Firewall di Windows: regola in entrata sulla porta del programma (default 5000), solo dall'IP della VM.
4. Il programma e Ollama devono partire con Windows.
5. Dalla VM: `curl http://<IP-PC-IA>:5000/v1/salute` → risposta `ok`.

## 3. Accensione (VM → Impostazioni → Avanzate → Collegamento IA)
1. Inserire l'indirizzo `http://<IP-PC-IA>:5000` → **Prova la connessione** (deve essere verde).
2. Accendere l'interruttore → **Analizza le schede mancanti** (tande da ~20).
3. Seguire le tappe nella pagina **Elaborazione** (VM) e nella pagina **Attivita'** (PC IA).

## Rollback
Spegnere l'interruttore: le schede restano utilizzabili senza IA. Per il codice: `./deploy.sh rollback` (lo schema nuovo e' solo additivo).
