import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }

export class PreventiviAgent implements BusinessAgent {
  name = 'preventivi';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'assistance.ticket.outcome';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const payload = ctx.event.payload as Record<string, unknown>;
    if (payload.outcome !== 'not-worth-repairing') return { agent: this.name, actions: [], tasks: [], drafts: [], notes: ['Nessuna azione preventivi'] };

    const topHardware = ctx.activeOffers.filter((o) => o.category === 'hardware').slice(0, 3);
    const body = [
      'Ti preparo 3 opzioni sostitutive in linea con il tuo uso:',
      ...topHardware.map((o, i) => `${i + 1}. ${o.title} ${o.suggestedPrice ? `- ${o.suggestedPrice}€` : ''}`),
      'Possiamo aggiungere bundle accessori e configurazione rapida in negozio.'
    ].join('\n');

    const task: TaskItem = {
      id: id('task'), kind: 'followup', title: 'Invio preventivo sostituzione 3 fasce', assigneeRole: 'sales', priority: 8,
      customerId: ctx.event.customerId, status: 'open', createdAt: new Date().toISOString()
    };
    const draft: CommunicationDraft = {
      id: id('draft'), customerId: ctx.event.customerId, channel: 'whatsapp', audience: 'one-to-one', body,
      relatedOfferId: topHardware[0]?.id, needsApproval: true, reason: 'preventivo da esito assistenza'
    };
    return { agent: this.name, actions: [], tasks: [task], drafts: [draft], notes: ['Generate 3 alternative preventivo'] };
  }
}
