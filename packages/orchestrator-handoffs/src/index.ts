import type { ActionCandidate } from '@bisp/shared-types';

export interface HandoffEdge {
  fromAgent: string;
  toAgent: string;
  reason: string;
  sourceActionId?: string;
  /** Se true, l'agente target va eseguito in-chain prima di restituire il risultato */
  blocking: boolean;
  /** Se true, non eseguire automaticamente — crea un task di approvazione manuale */
  requiresApproval: boolean;
}

export function deriveHandoffs(actions: ActionCandidate[]): HandoffEdge[] {
  const edges: HandoffEdge[] = [];

  for (const action of actions) {
    if (action.agent === 'preventivi' && String(action.metadata.trigger) === 'not-worth-repairing') {
      edges.push({
        fromAgent: 'assistance', toAgent: 'preventivi',
        reason: 'repair-not-worth -> replacement quote',
        sourceActionId: action.id, blocking: false, requiresApproval: false,
      });
    }
    if (action.agent === 'telephony' && String(action.metadata.trigger) === 'gamer-lag') {
      edges.push({
        fromAgent: 'assistance', toAgent: 'telephony',
        reason: 'gamer profile + network issue',
        sourceActionId: action.id, blocking: false, requiresApproval: false,
      });
    }
    if (action.agent === 'content' && String(action.metadata.trigger) === 'invoice-hardware') {
      edges.push({
        fromAgent: 'ingest', toAgent: 'content',
        reason: 'hardware stock arrived',
        sourceActionId: action.id, blocking: false, requiresApproval: false,
      });
    }
    if (action.agent === 'energy' && String(action.metadata.trigger) === 'energy-signal') {
      edges.push({
        fromAgent: 'assistance', toAgent: 'energy',
        reason: 'energy saving interest detected',
        sourceActionId: action.id, blocking: false, requiresApproval: false,
      });
    }
  }

  return edges;
}
