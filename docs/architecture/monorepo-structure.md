# Struttura Monorepo

## Principi

- domini separati da orchestrazione
- orchestrazione separata da integrazioni canale
- riuso Eliza incapsulato
- on-prem first (DB/queue/object storage swappable)

## Flusso alto livello

Evento -> `orchestrator-core` -> scoring/rules/handoffs -> agenti -> task/proposta -> audit -> (eventuale) channel adapter -> audit esito
