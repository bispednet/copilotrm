import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }

export class ContentAgent implements BusinessAgent {
  name = 'content';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'danea.invoice.ingested' || eventType === 'offer.promo.ingested';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const p = ctx.event.payload as Record<string, unknown>;
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];

    if (ctx.event.type === 'danea.invoice.ingested') {
      tasks.push({ id: id('task'), kind: 'content', title: 'Genera pacchetto content da nuovo stock', assigneeRole: 'content', priority: 7, status: 'open', createdAt: new Date().toISOString() });
      drafts.push({ id: id('draft'), channel: 'telegram', audience: 'one-to-many', body: 'Nuovi arrivi in negozio: stock hardware selezionato disponibile. Scrivici per configurazioni e bundle.', needsApproval: true, reason: 'nuovo stock da fattura' });
    }

    if (ctx.event.type === 'offer.promo.ingested') {
      const title = String(p.title ?? 'Promo');
      tasks.push({ id: id('task'), kind: 'content', title: `Pacchetto social/blog per ${title}`, assigneeRole: 'content', priority: 6, offerId: String(p.offerId ?? ''), status: 'open', createdAt: new Date().toISOString() });
    }

    return { agent: this.name, actions: [], tasks, drafts, notes: ['Content factory draft creati'] };
  }
}
