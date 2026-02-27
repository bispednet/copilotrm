import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export class EnergyAgent implements BusinessAgent {
  name = 'energy';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'assistance.ticket.outcome' || eventType === 'offer.promo.ingested';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const payload = ctx.event.payload as Record<string, unknown>;
    const signals = (payload.inferredSignals as string[] | undefined) ?? [];
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];

    if (ctx.event.type === 'assistance.ticket.outcome' && signals.includes('energia')) {
      tasks.push({
        id: id('task'),
        kind: 'followup',
        title: 'Follow-up energia: valutazione risparmio bolletta',
        assigneeRole: 'energy-consultant',
        priority: 6,
        customerId: ctx.event.customerId,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      drafts.push({
        id: id('draft'),
        customerId: ctx.event.customerId,
        channel: 'whatsapp',
        audience: 'one-to-one',
        body: 'Ti preparo una simulazione rapida per ridurre costi energia in base ai tuoi consumi. Vuoi procedere?',
        needsApproval: true,
        reason: 'cross-sell energia da segnale assistenza',
      });
    }

    if (ctx.event.type === 'offer.promo.ingested' && /energia|luce|gas/i.test(String(payload.title ?? ''))) {
      tasks.push({
        id: id('task'),
        kind: 'campaign',
        title: `Campagna energia: ${String(payload.title ?? 'Promo energia')}`,
        assigneeRole: 'energy-marketing',
        priority: 7,
        offerId: String(payload.offerId ?? ''),
        status: 'open',
        createdAt: new Date().toISOString(),
      });
    }

    return { agent: this.name, actions: [], tasks, drafts, notes: ['Energy agent valutazione completata'] };
  }
}
