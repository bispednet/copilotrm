import { deriveHandoffs } from '@bisp/orchestrator-handoffs';
import { deriveRuleCandidates } from '@bisp/orchestrator-rules';
import { rankActions } from '@bisp/orchestrator-scoring';
import { makeAuditRecord } from '@bisp/shared-audit';
import type {
  AgentEvaluator,
  AgentExecutionResult,
  AgentProvider,
  BusinessAgent,
  CommunicationDraft,
  EnrichedOrchestratorContext,
  OrchestratorContext,
  OrchestratorOutput,
  TaskItem,
} from '@bisp/shared-types';

export interface OrchestratorConfig {
  agents: BusinessAgent[];
  providers?: AgentProvider[];
  evaluators?: AgentEvaluator[];
}

export class CopilotRMOrchestrator {
  private readonly agents: BusinessAgent[];
  private readonly providers: AgentProvider[];
  private readonly evaluators: AgentEvaluator[];

  constructor(agentsOrConfig: BusinessAgent[] | OrchestratorConfig) {
    if (Array.isArray(agentsOrConfig)) {
      this.agents = agentsOrConfig;
      this.providers = [];
      this.evaluators = [];
    } else {
      this.agents = agentsOrConfig.agents;
      this.providers = agentsOrConfig.providers ?? [];
      this.evaluators = agentsOrConfig.evaluators ?? [];
    }
  }

  /** Run sincrono — nessun provider/evaluator async (retrocompatibilità) */
  run(ctx: OrchestratorContext): OrchestratorOutput {
    const auditRecords = [makeAuditRecord('orchestrator', 'event.received', { eventType: ctx.event.type, eventId: ctx.event.id })];

    const ruleCandidates = deriveRuleCandidates(ctx.event, ctx.activeOffers);
    auditRecords.push(makeAuditRecord('orchestrator', 'rules.candidates.generated', { count: ruleCandidates.length }));

    const rankedActions = rankActions(ctx, ruleCandidates);
    auditRecords.push(makeAuditRecord('orchestrator', 'actions.ranked', {
      topAction: rankedActions[0]?.title,
      topScore: rankedActions[0]?.scoreBreakdown?.total,
      count: rankedActions.length,
    }));

    const handoffs = deriveHandoffs(rankedActions);
    auditRecords.push(makeAuditRecord('orchestrator', 'handoffs.derived', { handoffs }));

    const executions: AgentExecutionResult[] = [];
    for (const agent of this.agents.filter((a) => a.supports(ctx.event.type))) {
      executions.push(agent.execute(ctx));
    }
    auditRecords.push(makeAuditRecord('orchestrator', 'agents.executed', { agents: executions.map((x) => x.agent) }));

    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];
    for (const exec of executions) {
      tasks.push(...exec.tasks);
      drafts.push(...exec.drafts);
      auditRecords.push(makeAuditRecord(exec.agent, 'agent.notes', { notes: exec.notes }));
    }

    for (const action of rankedActions) {
      auditRecords.push(makeAuditRecord('orchestrator', 'candidate.scored', {
        actionId: action.id,
        title: action.title,
        agent: action.agent,
        score: action.scoreBreakdown,
      }));
    }

    return { rankedActions, tasks, drafts, auditRecords };
  }

  /**
   * Run asincrono con Pattern AEP completo:
   * 1. Provider — arricchiscono il contesto con dati esterni (Danea, RSS, RAG)
   * 2. Agenti — eseguono la logica di business sul contesto arricchito
   * 3. Evaluator — valutano i risultati e possono aggiungere note/boosts
   */
  async runAsync(ctx: OrchestratorContext): Promise<OrchestratorOutput> {
    const auditRecords = [makeAuditRecord('orchestrator', 'event.received', { eventType: ctx.event.type, eventId: ctx.event.id })];

    // ── 1. Providers ─────────────────────────────────────────────────────────
    const enrichedData: Record<string, unknown> = {};
    for (const provider of this.providers) {
      try {
        enrichedData[provider.name] = await provider.provide(ctx);
      } catch (err) {
        auditRecords.push(makeAuditRecord('orchestrator', 'provider.error', {
          provider: provider.name,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    const enrichedCtx: EnrichedOrchestratorContext = { ...ctx, enrichedData };
    auditRecords.push(makeAuditRecord('orchestrator', 'providers.run', { providers: this.providers.map((p) => p.name) }));

    // ── 2. Rules + ranking ────────────────────────────────────────────────────
    const ruleCandidates = deriveRuleCandidates(enrichedCtx.event, enrichedCtx.activeOffers);
    const rankedActions = rankActions(enrichedCtx, ruleCandidates);
    const handoffs = deriveHandoffs(rankedActions);
    auditRecords.push(makeAuditRecord('orchestrator', 'actions.ranked', {
      count: rankedActions.length,
      topAction: rankedActions[0]?.title,
      handoffs,
    }));

    // ── 3. Agents ─────────────────────────────────────────────────────────────
    const executions: AgentExecutionResult[] = [];
    for (const agent of this.agents.filter((a) => a.supports(enrichedCtx.event.type))) {
      executions.push(agent.execute(enrichedCtx));
    }
    auditRecords.push(makeAuditRecord('orchestrator', 'agents.executed', { agents: executions.map((x) => x.agent) }));

    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];
    for (const exec of executions) {
      tasks.push(...exec.tasks);
      drafts.push(...exec.drafts);
      auditRecords.push(makeAuditRecord(exec.agent, 'agent.notes', { notes: exec.notes }));
    }

    // ── 4. Evaluators ─────────────────────────────────────────────────────────
    for (const evaluator of this.evaluators) {
      try {
        const result = await evaluator.evaluate(enrichedCtx, executions);
        auditRecords.push(makeAuditRecord('orchestrator', 'evaluator.result', {
          evaluator: evaluator.name,
          shouldContinue: result.shouldContinue,
          notes: result.notes,
        }));
      } catch (err) {
        auditRecords.push(makeAuditRecord('orchestrator', 'evaluator.error', {
          evaluator: evaluator.name,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    return { rankedActions, tasks, drafts, auditRecords };
  }
}

// ─── Concrete Providers ───────────────────────────────────────────────────────

export { createDaneaDataProvider } from './providers/daneaDataProvider.js';
export { createRssNewsProvider } from './providers/rssNewsProvider.js';
export { createRAGKnowledgeProvider } from './providers/ragKnowledgeProvider.js';
