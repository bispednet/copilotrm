import type { ActionCandidate, OrchestratorContext, ScoreBreakdown } from '@bisp/shared-types';

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

export function scoreAction(ctx: OrchestratorContext, action: ActionCandidate): ScoreBreakdown {
  const customer = ctx.customer;
  const offer = action.offerId ? ctx.activeOffers.find((o) => o.id === action.offerId) : undefined;
  const objectiveBoost = ctx.activeObjectives.some((o) => o.preferredOfferIds.includes(action.offerId ?? '')) ? 0.25 : 0;
  const stockBoost = offer?.stockQty ? clamp(Math.min(offer.stockQty / 20, 1)) : 0.2;
  const marginScore = offer?.marginPct ? clamp((offer.marginPct ?? 0) / 40) : 0.3;
  const consentScore = action.channel && customer ? Number(customer.consents[action.channel as 'whatsapp' | 'email' | 'telegram'] ?? false) : 0.4;
  const saturationPenalty = customer ? clamp(customer.commercialSaturationScore / 100) : 0.1;
  const contextFit = action.metadata.contextFit ? Number(action.metadata.contextFit) : 0.6;
  const profileFit = action.metadata.profileFit ? Number(action.metadata.profileFit) : 0.5;
  const confidenceScore = clamp(action.confidence);

  const total =
    contextFit * 0.2 +
    profileFit * 0.2 +
    objectiveBoost * 0.15 +
    marginScore * 0.1 +
    stockBoost * 0.1 +
    consentScore * 0.1 +
    (1 - saturationPenalty) * 0.05 +
    confidenceScore * 0.1;

  return {
    contextFit,
    profileFit,
    objectiveBoost,
    marginScore,
    stockScore: stockBoost,
    channelConsentScore: consentScore,
    saturationPenalty,
    confidenceScore,
    total: Number(total.toFixed(4)),
  };
}

export function rankActions(ctx: OrchestratorContext, actions: ActionCandidate[]): ActionCandidate[] {
  return actions
    .map((action) => ({ ...action, scoreBreakdown: scoreAction(ctx, action) }))
    .sort((a, b) => (b.scoreBreakdown?.total ?? 0) - (a.scoreBreakdown?.total ?? 0));
}
