# CopilotRM

Monorepo TypeScript per un AI CRM & Swarm Automation Layer orientato al retail/assistenza tecnica.

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
  shared-config       Configurazione da env
  shared-auth / rbac  Auth e autorizzazioni
  shared-db           Runtime Postgres (migrations, pool)
  shared-audit        Audit trail
  shared-logger       Logger strutturato
  shared-observability Metriche/tracing
  domain-*            Repository dominio (customers, offers, objectives, ...)
  orchestrator-*      Scoring, rules, handoff
  agents-*            Agenti business (assistance, preventivi, hardware, ...)
  integrations-llm    Client LLM unificato (Ollama/OpenAI/Anthropic/DeepSeek)
  integrations-*      Adapter canali e servizi esterni
  personas            Definizioni persona agenti
  prompts             Prompt builder functions
```

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
· `web-crm` (:5173) · `web-assist` (:5174) · `web-manager` (:5175)

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
| `LLM_PROVIDER` | Provider LLM primario: `ollama` \| `openai` \| `anthropic` \| `deepseek` |
| `LLM_FALLBACK_PROVIDER` | Provider cloud di fallback |
| `OLLAMA_SERVER_URL` | URL server Ollama locale |
| `BISPCRM_CHANNEL_GATEWAY_URL` | URL gateway-channels per dispatch canali |
| `API_CORE_URL` | Alias compatibile URL api-core per worker/gateway |
| `BISPCRM_CHANNEL_DISPATCH_MODE` | `gateway-first` \| `gateway-only` \| `local-only` |
| `BISPCRM_GATEWAY_INBOUND_TIMEOUT_MS` | Timeout webhook inbound gateway→api-core |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `SENDGRID_API_KEY` | API key SendGrid per email |
| `WHATSAPP_API_TOKEN` | Token Meta Cloud API WhatsApp |
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
| `header` | Header `x-bisp-role` richiesto |

---

## API principali

```
GET  /health
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
GET  /api/admin/settings
PATCH /api/admin/settings/:key
GET  /api/admin/agents
GET  /api/admin/models
GET  /api/admin/channels
GET  /api/admin/characters
GET  /api/system/infra
POST /api/system/db/migrate
POST /api/orchestrate
```

---

## LLM

Provider supportati con strategia **local-first + cloud fallback**:

- **Ollama** (locale/LAN) — default, nessun costo, latenza rete locale
- **DeepSeek** — fallback economico
- **OpenAI** — fallback standard
- **Anthropic** — fallback alternativo

Se il provider primario non risponde (timeout/ECONNREFUSED) si tenta il fallback.
Se anche il fallback fallisce il sistema usa template string — non crasha mai.

---

## Sicurezza

- Tutti i segreti vivono **solo** in `.env` (in `.gitignore`)
- Il codice sorgente non contiene valori di configurazione, credenziali o dati aziendali
- `BISPCRM_AUTH_MODE=header` abilita RBAC minimo tramite header `x-bisp-role`
- I token vanno ruotati periodicamente e dopo ogni eventuale esposizione

---

## Gap noti

- Persistenza Postgres completa (attuale: write-through best-effort)
- Auth/RBAC completo on-prem
- Integrazione Danea reale read-only (attuale: stub)
- UI web complete con workflow operatori (attuale: MVP funzionale)
