import type { CustomerInteraction, CustomerProfile } from '@bisp/shared-types';

export class CustomerRepository {
  private customers = new Map<string, CustomerProfile>();

  upsert(customer: CustomerProfile): void {
    this.customers.set(customer.id, customer);
  }

  getById(id: string): CustomerProfile | undefined {
    return this.customers.get(id);
  }

  findByPhone(phone: string): CustomerProfile | undefined {
    return [...this.customers.values()].find((c) => c.phone === phone);
  }

  list(): CustomerProfile[] {
    return [...this.customers.values()];
  }

  listBySegment(segment: CustomerProfile['segments'][number]): CustomerProfile[] {
    return [...this.customers.values()].filter((c) => c.segments.includes(segment));
  }

  replaceAll(customers: CustomerProfile[]): void {
    this.customers.clear();
    customers.forEach((c) => this.customers.set(c.id, c));
  }

  addInteraction(customerId: string, interaction: Omit<CustomerInteraction, 'customerId'>): void {
    const customer = this.getById(customerId);
    if (!customer) return;
    if (!customer.interactions) customer.interactions = [];
    customer.interactions.push({ ...interaction, customerId });
    // backward compat: sync conversationNotes
    customer.conversationNotes.push(
      `[${new Date().toLocaleDateString('it-IT')}] ${interaction.summary}`
    );
  }
}
