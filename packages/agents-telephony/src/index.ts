import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }

export class TelephonyAgent implements BusinessAgent {
  name = 'telephony';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'assistance.ticket.outcome' || eventType === 'offer.promo.ingested';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const p = ctx.event.payload as Record<string, unknown>;
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];

    if (ctx.event.type === 'assistance.ticket.outcome' && ((p.inferredSignals as string[] | undefined) ?? []).includes('gamer')) {
      tasks.push({ id: id('task'), kind: 'followup', title: 'Proposta connectivity gaming', assigneeRole: 'telephony', priority: 9, customerId: ctx.event.customerId, status: 'open', createdAt: new Date().toISOString() });
      drafts.push({ id: id('draft'), customerId: ctx.event.customerId, channel: 'whatsapp', audience: 'one-to-one', body: 'Se vuoi risolvere lag/ping possiamo proporti fibra + router/mesh ottimizzati per gaming. Ti preparo una proposta rapida?', needsApproval: true, reason: 'cross-sell gamer da assistenza', recipientRef: ctx.customer?.phone });
    }

    if (ctx.event.type === 'offer.promo.ingested') {
      const title = String(p.title ?? 'Promo smartphone');
      tasks.push({ id: id('task'), kind: 'campaign', title: `Campagna telefonia: ${title}`, assigneeRole: 'telephony-marketing', priority: 7, offerId: String(p.offerId ?? ''), status: 'open', createdAt: new Date().toISOString() });
      drafts.push({ id: id('draft'), channel: 'telegram', audience: 'one-to-many', body: `Nuova promo telefonia: ${title}. Scrivici per profilo e condizioni complete.`, relatedOfferId: String(p.offerId ?? ''), needsApproval: true, reason: 'promo smartphone bundle' });
    }

    return { agent: this.name, actions: [], tasks, drafts, notes: ['Telephony agent valutazione completata'] };
  }
}
