import type { CommunicationDraft, ContentCard, TaskItem } from '@bisp/shared-types';

export interface OutboxItem {
  id: string;
  draft: CommunicationDraft;
  status: 'pending-approval' | 'approved' | 'queued' | 'sent' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  sentAt?: string;
  externalId?: string;
  createdAt?: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  offerId?: string;
  segment?: string;
  status: 'draft' | 'approved' | 'queued' | 'sent';
  outboxIds: string[];
  taskIds: string[];
  createdAt: string;
}

export class TaskRepository {
  private tasks = new Map<string, TaskItem>();

  add(task: TaskItem): void {
    this.tasks.set(task.id, task);
  }

  upsert(task: TaskItem): void {
    this.tasks.set(task.id, task);
  }

  addMany(tasks: TaskItem[]): void {
    tasks.forEach((t) => this.add(t));
  }

  list(filters?: { status?: TaskItem['status']; kind?: TaskItem['kind'] }): TaskItem[] {
    return [...this.tasks.values()].filter((t) => {
      if (filters?.status && t.status !== filters.status) return false;
      if (filters?.kind && t.kind !== filters.kind) return false;
      return true;
    });
  }

  getById(id: string): TaskItem | undefined {
    return this.tasks.get(id);
  }

  update(id: string, patch: Partial<TaskItem>): TaskItem | undefined {
    const curr = this.tasks.get(id);
    if (!curr) return undefined;
    const next = { ...curr, ...patch };
    this.tasks.set(id, next);
    return next;
  }

  replaceAll(tasks: TaskItem[]): void {
    this.tasks.clear();
    tasks.forEach((t) => this.tasks.set(t.id, t));
  }
}

export class OutboxStore {
  private items = new Map<string, OutboxItem>();

  addDraft(draft: CommunicationDraft): OutboxItem {
    const item: OutboxItem = {
      id: draft.id,
      draft,
      status: draft.needsApproval ? 'pending-approval' : 'approved',
      createdAt: new Date().toISOString(),
    };
    this.items.set(item.id, item);
    return item;
  }

  upsertItem(item: OutboxItem): OutboxItem {
    this.items.set(item.id, item);
    return item;
  }

  addMany(drafts: CommunicationDraft[]): OutboxItem[] {
    return drafts.map((d) => this.addDraft(d));
  }

  list(filters?: { status?: OutboxItem['status']; channel?: CommunicationDraft['channel'] }): OutboxItem[] {
    return [...this.items.values()].filter((i) => {
      if (filters?.status && i.status !== filters.status) return false;
      if (filters?.channel && i.draft.channel !== filters.channel) return false;
      return true;
    });
  }

  getById(id: string): OutboxItem | undefined {
    return this.items.get(id);
  }

  update(id: string, patch: Partial<OutboxItem>): OutboxItem | undefined {
    const curr = this.items.get(id);
    if (!curr) return undefined;
    const next = {
      ...curr,
      ...patch,
      draft: patch.draft ? patch.draft : curr.draft,
    };
    this.items.set(id, next);
    return next;
  }

  replaceAll(items: OutboxItem[]): void {
    this.items.clear();
    items.forEach((i) => this.items.set(i.id, i));
  }
}

export class ContentCardRepository {
  private cards = new Map<string, ContentCard>();

  add(card: ContentCard): ContentCard {
    this.cards.set(card.id, card);
    return card;
  }

  list(filters?: { approvalStatus?: ContentCard['approvalStatus'] }): ContentCard[] {
    return [...this.cards.values()]
      .filter((c) => {
        if (filters?.approvalStatus && c.approvalStatus !== filters.approvalStatus) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getById(id: string): ContentCard | undefined {
    return this.cards.get(id);
  }

  update(id: string, patch: Partial<ContentCard>): ContentCard | undefined {
    const curr = this.cards.get(id);
    if (!curr) return undefined;
    const next = { ...curr, ...patch };
    this.cards.set(id, next);
    return next;
  }
}

export class CampaignRepository {
  private records = new Map<string, CampaignRecord>();

  add(record: CampaignRecord): void {
    this.records.set(record.id, record);
  }

  upsert(record: CampaignRecord): void {
    this.records.set(record.id, record);
  }

  list(): CampaignRecord[] {
    return [...this.records.values()];
  }

  getById(id: string): CampaignRecord | undefined {
    return this.records.get(id);
  }

  update(id: string, patch: Partial<CampaignRecord>): CampaignRecord | undefined {
    const curr = this.records.get(id);
    if (!curr) return undefined;
    const next = { ...curr, ...patch };
    this.records.set(id, next);
    return next;
  }

  replaceAll(records: CampaignRecord[]): void {
    this.records.clear();
    records.forEach((r) => this.records.set(r.id, r));
  }
}
