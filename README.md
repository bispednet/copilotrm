# CopilotRM (Monorepo)

Monorepo TypeScript-first per il progetto CopilotRM AI CRM & Swarm Automation Layer.

Obiettivi di questo bootstrap:
- CRM operativo + assist desk + manager objectives
- orchestrator multi-agent custom TS (separato dai canali)
- integrazioni incapsulate (Danea, Eliza-derived, canali)
- audit trail e policy base
- base pronta per evoluzione on-prem

## Stato

Questo repository contiene Sprint 0 + una parte sostanziale di Sprint 1/2 (in-memory, API-first):
- struttura monorepo `pnpm` + `turbo`
- package dominio/orchestrator/agenti/personas
- app skeleton (`api-core`, `worker-*`, `web-*`)
- adapter `integrations-eliza` con pattern persona/plugin e RAG knowledge (adattato)
- orchestrator rule-based minimale con handoff/scoring/audit
- API minime per simulare scenari del brief
- Assist Desk MVP reale (lookup telefono, ticket, cliente provvisorio, outcome -> orchestrator)
- Task center e outbox con approvazioni / send stub
- Manager panel API (objectives CRUD base, KPI)
- Ingest Danea stub + ingest promo -> offerte + orchestrator
- Campaign preview/launch con targeting one-to-one / one-to-many
- Consult agent API con varianti, script, allineamento obiettivi, RAG hints

## Vincoli architetturali rispettati

- Runtime centrale: custom TypeScript
- Nessun runtime Python centrale
- Riuso Eliza selettivo e incapsulato in `packages/integrations-eliza`
- Orchestrator separato dagli adapter canale
- Personas agenti come file/config (`packages/personas`)
- Danea prevista in sola lettura (`packages/integrations-danea` stub)
- Audit trail presente (`packages/shared-audit`)

## Workspace

- `apps/api-core`: API Fastify (skeleton + route demo orchestrator)
- `apps/worker-orchestrator`: loop eventi/orchestrazione
- `apps/worker-ingest`: ingest Danea stub (fatture/offerte)
- `apps/worker-content`: content jobs stub
- `apps/worker-social`: publishing jobs stub
- `apps/web-assist`: UI assist desk (skeleton)
- `apps/web-manager`: UI manager objectives/KPI (skeleton)
- `apps/web-crm`: UI consult/CRM (skeleton)
- `apps/gateway-channels`: gateway dedicato invio canali (telegram/email/whatsapp/social)
- `packages/*`: dominio, orchestrator, agenti, integrazioni, shared

## Setup previsto (LAN / no-Docker friendly)

1. Installare Node 20+ e `pnpm`.
2. `pnpm install`
3. `pnpm build`
4. `pnpm dev:api`

Nota infra:
- Docker non e' obbligatorio.
- Se in LAN usate servizi locali (Postgres/Redis installati sul sistema), impostate `DATABASE_URL` / `REDIS_URL` e usate direttamente `pnpm infra:check`.
- `pnpm infra:up` usa Docker solo se presente; altrimenti fa fallback a verifica servizi locali.

## Scenari E2E target (simulabili via API demo + test)

- ticket assistenza -> non conviene riparare -> preventivo notebook
- ticket assistenza gamer -> proposta connectivity gaming
- fattura hardware -> prodotto/offerta -> task contenuto
- promo smartphone bundle -> campagna telefonia
- email reclamo post-vendita -> customer care + proposta coerente

## API principali (MVP attuale)

