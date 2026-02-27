import type { CommunicationDraft, TaskItem } from '@bisp/shared-types';

export interface CampaignPlan {
  id: string;
  name: string;
  cluster: string;
  drafts: CommunicationDraft[];
  tasks: TaskItem[];
}
