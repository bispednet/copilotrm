import type { CommunicationDraft } from '@bisp/shared-types';

export class SocialChannelAdapter {
  async publish(draft: CommunicationDraft): Promise<{ platform: string; queued: boolean }> {
    return { platform: draft.channel, queued: true };
  }
}
