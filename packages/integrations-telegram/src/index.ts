import type { CommunicationDraft } from '@bisp/shared-types';

export class TelegramChannelAdapter {
  async queueOfferMessage(draft: CommunicationDraft): Promise<{ queued: boolean; channel: string }> {
    return { queued: true, channel: 'telegram' };
  }
}
