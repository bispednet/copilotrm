# CopilotRM

Monorepo TypeScript per un AI CRM & Swarm Automation Layer orientato al retail/assistenza tecnica.

## Novità operative rilevanti

- risoluzione anagrafica cliente con deduplica, scoring e `needs-approval`
- storico cliente persistente per opportunità, proposte, follow-up e azioni commerciali
- agente dedicato `Anagrafiche` nel flusso swarm per nuovi clienti, contatti ambigui e disambiguazione
- streaming conversazionale reale nel CRM: non solo `sta scrivendo…`, ma testo live agente-per-agente
- loop swarm rifatto: `Orchestratore` decide se chiudere o chiedere approfondimenti mirati prima di chiamare `Moderatore`
- lookup copertura connettività da address su portale BUL ufficiale, iniettato nel contesto di `Telefonia` / `Commerciale`
- lookup cliente da chat libera tramite nome/telefono con creazione controllata della master anagrafica
- opportunità commerciali e risultati assistenza sempre appesi al cliente e consultabili nello storico
- la chat CRM può materializzare artefatti operativi persistiti: task, draft outbox e opportunità

## Surface di prodotto

- `https://www.eeess.cyou` — home portal con ingresso alle aree operative
- `https://app.eeess.cyou` — Assist Desk
- `https://crm.eeess.cyou` — CRM workspace
- `https://manager.eeess.cyou` — Manager / control center autenticato
- `https://manager.eeess.cyou#team` — Team operations hub
- `https://manager.eeess.cyou#admin` — Admin Panel
- `https://api.eeess.cyou` — backend/API status
- `https://vnc.eeess.cyou` — noVNC / Playwright desktop per Gemini

---

## Architettura

```
apps/
  api-core            API Fastify (orchestrator, CRM, assist desk, admin)
  gateway-channels    Gateway invio canali (Telegram, Email, WhatsApp)
  web-assist          UI operatore assistenza (NLP intake, scheda tecnica, STT)
  web-crm             UI CRM / agente di vendita
  web-manager         UI manager (obiettivi, KPI, impostazioni)
  worker-content      Worker content/social pipeline
  worker-ingest       Worker ingest Danea/promo
  worker-orchestrator Worker orchestrazione eventi
  worker-social       Worker pubblicazione social

packages/
  shared-types        Tipi dominio condivisi
  channel-control     Pannelli, quick actions e rendering condiviso Telegram/WhatsApp
  shared-config       Configurazione da env
  shared-auth / rbac  Auth e autorizzazioni
  shared-db           Runtime Postgres (migrations, pool)
  shared-audit        Audit trail
  shared-logger       Logger strutturato
  shared-observability Metriche/tracing
  domain-*            Repository dominio (customers, offers, objectives, ...)
  orchestrator-*      Scoring, rules, handoff
  agents-*            Agenti business (assistance, preventivi, hardware, ...)
  integrations-llm    Client LLM unificato (Ollama/OpenAI/Anthropic/DeepSeek/TeGem)
  integrations-google-workspace Sheets + Calendar sync per agenda/turni/meeting
  integrations-*      Adapter canali e servizi esterni
  personas            Definizioni persona agenti
  prompts             Prompt builder functions
```

### Agenti di sistema

- `Orchestratore` coordina il turn taking del team
- `Critico` fa review avversariale e blocca proposte premature
- `Moderatore` sintetizza e produce il risultato finale
- `Anagrafiche` gestisce lookup cliente, disambiguazione, deduplica e creazione `needs-approval`

---

## Setup

**Requisiti:** Node 20+, pnpm 9+

```bash
pnpm install
cp .env.example .env   # compilare con i propri valori
pnpm build
pnpm dev:start
pnpm dev:check
```

`dev:start` avvia: `api-core` (:4010) · `gateway-channels` (:4020) · `worker-content`
· `worker-ingest` · `web-crm` (:5173) · `web-assist` (:5174) · `web-manager` (:5175)

`dev:check` verifica health/infra snapshot con timeout e header RBAC.

Se Redis non è attivo su `:6379` lo script fa fallback automatico a `BISPCRM_QUEUE_MODE=inline`.

---

## Variabili d'ambiente principali

