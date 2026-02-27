import type { ActionCandidate } from '@bisp/shared-types';

export interface HandoffEdge {
  fromAgent: string;
  toAgent: string;
  reason: string;
}

export function deriveHandoffs(actions: ActionCandidate[]): HandoffEdge[] {
  const edges: HandoffEdge[] = [];

  for (const action of actions) {
    if (action.agent === 'preventivi' && String(action.metadata.trigger) === 'not-worth-repairing') {
      edges.push({ fromAgent: 'assistance', toAgent: 'preventivi', reason: 'repair-not-worth -> replacement quote' });
    }
    if (action.agent === 'telephony' && String(action.metadata.trigger) === 'gamer-lag') {
      edges.push({ fromAgent: 'assistance', toAgent: 'telephony', reason: 'gamer profile + network issue' });
    }
    if (action.agent === 'content' && String(action.metadata.trigger) === 'invoice-hardware') {
      edges.push({ fromAgent: 'ingest', toAgent: 'content', reason: 'hardware stock arrived' });
    }
  }

  return edges;
}
