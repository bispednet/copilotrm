import type { CustomerProfile } from '@bisp/shared-types';

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
}
