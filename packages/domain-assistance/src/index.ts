import type { AssistanceTicket } from '@bisp/shared-types';

export class AssistanceRepository {
  private tickets = new Map<string, AssistanceTicket>();

  upsert(ticket: AssistanceTicket): void {
    this.tickets.set(ticket.id, ticket);
  }

  getById(id: string): AssistanceTicket | undefined {
    return this.tickets.get(id);
  }

  list(): AssistanceTicket[] {
    return [...this.tickets.values()];
  }

  replaceAll(tickets: AssistanceTicket[]): void {
    this.tickets.clear();
    tickets.forEach((t) => this.tickets.set(t.id, t));
  }
}