Tutte le variabili vivono esclusivamente in `.env` (escluso da git).
Vedere `.env.example` per la lista completa.

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis URL |
| `BISPCRM_ROOT_DIR` | Root runtime progetto (default: cwd) |
| `BISPCRM_MIGRATIONS_DIR` | Path migrazioni SQL |
| `BISPCRM_RUNTIME_DATA_DIR` | Directory dati runtime (override di `COPILOTRM_DATA_DIR`) |
| `LLM_PROVIDER` | Provider LLM primario: `ollama` \| `openai` \| `anthropic` \| `deepseek` \| `tegem` |
| `LLM_FALLBACK_PROVIDER` | Provider cloud di fallback |
| `OLLAMA_SERVER_URL` | URL server Ollama locale |
| `PLAYWRIGHT_BASE_PROFILE_DIR` | Directory profili Playwright/Gemini riusati da TeGem |
| `PLAYWRIGHT_PROFILE_NAMESPACE` | Namespace profilo browser per le sessioni Gemini |
| `PLAYWRIGHT_BROWSER_CHANNEL` | Channel Playwright opzionale (`chrome` solo se installato; vuoto = Chromium bundle) |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Path esplicito Chrome/Chromium per il provider TeGem |
| `TEGEM_IMPORT_PROFILE_FROM` | Path legacy da cui importare cookie/sessioni Gemini già loggate |
| `BISPCRM_CHANNEL_GATEWAY_URL` | URL gateway-channels per dispatch canali |
| `API_CORE_URL` | Alias compatibile URL api-core per worker/gateway |
| `BISPCRM_CHANNEL_DISPATCH_MODE` | `gateway-first` \| `gateway-only` \| `local-only` |
| `BISPCRM_GATEWAY_INBOUND_TIMEOUT_MS` | Timeout webhook inbound gateway→api-core |
| `BISPCRM_GATEWAY_CONTROL_TIMEOUT_MS` | Timeout control surface gateway→api-core (bot panels + quick actions) |
| `BISPCRM_ELIZA_ENV_PATH` | Path opzionale a `.env` esterno usato come fallback read-only per Admin Settings |
| `BISPCRM_REDIS_CONNECT_TIMEOUT_MS` | Timeout preflight Redis per worker |
| `BISPCRM_ORCHESTRATOR_API_TIMEOUT_MS` | Timeout chiamata worker-orchestrator → api-core |
| `RSS_FEEDS` | JSON array feed RSS pubblici (override della lista default in worker-ingest) |
| `OFFER_SOURCES_ENERGY` | CSV URL pubblici fonti offerte energia (ARERA/operatori) |
| `OFFER_SOURCES_TELCO` | CSV URL pubblici fonti offerte telco (AGCOM/operatori) |
| `BISPCRM_INGEST_PUBLIC_OFFERS` | Abilita ingest offerte pubbliche energia/telco via worker-ingest |
| `BISPCRM_PUBLIC_OFFERS_MAX` | Numero massimo offerte pubbliche importate per run |
| `BISPCRM_INGEST_ROLE` | Ruolo RBAC usato dal worker-ingest per chiamare `/api/ingest/promo` |
| `BISPCRM_INGEST_API_TIMEOUT_MS` | Timeout chiamata API ingest promo dal worker-ingest |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `SENDGRID_API_KEY` | API key SendGrid per email |
| `WHATSAPP_API_TOKEN` | Token Meta Cloud API WhatsApp |
| `WHATSAPP_ALLOWED_GROUP_IDS` | Allowlist opzionale group IDs WhatsApp per il bot aziendale |
| `BISPCRM_GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service account per Sheets/Calendar |
| `BISPCRM_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Private key PEM del service account |
| `BISPCRM_GOOGLE_SHEETS_SOURCES_JSON` | JSON array sorgenti Google Sheets (turni, fogli operativi, knowledge) |
| `BISPCRM_GOOGLE_CALENDAR_SOURCES_JSON` | JSON array calendari condivisi da sincronizzare |
| `BISPCRM_GOOGLE_DEFAULT_CALENDAR_ID` | Calendario di default per creare meeting/inviti |
| `BISPCRM_GOOGLE_SYNC_INTERVAL_MS` | Intervallo sync Workspace verso Postgres |
| `COMPANY_NAME` | Ragione sociale (schede assistenza, PDF) |
| `COPILOTRM_DATA_DIR` | Directory dati runtime (settings, characters) |

