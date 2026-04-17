# Setup Locale (DEV on-prem)

## Prerequisiti

- Node.js 20+
- `pnpm`
- PostgreSQL (per fasi successive; nel bootstrap la persistenza è in-memory)
- Redis (per fasi successive queue BullMQ)

## Avvio rapido (bootstrap corrente)

1. `pnpm install`
2. `pnpm --filter @bisp/apps-api-core dev`
3. `curl http://localhost:4010/health`
4. `curl -X POST http://localhost:4010/api/scenarios/repairNotWorth/run`

Portal e superfici locali:

- `http://localhost:43100` — home portal
- `http://localhost:5174` — Assist Desk
- `http://localhost:5173` — CRM
- `http://localhost:5175` — Manager / Control Center
- `http://localhost:5175#team` — Team Hub
- `http://localhost:5175#admin` — Admin Panel

## TeGem / Gemini via Playwright

Per usare Gemini tabs al posto di Ollama:

```bash
export LLM_PROVIDER=tegem
export PLAYWRIGHT_HEADLESS=false
export PLAYWRIGHT_BROWSER_CHANNEL=
export PLAYWRIGHT_BASE_PROFILE_DIR=/home/funboy/copilotrm/.playwright/profiles
export PLAYWRIGHT_PROFILE_NAMESPACE=chrome-stable
export TEGEM_IMPORT_PROFILE_FROM=/home/funboy/TeGem/.playwright/profiles
```

Note operative:

- `LLM_PROVIDER=tegem` sostituisce Ollama come provider primario.
- Il provider riusa i cookie/sessioni Chrome già presenti nel profilo Playwright.
- Se non hai Chrome di sistema, lascia `PLAYWRIGHT_BROWSER_CHANNEL` vuoto: userà Chromium installato da Playwright.
- WhatsApp e Telegram convergono su sessioni Gemini condivise lato canale.
- Il frontend/orchestrator usa una sessione Gemini distinta per ciascun agente del CRM.
- Il profilo importato non va versionato: `.playwright/` è escluso da git.

## Infra (Postgres + Redis) - Docker opzionale

Se NON usate Docker (caso tipico on-prem/LAN), usate servizi locali di sistema:
- PostgreSQL locale (porta `5432`)
- Redis locale (porta `6379`)
- impostate `DATABASE_URL` e `REDIS_URL` se diversi dai default

Verifica rapida:

```bash
pnpm infra:check
```

Se usate Docker, potete usare il compose incluso:

```bash
pnpm infra:up
curl http://localhost:4010/api/system/infra
curl -X POST http://localhost:4010/api/system/db/migrate
curl http://localhost:4010/api/system/db/snapshot
curl -X POST http://localhost:4010/api/system/db/sync-runtime
curl -X POST http://localhost:4010/api/system/db/load-runtime
curl -X POST http://localhost:4010/api/system/queue/enqueue-test -H 'content-type: application/json' -d '{"queue":"orchestrator-events"}'
```

Abilitare mirror Postgres (best-effort):

```bash
export BISPCRM_PERSISTENCE_MODE=postgres
export BISPCRM_QUEUE_MODE=redis
export BISPCRM_QUEUE_SEND_OUTBOX=true
export BISPCRM_AUTO_LOAD_RUNTIME=true
export BISPCRM_QUEUE_ORCHESTRATOR_EVENTS=true
export BISPCRM_QUEUE_CONTENT_TASKS=true
pnpm --filter @bisp/apps-api-core dev
curl http://localhost:4010/api/system/infra
```

## Smoke scenarios

- `pnpm --filter @bisp/apps-api-core test`

Esegue 5 scenari demo richiesti dal brief e stampa un riepilogo JSON per scenario.

## Assist Desk API (MVP)

Lookup cliente per telefono (cache CRM/Danea-side):

`curl 'http://localhost:4010/api/assist/customers/lookup?phone=3331112222'`

Crea ticket assistenza (se cliente non trovato -> ticket con cliente provvisorio interno):

```bash
curl -X POST http://localhost:4010/api/assist/tickets \
  -H 'content-type: application/json' \
  -d '{"phone":"3331112222","deviceType":"gaming-pc","issue":"lag e ping alto","inferredSignals":["gamer","network-issue"]}'
```

Aggiorna esito ticket e lancia orchestrator:

```bash
curl -X POST http://localhost:4010/api/assist/tickets/ticket_abc123/outcome \
  -H 'content-type: application/json' \
  -d '{"outcome":"not-worth-repairing","diagnosis":"riparazione superiore al valore","inferredSignals":["gamer","lag"]}'
```

## Manager / KPI / Task Center / Outbox

