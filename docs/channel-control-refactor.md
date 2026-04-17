# Channel Control Refactor

## Goal

Turn Telegram and WhatsApp from thin transport adapters into a shared control surface for CopilotRM:

- consistent home/help/actions flow
- quick actions for approvals, queue health, integrations, outbox, workspace, agenda, shifts, and meeting creation
- conversational fallback for free text
- shared telemetry visible from admin
- Google Workspace as shared operational memory for channels
- one logic path reused by both channels
- customer-aware routing with approval-safe anagraphic creation and duplicate signaling

## Current Gaps

- Telegram and WhatsApp only send or receive plain text
- no shared channel session state
- no concept of panel, callback flow, or awaiting-input workflow
- Telegram inbound webhook emits the wrong event type
- WhatsApp inbound ignores interactive payloads
- admin can see adapter availability, but not real channel usage/control telemetry
- no shared operational memory for agenda, meetings, shifts, or sheet-driven knowledge
- no persistent group-aware control flow for WhatsApp
- no customer resolution memory shared between assist, CRM, and channels
- no live partial streaming visibility on the operator surfaces

## Refactor Strategy

### 1. Shared channel-control package

Add a dedicated package for:

- channel action catalog
- panel ids and labels
- text rendering helpers
- button layouts for Telegram/WhatsApp
- response instruction types shared across services

### 2. Central control runtime in api-core

Keep channel state in `api-core`, not in `gateway-channels`.

Responsibilities:

- per-peer channel session state
- awaiting-input workflows
- channel telemetry counters
- quick action execution
- conversational fallback through existing `/api/chat`
- workspace-aware queries grounded on synced Sheets + Calendar data
- customer resolution and commercial-history enrichment before agent handoff

This keeps Telegram and WhatsApp behavior aligned and gives admin a single data source.

### 3. Telegram upgrade

- fix inbound event typing
- support callback queries properly
- add editable panels plus explicit “new message” surfaces for main views
- support home, help, actions, approvals, outbox, status, integrations

### 4. WhatsApp upgrade

- support interactive buttons and list replies
- parse interactive inbound payloads
- reuse the same action catalog as Telegram
- send structured replies for main panels and quick actions
- support group-aware peer routing and optional group allowlist

### 5. Google Workspace operations

- dedicated Google Sheets + Calendar integration package
- periodic sync into Postgres
- natural-language answers for agenda, shifts, employee hours, shared appointments, and meetings
- meeting creation from bot flows using Google Calendar invites
- admin visibility over sync state and source data

### 6. Admin observability

Expose a dedicated admin endpoint with:

- top channel actions
- inbound message counters by channel
- active peer sessions
- pending approvals / queued outbox snapshot
- integrations and queue health summary

Add a lightweight manager view for this data.

### 7. Customer resolution and live drafting

- resolve or create customer records before free-form swarm work begins
- create `needs-approval` customers when identity is not certain
- surface duplicate candidates for human review
- attach opportunities and proposals to customer history
- expose partial agent drafting to the CRM frontend instead of only `typing`

## Scope of First Pass

Implemented in this refactor:

- shared package for channel control
- central channel-control repository/service in `api-core`
- Telegram callbacks and richer control panels
- WhatsApp interactive buttons and reply parsing
- WhatsApp group-aware routing
- TeGem/Gemini tab session routing for shared channel assistants and per-agent frontend orchestration
- Postgres persistence for channel peers/events
- Google Workspace sync + agenda/shift/meeting operations
- customer resolution records and customer opportunity history in Postgres
- admin endpoint + manager rendering for channel-control and workspace
- env/docs updates
- control-center auth tables and session-aware manager routing
- Team Hub page with broadcast, workspace Q&A, meeting creation, peer visibility, and synced agenda/shift panels
- Admin Panel page with DB-backed user lifecycle management
- live SSE chunk propagation from TeGem-compatible providers into CRM thread rendering
- channel replies enriched with execution artifacts that can be approved or completed directly from Telegram / WhatsApp
- dedupe of task / draft / opportunity artifacts so near-identical requests do not create duplicate operational output

Explicitly deferred:

- media-heavy bot features
- multi-tenant access policies beyond current allowlist/env model
- deep vertical workflows beyond Google Sheets + Calendar (HR/payroll/ERP native adapters)

## Acceptance Criteria

- Telegram `/start`, `/help`, `/actions`, `/outbox`, `/status` work as product surfaces
- Telegram callback buttons route to real actions
- WhatsApp can present and handle interactive actions
- WhatsApp group company flow can answer with workspace-backed data
- free-text from both channels still reaches conversational logic
- admin can inspect channel control metrics from `api-core`
- workspace state is persisted in Postgres and visible from admin
- ambiguous inbound customers never bypass review silently
- operators can see partial agent output while the answer is being composed
- pending drafts and tasks emitted by `/api/chat` can be acted on from Telegram / WhatsApp without switching to the manager UI