---

## Modalità operative

### Persistence
| Valore | Comportamento |
|---|---|
| `memory` (default) | Tutto in-memory, nessun DB richiesto |
| `postgres` | Write-through su Postgres (richiede migrazioni) |

### Queue
| Valore | Comportamento |
|---|---|
| `inline` | Azioni sincrone inline |
| `redis` | BullMQ via Redis |

### Channel Dispatch
| Valore | Comportamento |
|---|---|
| `gateway-first` (default) | Prova `gateway-channels`, fallback locale se down |
| `gateway-only` | Usa solo `gateway-channels` (errore se non raggiungibile) |
| `local-only` | Usa adapter locali in `api-core` |

### Auth
| Valore | Comportamento |
|---|---|
| `none` | Nessun controllo (solo dev locale) |
| `header` | Compatibilità RBAC via `x-bisp-role`, ma il control center usa sessioni DB-backed |

---

## Customer Resolution e Storico commerciale

Il prodotto non tratta più il cliente come un payload volatile del singolo ticket.

Ora il runtime:

- cerca clienti esistenti tramite telefono, email e similarità sul nome
- distingue tra match esatto, possibile duplicato e nuovo cliente
- crea nuove anagrafiche con `approvalStatus = needs-approval` quando i dati non sono ancora affidabili
- salva i casi di risoluzione in `customer_resolution_cases`
- salva opportunità, proposte e output commerciali in `customer_opportunities`
- collega ticket, esiti assistenza e consult proposal allo stesso `customerId`

Questo permette:

- controllo umano dei duplicati
- storico cliente permanente
- audit commerciale reale
- contesto migliore per gli agenti nelle conversazioni successive

---

## Streaming conversazionale

Il CRM e i canali non si limitano più a un indicatore generico di digitazione.

Con provider che supportano streaming, il runtime espone chunk parziali agente-per-agente via SSE:

- `typing` per inizio turno agente
- `chunk` per testo parziale live
- `message` per messaggio consolidato
- `done` per la sintesi finale

Sul frontend CRM questo viene renderizzato come thread operativo vivo, più vicino al comportamento già sperimentato su TeGem.

Il provider `tegem` è stato anche ottimizzato per:

- cold-start più rapido delle tab Gemini
- polling stream più serrato
- invio prompt più aggressivo nei casi text-only

## Copertura telco reale

Quando nel messaggio compare un indirizzo e la richiesta parla di fibra / copertura / connettività, il backend esegue una lookup reale sul portale BUL ufficiale e inietta nel contesto:

- regione e comune rilevati
- query normalizzata
- candidati civico trovati
- link al portale ufficiale

Questo evita che `Telefonia` prometta verifiche che non ha ancora eseguito.

---

## API principali

```
GET  /health
GET  /api/auth/bootstrap-status
POST /api/auth/bootstrap
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/customers/resolve
PATCH /api/customers/:id/approval
GET  /api/customers/:id/opportunities
GET  /api/customers/:id/resolutions
GET  /api/customers
GET  /api/offers
GET  /api/objectives
GET  /api/tasks
PATCH /api/tasks/:id
GET  /api/outbox
POST /api/outbox/:id/approve
POST /api/outbox/:id/send
POST /api/campaigns/preview
POST /api/campaigns/launch
GET  /api/manager/objectives
POST /api/manager/objectives
GET  /api/manager/kpi
POST /api/consult/proposal
POST /api/chat
GET  /api/assist/tickets
POST /api/assist/tickets
POST /api/assist/intake-nlp
GET  /api/assist/tickets/:id/scheda
POST /api/assist/tickets/:id/outcome
POST /api/ingest/danea/sync
POST /api/ingest/promo
POST /api/ingest/public-offers/sync
POST /api/ingest/rss/sync
GET  /api/news
GET  /api/events/config
PATCH /api/events/config/:type
POST /api/events/run
GET  /api/events/runs
GET  /api/events/runs/:runId
GET  /api/events/stream
GET  /api/admin/settings
GET  /api/admin/users
POST /api/admin/users
PATCH /api/admin/users/:id
PATCH /api/admin/settings/:key
GET  /api/admin/agents
GET  /api/admin/models
GET  /api/admin/channels
GET  /api/admin/channel-control
GET  /api/admin/workspace
POST /api/admin/workspace/sync
GET  /api/team/overview
POST /api/team/workspace-query
POST /api/team/meetings
POST /api/team/broadcast
GET  /api/admin/characters
POST /api/channels/control/handle
GET  /api/system/infra
POST /api/system/db/migrate
POST /api/orchestrate
```

