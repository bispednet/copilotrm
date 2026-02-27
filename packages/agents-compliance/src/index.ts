import type { BusinessAgent, AgentExecutionResult, DomainEvent, OrchestratorContext } from '@bisp/shared-types';

export class ComplianceAgent implements BusinessAgent {
  name = 'compliance';

  supports(_eventType: DomainEvent['type']): boolean {
    return true;
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const notes: string[] = [];
    if (ctx.customer) {
      if (!ctx.customer.consents.email && (ctx.event.type === 'inbound.email.received')) {
        notes.push('Inbound consent check skipped (inbound allowed), outbound remains restricted');
      }
      if (ctx.customer.commercialSaturationScore > 80) {
        notes.push('Cliente con saturazione alta: preferire approvazione manuale');
      }
    }
    return { agent: this.name, actions: [], tasks: [], drafts: [], notes };
  }
}
