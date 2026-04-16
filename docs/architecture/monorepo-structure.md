# Struttura Monorepo

## Principi

- domini separati da orchestrazione
- orchestrazione separata da integrazioni canale
- controllo canale separato dagli adapter, ma condiviso tra Telegram e WhatsApp
- workspace operations separate dagli adapter, ma condivise tra canali e admin UI
- riuso Eliza incapsulato
- on-prem first (DB/queue/object storage swappable)

## Flusso alto livello

Evento -> `orchestrator-core` -> scoring/rules/handoffs -> agenti -> task/proposta -> audit -> (eventuale) `channel-control` -> `integrations-google-workspace` / channel adapter -> audit esito
