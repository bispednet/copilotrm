# Mappa Riuso Eliza (Selettivo)

## Regola guida

Riuso selettivo, non fork cieco. Tutto il riuso è incapsulato in `packages/integrations-eliza`.

## Componenti analizzati in `/home/funboy/eliza`

### Riutilizzabili / adattabili subito

- `packages/core/src/defaultCharacter.ts`
  - Uso: riferimento per formato `Character`/persona assets
  - Azione: adattare a personas CopilotRM (agenti con tono/limiti/obiettivi)

- `packages/core/src/knowledge.ts`
  - Uso: pattern preprocess + split chunk + indicizzazione documenti/frammenti
  - Azione: adattare come utility RAG per knowledge locale CopilotRM

- `packages/core/src/ragknowledge.ts`
  - Uso: pattern `RAGKnowledgeManager` (query preprocess, retrieval, soglie)
  - Azione: creare interfacce/adapter CopilotRM per retrieval provider-agnostic

- `packages/core/src/memory.ts`
  - Uso: pattern memory manager + embedding fallback + ricerca semantica
  - Azione: estrarre astrazioni in `integrations-eliza` come reference API shape

- `packages/client-telegram/*`
  - Uso: pattern client lifecycle (`start/stop`) e config validation
  - Azione: wrapper canale Telegram in `packages/integrations-telegram`

- `packages/plugin-email-automation/*`
  - Uso: pattern plugin/service per email automation + throttling + template
  - Azione: wrapper per one-to-one email e policy/cooldown CopilotRM

### Da studiare come reference, non copiare nel MVP

- client/plugin social specifici al dominio crypto
- flow automatici troppo legati al vecchio stack
- modelli dati generici non allineati al dominio retail/assistenza CopilotRM

## Strategia di incapsulamento

- `packages/integrations-eliza`
  - `personaAdapter`: normalizza personas CopilotRM in formato compatibile/ispirato Eliza
  - `knowledgeAdapter`: preprocess/chunk/retrieval contracts (RAG)
  - `publishingAdapter`: interfaccia unica per social posting/scheduling
  - `pluginBridge`: wrapper per servizi/plugin selezionati

## Cosa NON fare

- import dipendenze Eliza sparse nei domain package
- accoppiare orchestrator con runtime Eliza
- usare automazioni social senza audit/policy/approvazione
