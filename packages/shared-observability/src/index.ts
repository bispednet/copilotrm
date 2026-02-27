export interface CounterSnapshot {
  name: string;
  value: number;
  tags: Record<string, string>;
}

export class InMemoryMetrics {
  private counters = new Map<string, CounterSnapshot>();

  inc(name: string, tags: Record<string, string> = {}, amount = 1): void {
    const key = `${name}:${JSON.stringify(tags)}`;
    const current = this.counters.get(key);
    if (current) {
      current.value += amount;
      return;
    }
    this.counters.set(key, { name, value: amount, tags });
  }

  list(): CounterSnapshot[] {
    return Array.from(this.counters.values());
  }
}

export function traceId(prefix = 'trace'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}
