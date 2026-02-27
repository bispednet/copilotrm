import type { CommunicationDraft } from '@bisp/shared-types';

export class OutboxRepository {
  private drafts = new Map<string, CommunicationDraft>();

  add(draft: CommunicationDraft): void {
    this.drafts.set(draft.id, draft);
  }

  list(): CommunicationDraft[] {
    return [...this.drafts.values()];
  }
}
