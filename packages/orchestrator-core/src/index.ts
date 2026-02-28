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
import type { SwarmRuntime } from '@bisp/domain-swarm';

// Tiny UID — no external dep
function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

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

  /**
   * runSwarm — ciclo swarm completo con persistenza in SwarmRuntime.
   * Ogni agente produce SwarmMessages (observation, proposal).
   * Gli handoff vengono eseguiti in catena (max maxHops salti).
   * run() e runAsync() rimangono invariati per backward compat.
   */
  async runSwarm(
    ctx: OrchestratorContext,
    runtime: SwarmRuntime,
    opts?: { maxHops?: number },
  ): Promise<{ output: OrchestratorOutput; runId: string }> {
    const maxHops = opts?.maxHops ?? 3;
    const runId = uid();

    runtime.createRun({
      id: runId,
      eventId: ctx.event.id,
      eventType: ctx.event.type,
      customerId: ctx.event.customerId,
      status: 'running',
      startedAt: new Date().toISOString(),
      agentsInvolved: [],
    });

    const allTasks: TaskItem[] = [];
    const allDrafts: CommunicationDraft[] = [];
    const allAudit = [makeAuditRecord('orchestrator', 'swarm.run.started', { runId, eventType: ctx.event.type })];
    let stepNo = 0;

    // ── Fase 1: agenti che supportano l'eventType ──────────────────────────
    for (const agent of this.agents.filter((a) => a.supports(ctx.event.type))) {
      const stepId = uid();
      runtime.addStep({
        id: stepId, runId, agent: agent.name, stepNo: stepNo++,
        inputSummary: ctx.event.type,
        tasksCreated: 0, draftsCreated: 0,
        startedAt: new Date().toISOString(),
        status: 'running',
      });

      const exec = agent.execute(ctx);

      if (exec.notes.length > 0) {
        runtime.addMessage({
          id: uid(), runId, stepNo: stepNo - 1,
          fromAgent: agent.name, kind: 'observation',
          content: exec.notes.join(' | '),
          createdAt: new Date().toISOString(),
        });
      }
      for (const draft of exec.drafts) {
        runtime.addMessage({
          id: uid(), runId, stepNo: stepNo - 1,
          fromAgent: agent.name, kind: 'proposal',
          content: `[${draft.channel}] ${draft.body.slice(0, 120)}${draft.body.length > 120 ? '…' : ''}`,
          createdAt: new Date().toISOString(),
        });
      }

      runtime.updateStep(stepId, runId, {
        status: 'completed', finishedAt: new Date().toISOString(),
        tasksCreated: exec.tasks.length, draftsCreated: exec.drafts.length,
      });

      allTasks.push(...exec.tasks);
      allDrafts.push(...exec.drafts);
      allAudit.push(makeAuditRecord(agent.name, 'agent.notes', { notes: exec.notes }));
    }

    // ── Fase 2: scoring + handoff eseguibili ──────────────────────────────
    const ruleCandidates = deriveRuleCandidates(ctx.event, ctx.activeOffers);
    const rankedActions = rankActions(ctx, ruleCandidates);
    const handoffEdges = deriveHandoffs(rankedActions);
    let hopsUsed = 0;

    for (const edge of handoffEdges) {
      const handoffId = uid();
      runtime.addHandoff({
        id: handoffId, runId,
        fromAgent: edge.fromAgent, toAgent: edge.toAgent,
        reason: edge.reason, sourceActionId: edge.sourceActionId,
        blocking: edge.blocking, requiresApproval: edge.requiresApproval,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      runtime.addMessage({
        id: uid(), runId, stepNo: stepNo,
        fromAgent: edge.fromAgent, toAgent: edge.toAgent,
        kind: 'handoff', content: edge.reason,
        createdAt: new Date().toISOString(),
      });

      if (!edge.requiresApproval && hopsUsed < maxHops) {
        const targetAgent = this.agents.find((a) => a.name === edge.toAgent);
        if (targetAgent) {
          hopsUsed++;
          const hopStepId = uid();
          runtime.addStep({
            id: hopStepId, runId, agent: edge.toAgent, stepNo: stepNo++,
            inputSummary: `handoff: ${edge.reason}`,
            tasksCreated: 0, draftsCreated: 0,
            startedAt: new Date().toISOString(), status: 'running',
          });

          const hopExec = targetAgent.execute(ctx);

          if (hopExec.notes.length > 0) {
            runtime.addMessage({
              id: uid(), runId, stepNo: stepNo - 1,
              fromAgent: edge.toAgent, kind: 'decision',
              content: hopExec.notes.join(' | '),
              createdAt: new Date().toISOString(),
            });
          }
          for (const draft of hopExec.drafts) {
            runtime.addMessage({
              id: uid(), runId, stepNo: stepNo - 1,
              fromAgent: edge.toAgent, kind: 'proposal',
              content: `[${draft.channel}] ${draft.body.slice(0, 120)}${draft.body.length > 120 ? '…' : ''}`,
              createdAt: new Date().toISOString(),
            });
          }

          runtime.updateStep(hopStepId, runId, {
            status: 'completed', finishedAt: new Date().toISOString(),
            tasksCreated: hopExec.tasks.length, draftsCreated: hopExec.drafts.length,
          });
          runtime.updateHandoff(handoffId, runId, { status: 'executed' });

          // Notifica callback interazione se disponibile nel contesto
          if (ctx.onInteraction) {
            ctx.onInteraction({
              id: uid(),
              type: 'handoff.received',
              channel: edge.toAgent,
              agentName: edge.toAgent,
              summary: `Handoff ${edge.fromAgent}→${edge.toAgent}: ${edge.reason}`,
              relatedRunId: runId,
              createdAt: new Date().toISOString(),
            });
          }

          allTasks.push(...hopExec.tasks);
          allDrafts.push(...hopExec.drafts);
          allAudit.push(makeAuditRecord(edge.toAgent, 'agent.notes', { notes: hopExec.notes }));
        } else {
          runtime.updateHandoff(handoffId, runId, { status: 'skipped' });
        }
      }
    }

    // ── Fase 3: completa run ──────────────────────────────────────────────
    const agentsInvolved = [...new Set(runtime.listMessages(runId).map((m) => m.fromAgent))];
    runtime.updateRun(runId, {
      status: 'completed',
      finishedAt: new Date().toISOString(),
      topActionId: rankedActions[0]?.id,
      topActionScore: rankedActions[0]?.scoreBreakdown?.total,
      agentsInvolved,
    });

    allAudit.push(makeAuditRecord('orchestrator', 'swarm.run.completed', {
      runId, agents: agentsInvolved,
      tasks: allTasks.length, drafts: allDrafts.length,
    }));

    return {
      output: { rankedActions, tasks: allTasks, drafts: allDrafts, auditRecords: allAudit },
      runId,
    };
  }
}

// ─── Concrete Providers ───────────────────────────────────────────────────────

export { createDaneaDataProvider } from './providers/daneaDataProvider.js';
export { createRssNewsProvider } from './providers/rssNewsProvider.js';
export { createRAGKnowledgeProvider } from './providers/ragKnowledgeProvider.js';