```bash
curl http://localhost:4010/api/manager/kpi
curl http://localhost:4010/api/admin/settings
curl http://localhost:4010/api/admin/model-catalog
curl http://localhost:4010/api/admin/rbac
curl http://localhost:4010/api/admin/channel-control
curl http://localhost:4010/api/tasks
curl 'http://localhost:4010/api/outbox?status=pending-approval'
```

## Control Center auth

Bootstrap primo admin:

```bash
curl -X POST http://localhost:4010/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"email":"admin@azienda.it","fullName":"Admin Azienda","password":"cambia-subito-questa-password"}'
```

Login:

```bash
curl -X POST http://localhost:4010/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@azienda.it","password":"cambia-subito-questa-password"}'
```

Verifica sessione:

```bash
curl http://localhost:4010/api/auth/me \
  -H 'x-bisp-session: <TOKEN>'
```

Lista utenti control center:

```bash
curl http://localhost:4010/api/admin/users \
  -H 'x-bisp-session: <TOKEN>'
```

Team overview:

```bash
curl http://localhost:4010/api/team/overview \
  -H 'x-bisp-session: <TOKEN>'
```

Broadcast team:

```bash
curl -X POST http://localhost:4010/api/team/broadcast \
  -H 'content-type: application/json' \
  -H 'x-bisp-session: <TOKEN>' \
  -d '{"channel":"all","text":"Promemoria operativo per il team"}'
```

Meeting da linguaggio naturale:

```bash
curl -X POST http://localhost:4010/api/team/meetings \
  -H 'content-type: application/json' \
  -H 'x-bisp-session: <TOKEN>' \
  -d '{"text":"Domani alle 10:30 riunione tecnica con mario@azienda.it per 45 minuti"}'
```

Approva e invia un draft:

```bash
curl -X POST http://localhost:4010/api/outbox/draft_abc123/approve -H 'content-type: application/json' -d '{"actor":"manager"}'
curl -X POST http://localhost:4010/api/outbox/draft_abc123/send
```

## Channel control quick probe

```bash
curl -X POST http://localhost:4010/api/channels/control/handle \
  -H 'content-type: application/json' \
  -H 'x-bisp-role: admin' \
  -d '{"channel":"telegram","peerId":"demo-chat","text":"/start"}'
```

## Workspace sync / agenda / turni

Sync manuale Google Workspace:

```bash
curl -X POST http://localhost:4010/api/admin/workspace/sync \
  -H 'x-bisp-role: admin'
```

Snapshot admin Workspace:

```bash
curl http://localhost:4010/api/admin/workspace \
  -H 'x-bisp-role: admin'
```

Probe pannello Workspace:

```bash
curl -X POST http://localhost:4010/api/channels/control/handle \
  -H 'content-type: application/json' \
  -H 'x-bisp-role: admin' \
  -d '{"channel":"whatsapp","peerId":"demo-ops","text":"/workspace"}'
```

Query naturale su turni/appuntamenti:

```bash
curl -X POST http://localhost:4010/api/channels/control/handle \
  -H 'content-type: application/json' \
  -H 'x-bisp-role: admin' \
  -d '{"channel":"whatsapp","peerId":"demo-ops","text":"Chi è di turno oggi?"}'
```

Create meeting via language:

```bash
curl -X POST http://localhost:4010/api/channels/control/handle \
  -H 'content-type: application/json' \
  -H 'x-bisp-role: admin' \
  -d '{"channel":"telegram","peerId":"demo-ops","text":"Crea una riunione domani alle 10:30 con mario@azienda.it per 45 minuti"}'
```

## Ingest / Campaign / Consult

```bash
curl -X POST http://localhost:4010/api/ingest/danea/sync
curl -X POST http://localhost:4010/api/ingest/promo \
  -H 'content-type: application/json' \
  -d '{"title":"Oppo 13 Max + smartwatch omaggio","category":"smartphone","conditions":"fine mese","stockQty":20,"targetSegments":["smartphone-upgrade","famiglia"]}'

curl -X POST http://localhost:4010/api/campaigns/preview \
  -H 'content-type: application/json' \
  -d '{"offerTitle":"Oppo 13 Max","segment":"smartphone-upgrade"}'

curl -X POST http://localhost:4010/api/campaigns/launch \
  -H 'content-type: application/json' \
  -d '{"offerTitle":"Oppo 13 Max","segment":"smartphone-upgrade"}'

curl -X POST http://localhost:4010/api/consult/proposal \
  -H 'content-type: application/json' \
  -d '{"customerId":"cust_mario","prompt":"fammi una proposta gaming rete"}'
```