- `GET /health`
- `GET /api/customers`
- `GET /api/offers`
- `GET /api/objectives`
- `GET /api/audit?type=&actor=`
- `GET /api/tasks`
- `PATCH /api/tasks/:taskId`
- `GET /api/outbox`
- `POST /api/outbox/:outboxId/approve`
- `POST /api/outbox/:outboxId/reject`
- `POST /api/outbox/:outboxId/send`
- `GET /api/campaigns`
- `POST /api/campaigns/preview`
- `POST /api/campaigns/launch`
- `GET /api/manager/objectives`
- `POST /api/manager/objectives`
- `PATCH /api/manager/objectives/:objectiveId`
- `GET /api/manager/kpi`
- `GET /api/admin/settings`
- `PATCH /api/admin/settings/:key`
- `GET /api/admin/agents`
- `GET /api/admin/models`
- `GET /api/admin/model-catalog`
- `GET /api/admin/channels`
- `GET /api/admin/rbac`
- `GET /api/admin/integrations`
- `POST /api/media/generate`
- `GET /api/media/jobs`
- `GET /api/channels/dispatches`
- `GET /api/system/infra`
- `POST /api/system/db/migrate`
- `GET /api/system/db/snapshot`
- `POST /api/system/db/sync-runtime`
- `POST /api/system/db/load-runtime`
- `POST /api/system/queue/enqueue-test`
- `GET /api/assist/customers/lookup?phone=`
- `GET /api/assist/tickets`
- `POST /api/assist/tickets`
- `POST /api/assist/tickets/:ticketId/outcome`
- `POST /api/ingest/danea/sync`
- `POST /api/ingest/promo`
- `POST /api/consult/proposal`
- `POST /api/orchestrate`
- `GET /api/scenarios`
- `POST /api/scenarios/:name/run`

## Gap noti (richiedono step successivo)

- persistenza PostgreSQL full-read/full-write dei repository applicativi (ora c'è write-through mirror best-effort su task/outbox/audit/tickets/offers/objectives/admin_settings)
- queue Redis/BullMQ business flows completi (worker queue scaffolding presente, pipeline ancora parziale)
- auth/RBAC on-prem (attuale: assente)
- integrazione Danea reale read-only (attuale: stub)
- canali reali WhatsApp/Email/Telegram/Social con audit end-to-end (attuale: adapter stub)
- UI web complete con workflow operatori (attuale: skeleton collegato alle API)

## Sicurezza (importante)

Durante l'analisi di `/home/funboy/eliza/.env` sono emerse molte chiavi/segreti operativi. È fortemente consigliata la rotazione dei segreti se sono stati condivisi/esposti in log o chat.

## Persistence Mode

- `BISPCRM_PERSISTENCE_MODE=memory` (default): runtime in-memory
- `BISPCRM_PERSISTENCE_MODE=postgres`: mirror write-through verso Postgres (best-effort; richiede DB + migrazioni)
- `BISPCRM_PERSISTENCE_MODE=hybrid`: alias operativo a `postgres` per evoluzione futura (read da DB + cache runtime)
- `BISPCRM_AUTO_LOAD_RUNTIME=true` (default in `postgres`/`hybrid`): tenta il caricamento del runtime da Postgres al boot API
- `BISPCRM_AUTO_SYNC_ON_CLOSE=true`: sincronizza runtime -> Postgres in shutdown (utile in dev controllato)

## Queue Mode

- `BISPCRM_QUEUE_MODE=inline` (default): invio/azioni inline
- `BISPCRM_QUEUE_MODE=redis`: abilita enqueue BullMQ via Redis
- `BISPCRM_QUEUE_SEND_OUTBOX=true`: `POST /api/outbox/:id/send` mette in coda su `social-publish` invece di inviare inline
- `BISPCRM_QUEUE_ORCHESTRATOR_EVENTS=true`: duplica gli eventi business in `orchestrator-events` (telemetria/worker pipeline)
- `BISPCRM_QUEUE_CONTENT_TASKS=true`: mette in coda i task `content` su `content-jobs` (oltre alla creazione immediata task/outbox)
- `BISPCRM_QUEUE_MEDIA_JOBS=true`: mette in coda la generazione media su `media-jobs` (persistita in tabella `media_jobs`)

## Auth Mode (RBAC)

- `BISPCRM_AUTH_MODE=header` (default): route sensibili protette con header `x-bisp-role`
- `BISPCRM_AUTH_MODE=none`: bypass RBAC (solo dev)

## Documentazione

- `docs/eliza-reuse-map.md`: mappa dei componenti Eliza riusabili
- `docs/architecture/monorepo-structure.md`: struttura e responsabilità
- `docs/architecture/orchestrator.md`: flusso orchestrator/scoring/handoff
- `docs/runbooks/local-setup.md`: setup locale senza Docker (Postgres/Redis opzionali)
