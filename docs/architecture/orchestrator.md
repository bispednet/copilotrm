# Orchestrator (Minimale)

## Input

- eventi assistenza
- eventi inbound customer care
- eventi ingest fatture/promo
- obiettivi manager attivi
- profilo cliente / consenso / saturazione

## Pipeline

1. Normalizzazione evento
2. Raccolta contesto (cliente, obiettivi, offerte, policy)
3. Generazione candidate actions via rules
4. Scoring/ranking (coerenza, obiettivi, marginalità, stock, consenso, saturazione, confidenza)
5. Handoff a uno o più agenti
6. Produzione task/proposte/campaign draft
7. Audit completo

## Human-in-the-loop

Default per comunicazioni pubbliche e per azioni con confidenza bassa.
