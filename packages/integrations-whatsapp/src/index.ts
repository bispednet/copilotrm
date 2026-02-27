import type { CommunicationDraft } from '@bisp/shared-types';

export interface WhatsAppSendResult {
  status: 'queued' | 'sent';
  provider: 'stub';
  messageId: string;
}

export class WhatsAppChannelAdapter {
  async sendOrQueue(draft: CommunicationDraft): Promise<WhatsAppSendResult> {
    return {
      status: draft.needsApproval ? 'queued' : 'sent',
      provider: 'stub',
      messageId: `wa_${draft.id}`,
    };
  }
}
