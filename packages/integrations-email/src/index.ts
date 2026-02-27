import type { CommunicationDraft } from '@bisp/shared-types';

export class EmailChannelAdapter {
  async sendOrQueue(draft: CommunicationDraft): Promise<{ status: 'queued' | 'sent' }> {
    return { status: draft.needsApproval ? 'queued' : 'sent' };
  }
}
