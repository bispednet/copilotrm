import type { AgentExecutionResult, BusinessAgent, CommunicationDraft, DomainEvent, OrchestratorContext, TaskItem } from '@bisp/shared-types';

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export class HardwareAgent implements BusinessAgent {
  name = 'hardware';

  supports(eventType: DomainEvent['type']): boolean {
    return eventType === 'danea.invoice.ingested' || eventType === 'assistance.ticket.outcome';
  }

  execute(ctx: OrchestratorContext): AgentExecutionResult {
    const payload = ctx.event.payload as Record<string, unknown>;
    const signals = (payload.inferredSignals as string[] | undefined) ?? [];
    const tasks: TaskItem[] = [];
    const drafts: CommunicationDraft[] = [];

    if (ctx.event.type === 'danea.invoice.ingested') {
      const lines = (payload.lines as Array<{ description?: string }> | undefined) ?? [];
      const hasHardware = lines.some((line) => /gpu|rtx|ssd|notebook|pc|monitor|router|mesh/i.test(String(line.description ?? '')));
      if (hasHardware) {
        tasks.push({
          id: id('task'),
          kind: 'content',
          title: 'Scheda prodotto + script banco per nuovo stock hardware',
          assigneeRole: 'hardware-specialist',
          priority: 7,
          status: 'open',
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (ctx.event.type === 'assistance.ticket.outcome' && (signals.includes('gamer') || signals.includes('upgrade-hardware'))) {
      drafts.push({
        id: id('draft'),
        customerId: ctx.event.customerId,
        channel: 'whatsapp',
        audience: 'one-to-one',
        body: 'Dal controllo tecnico vedo margine per upgrade hardware/rete domestica (mesh, cablaggio o componenti). Vuoi una proposta in 3 fasce?',
        needsApproval: true,
        reason: 'cross-sell hardware da assistenza',
      });
    }

    return { agent: this.name, actions: [], tasks, drafts, notes: ['Hardware agent valutazione completata'] };
  }
}
