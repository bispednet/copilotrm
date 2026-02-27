import type { CommunicationDraft } from '@bisp/shared-types';

export interface PublishingAdapter {
  publish(draft: CommunicationDraft): Promise<{ externalId: string; status: 'queued' | 'sent' }>;
}

export class ElizaPublishingAdapterStub implements PublishingAdapter {
  async publish(draft: CommunicationDraft): Promise<{ externalId: string; status: 'queued' | 'sent' }> {
    return {
      externalId: `eliza_stub_${draft.channel}_${Math.random().toString(36).slice(2, 8)}`,
      status: draft.needsApproval ? 'queued' : 'sent',
    };
  }
}
