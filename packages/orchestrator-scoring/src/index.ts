import type { ActionCandidate, OrchestratorContext, ScoreBreakdown } from '@bisp/shared-types';

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

export function scoreAction(ctx: OrchestratorContext, action: ActionCandidate): ScoreBreakdown {
  const customer = ctx.customer;
  const offer = action.offerId ? ctx.activeOffers.find((o) => o.id === action.offerId) : undefined;
  const currentHour = new Date().getHours();

  // ── Base objective boost (preferred offer) ───────────────────────────────
  const basePrefBoost = ctx.activeObjectives.some((o) => o.preferredOfferIds.includes(action.offerId ?? '')) ? 0.25 : 0;

  // ── Category weight boost (extra for high-priority categories) ───────────
  const categoryWeightBoost = offer
    ? clamp(ctx.activeObjectives.reduce((acc, obj) => {
        const w = (obj.categoryWeights ?? {})[offer.category] ?? 1;
        return acc + (w - 1) * 0.06; // each unit above 1 = 6% boost, capped
      }, 0))
    : 0;

  // ── Stock clearance boost ─────────────────────────────────────────────────
  const stockClearanceBoost = ctx.activeObjectives.some(
    (o) => o.stockClearanceOfferIds.includes(action.offerId ?? '')
  ) ? 0.1 : 0;

  // ── Min margin penalty ────────────────────────────────────────────────────
  const minMarginPenalty = ctx.activeObjectives.some(
    (o) => o.minMarginPct != null && (offer?.marginPct ?? 0) < (o.minMarginPct ?? 0)
  ) ? 0.15 : 0;

  // ── Channel window penalty (current hour outside allowed send window) ─────
  const channelWindowPenalty = action.channel
    ? ctx.activeObjectives.some((o) => {
        const win = (o.channelWindows ?? []).find((w) => w.channel === action.channel);
        if (!win) return false;
        return currentHour < win.fromHour || currentHour >= win.toHour;
      }) ? 0.15 : 0
    : 0;

  // ── Folded objective boost ────────────────────────────────────────────────
  const objectiveBoost = clamp(basePrefBoost + categoryWeightBoost + stockClearanceBoost);

  // ── Other base scores ─────────────────────────────────────────────────────
  const stockBoost = offer?.stockQty ? clamp(Math.min(offer.stockQty / 20, 1)) : 0.2;
  const marginScore = clamp(Math.max(0, ((offer?.marginPct ?? 0) / 40) - minMarginPenalty));
  const consentScore = action.channel && customer ? Number(customer.consents[action.channel as 'whatsapp' | 'email' | 'telegram'] ?? false) : 0.4;
  const saturationPenalty = clamp((customer ? customer.commercialSaturationScore / 100 : 0.1) + channelWindowPenalty);
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
