import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }

export class CustomerCareAgent implements BusinessAgent {
  name = 'customer-care';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'inbound.email.received' || eventType === 'inbound.whatsapp.received';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const p = ctx.event.payload as Record<string, unknown>;
    const text = `${p.subject ?? ''} ${p.body ?? ''}`.toLowerCase();
    const urgent = /non ho ricevuto|ritardo|reclamo|contratt/.test(text);
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];

    if (urgent) {
      tasks.push({ id: id('task'), kind: 'customer-care', title: 'Verifica stato pratica e risposta cliente', assigneeRole: 'customer-care', priority: 10, customerId: ctx.event.customerId, status: 'open', createdAt: new Date().toISOString() });
      drafts.push({ id: id('draft'), customerId: ctx.event.customerId, channel: 'email', audience: 'one-to-one', subject: 'Aggiornamento sulla tua pratica', body: 'Stiamo verificando subito lo stato della pratica. Ti aggiorniamo a breve con esito e prossimi passaggi.', needsApproval: false, reason: 'risposta customer care suggerita', recipientRef: ctx.customer?.email });
    }

    return { agent: this.name, actions: [], tasks, drafts, notes: urgent ? ['Classificato come post-vendita critico'] : ['Nessun caso critico rilevato'] };
  }
}
