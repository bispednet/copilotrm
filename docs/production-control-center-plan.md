# CopilotRM Production Control Center Plan

## Goal

Turn `copilotrm` into the single operational control center for a small/medium IT, telecom, energy, assistance, and retail business.

The product must provide:

- a public home portal on `www.eeess.cyou`
- authenticated control-center access for administration and team operations
- consistent navigation across Assist, CRM, Manager, API, and VNC
- persistent user management
- team coordination across WhatsApp, Telegram, Google Calendar, and Google Sheets
- natural-language flows for non-technical operators
- persistent customer identity resolution, duplicate review, and lifetime commercial history
- live multi-agent streaming so operators can see the reasoning thread forming in real time

## Product Surfaces

### 1. Public Home Portal

Primary entry point on `www.eeess.cyou` and optionally `eeess.cyou`.

Required actions:

- Home
- Assist Desk
- CRM
- Team
- Admin Panel
- API Status
- Playwright / VNC

The home page must explain what each area does and route operators without ambiguity.

### 2. Assist Desk

Purpose:

- customer intake
- device acceptance
- ticket creation
- guided NLP form filling
- handoff to operational flows

Required navigation:

- Home
- CRM
- Team
- Admin Panel
- Manager

### 3. CRM Consult

Purpose:

- consultative selling
- proposal generation
- campaign planning
- next-best-action support

Required navigation:

- Home
- Assist
- Team
- Admin Panel
- Manager

### 4. Manager Control Center

Purpose:

- the authenticated operational cockpit
- users, system settings, infra, channels, workspace, approvals, KPI

This becomes the real control center instead of the current header-role simulation.

## Authentication and Access Model

### Control-center auth

Use database-backed control-center users and sessions.

Required capabilities:

- bootstrap first admin
- login / logout
- session restore
- role-based access
- disabled users
- session expiry

### Roles

Persist and enforce:

- admin
- manager
- assist
- sales
- customer-care
- content
- viewer

The UI must reflect the actual authenticated user, not a fake role switch.

## Core Pages Inside Manager

### Customer Control

Purpose:

- inspect customer master records
- review ambiguous or duplicate contacts
- approve new customer entries created from inbound channels or assist flows
- inspect full commercial and operational history per customer

Must include:

- pending customer approvals
- possible duplicate clusters
- customer timeline
- attached opportunities, proposals, tickets, and follow-ups
- manual merge/reject/approve actions

### Home

Purpose:

- system summary
- KPI
- pending actions
- quick access to Team, Admin Panel, Assist, CRM, Campaigns, Outbox

Must include:

- clear quick actions
- current operator identity
- system status
- highest-priority operational items

### Team

Purpose:

- centralize internal coordination
- manage group communications
- monitor synced team data
- create meetings
- query workspace knowledge in natural language

Must include:

- WhatsApp group operations
- Telegram group operations
- Google Calendar agenda
- Google Sheets-derived shifts and structured rows
- workspace sync status
- natural-language workspace assistant
- meeting creation from natural language
- team broadcast composer
- recent channel peers and activity

### Admin Panel

Purpose:

- user lifecycle management
- environment/integration status
- runtime settings
- infra visibility
- queues / persistence / system services visibility

Must include:

- users table
- create user
- role and status editing
- password reset/change
- env status matrix
- runtime settings editor
- infra snapshot
- channel telemetry

### Existing Operational Pages

Keep and normalize:

- Data Hub
- Assist Desk
- CRM Consult
- Campaigns
- Swarm Studio
- Content Cards
- Events / Scheduler
- Outbox / Approvals
- CEO Objectives
- Character Studio
- Infra
- Ingest

These pages should be reachable from the control center without feeling like separate products.

## Customer Identity and History Model

The system must treat customer identity as a first-class operational object.

Rules:

- every inbound contact is matched against existing customers by phone, email, and name similarity
- if certainty is low, create a new record as `needs-approval`
- if similar customers exist, surface duplicates for human review before the record is treated as canonical
- every proposal, opportunity, consult output, and follow-up must remain linked to the customer forever
- assist outcomes and commercial actions must enrich the same customer history instead of producing detached drafts

This is required to avoid:

- duplicate customers
- lost offer history
- orphaned proposals
- weak agent context on follow-up conversations

## Backend Work Required

### Auth/session endpoints

- `GET /api/auth/bootstrap-status`
- `POST /api/auth/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Admin endpoints

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`

### Team endpoints

- `GET /api/team/overview`
- `POST /api/team/workspace-query`
- `POST /api/team/meetings`
- `POST /api/team/broadcast`

### Customer endpoints

- `POST /api/customers/resolve`
- `PATCH /api/customers/:id/approval`
- `GET /api/customers/:id/opportunities`
- `GET /api/customers/:id/resolutions`

### Authorization model

All existing privileged endpoints must accept:

- authenticated session token
- legacy header role only as compatibility path

## UX Principles

The target user is not technical.

Therefore:

- every page needs obvious navigation
- `Home` must always exist
- `Admin Panel` and `Team` must be explicit
- labels must be operational, not developer-centric
- natural language inputs must include examples
- dangerous operations must be clearly framed
- empty states must explain what to do next
- admin pages must be readable by an entrepreneur, not just an engineer
- live agent threads must show partial drafting, not only a generic typing indicator

## Swarm Quality Rules

To avoid shallow, premature, or commercially dangerous outputs, the swarm must enforce:

- no offer proposal before minimum factual data exists
- explicit uncertainty handling
- dedicated customer-resolution participation when identity is unclear
- product/offers lookup grounded on active catalog data, not assumptions
- critique before final synthesis when commercial or technical claims are weak

The final output should always distinguish:

- verified facts
- missing data
- next action
- commercial opportunity, if and only if grounded

## Deployment Expectations

- no placeholder routes
- no fake auth for the control center
- no silent failures for team operations
- no partial UI dead ends
- build must pass
- docs must be updated

## Execution Order

1. Replace fake role simulation with real control-center auth.
2. Add manager hash/deep-link routing for `home`, `team`, and `admin`.
3. Add common `Home` entry in all web apps.
4. Build Team page on top of existing channel/workspace integrations.
5. Add Admin Panel user management on top of new control-center tables.
6. Add customer-resolution and customer-history control surfaces.
7. Expose live streaming agent thread in CRM and channel surfaces.
8. Update portal tiles and links so the landing page exposes Team/Admin clearly.
9. Refresh docs and production usage notes.
