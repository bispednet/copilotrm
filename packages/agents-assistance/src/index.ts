import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AssistanceAgent implements BusinessAgent {
  name = 'assistance';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType.startsWith('assistance.');
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];
    const p = ctx.event.payload as Record<string, unknown>;
    if (ctx.event.type === 'assistance.ticket.outcome' && p.outcome === 'not-worth-repairing') {
      tasks.push({
        id: id('task'), kind: 'approval', title: 'Valida handoff a preventivi (sostituzione)', assigneeRole: 'assist-manager', priority: 9,
        customerId: ctx.event.customerId, ticketId: String(p.ticketId ?? ''), status: 'open', createdAt: new Date().toISOString()
      });
      drafts.push({
        id: id('draft'), customerId: ctx.event.customerId, channel: 'whatsapp', audience: 'one-to-one',
        body: 'Abbiamo verificato il dispositivo: la riparazione non conviene. Posso prepararti 3 alternative (economica, bilanciata, top) adatte al tuo uso.',
        needsApproval: true, reason: 'assistance outcome non conveniente',
        recipientRef: ctx.customer?.phone,
      });
    }
    return { agent: this.name, actions: [], tasks, drafts, notes: ['Analisi ticket completata', 'Trigger commerciali valutati'] };
  }
}
