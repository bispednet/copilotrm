import { deriveHandoffs } from '@bisp/orchestrator-handoffs';
import { deriveRuleCandidates } from '@bisp/orchestrator-rules';
import { rankActions } from '@bisp/orchestrator-scoring';
import { makeAuditRecord } from '@bisp/shared-audit';
import type {
  AgentExecutionResult,
  BusinessAgent,
  CommunicationDraft,
  OrchestratorContext,
  OrchestratorOutput,
  TaskItem,
} from '@bisp/shared-types';

export class CopilotRMOrchestrator {
  constructor(private readonly agents: BusinessAgent[]) {}

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
}