---

## LLM

Provider supportati con strategia **local-first + cloud fallback**:

- **Ollama** (locale/LAN) — default, nessun costo, latenza rete locale
- **TeGem** (Gemini via Playwright + tab browser persistenti) — usa sessioni browser già autenticate, ottimo per operator workflows e swarm condiviso
- **DeepSeek** — fallback economico
- **OpenAI** — fallback standard
- **Anthropic** — fallback alternativo

Se il provider primario non risponde (timeout/ECONNREFUSED) si tenta il fallback.
Se anche il fallback fallisce il sistema usa template string — non crasha mai.

### Session model con TeGem

- **WhatsApp** usa una sessione condivisa per canale/agent, così tutti gli utenti del gruppo aziendale convergono sugli stessi tab Gemini.
- **Telegram** usa la stessa logica di channel session condivisa.
- **Frontend / orchestrazione CRM** usa una sessione distinta per ogni agente del repo, così ogni ruolo mantiene il proprio thread Gemini.
- I profili Playwright possono essere importati da un repo esterno già loggato, evitando nuovi login manuali.
- Se `PLAYWRIGHT_BROWSER_CHANNEL` e `PLAYWRIGHT_EXECUTABLE_PATH` sono vuoti, il provider usa Chromium installato da Playwright.

---

## Sicurezza

- Tutti i segreti vivono **solo** in `.env` (in `.gitignore`)
- Il codice sorgente non contiene valori di configurazione, credenziali o dati aziendali
- Il Manager control center usa utenti e sessioni persistite in Postgres
- Il primo admin si crea tramite bootstrap, poi l’accesso avviene via login e token `x-bisp-session`
- `BISPCRM_AUTH_MODE=header` resta come compatibilità per endpoint/worker legacy
- I token vanno ruotati periodicamente e dopo ogni eventuale esposizione

---

## Channel Control

Telegram e WhatsApp non sono più trattati come semplici pipe outbound/inbound. Il refactor introduce:

- pannelli `home`, `help`, `actions`, `approvals`, `outbox`, `status`, `integrations`
- quick actions condivise tra Telegram e WhatsApp
- routing per callback Telegram e reply interattive WhatsApp
- fallback conversazionale sullo stesso `/api/chat`
- telemetria canali esposta in admin
- persistenza peer/eventi canale su Postgres
- pannello Workspace con agenda, turni, meeting e sync Google
- supporto group-aware per WhatsApp (con allowlist opzionale)

Dettagli tecnici e roadmap nel file [docs/channel-control-refactor.md](docs/channel-control-refactor.md).

## Workspace Operations

Il runtime può sincronizzare Google Sheets e Google Calendar nel DB e renderli disponibili a:

- WhatsApp e Telegram in linguaggio naturale
- pannelli bot `Workspace`, `Agenda today`, `Shifts today`, `Create meeting`
- admin manager UI
- query grounded lato runtime

Use cases coperti:

- agenda appuntamenti condivisa
- turni dipendenti e orari
- meeting/inviti Google Calendar
- fogli operativi da Google Sheets
- risposte “idiotproof” in gruppo WhatsApp o nelle chat bot

## Control Center

Il manager non è più solo una dashboard di supporto. Ora funge da centro di controllo unico, con:

- `Home / KPI` per priorità e stato operativo
- `Team Ops` per broadcast, agenda, turni, meeting e osservabilità canali
- `Admin Panel` per utenti, ruoli, settings, env status, telemetria e runtime

Il piano di finalizzazione prodotto è tracciato in [docs/production-control-center-plan.md](docs/production-control-center-plan.md).

---

## Gap noti

- Persistenza Postgres completa (attuale: write-through best-effort)
- Auth/RBAC completo on-prem
- Integrazione Danea reale read-only (attuale: stub)
- UI web complete con workflow operatori (attuale: MVP funzionale)
