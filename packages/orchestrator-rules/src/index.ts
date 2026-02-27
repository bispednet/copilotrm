import type { ActionCandidate, DomainEvent, ProductOffer } from '@bisp/shared-types';

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveRuleCandidates(event: DomainEvent, offers: ProductOffer[]): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];

  if (event.type === 'assistance.ticket.outcome') {
    const payload = event.payload as Record<string, unknown>;
    const outcome = payload.outcome as string | undefined;
    const signals = (payload.inferredSignals as string[] | undefined) ?? [];

    if (outcome === 'not-worth-repairing') {
      const notebookOffer = offers.find((o) => o.category === 'hardware' && /notebook|pc/i.test(o.title));
      candidates.push({
        id: id('act'),
        agent: 'preventivi',
        actionType: 'quote',
        title: 'Genera preventivo sostituzione in 3 fasce',
        channel: 'whatsapp',
        offerId: notebookOffer?.id,
        customerId: event.customerId,
        confidence: 0.82,
        needsApproval: true,
        metadata: { trigger: 'not-worth-repairing', contextFit: 0.95, profileFit: signals.includes('gamer') ? 0.7 : 0.6 },
      });
    }

    if (signals.includes('gamer')) {
      const connectivityOffer = offers.find((o) => o.category === 'connectivity');
      candidates.push({
        id: id('act'),
        agent: 'telephony',
        actionType: 'cross-sell',
        title: 'Proposta connectivity gaming (fibra/router/mesh)',
        channel: 'whatsapp',
        offerId: connectivityOffer?.id,
        customerId: event.customerId,
        confidence: 0.86,
        needsApproval: true,
        metadata: { trigger: 'gamer-lag', contextFit: 0.98, profileFit: 0.92 },
      });
    }

    if (signals.includes('energia')) {
      const energyOffer = offers.find((o) => o.category === 'energy' || /energia|luce|gas/i.test(o.title));
      candidates.push({
        id: id('act'),
        agent: 'energy',
        actionType: 'cross-sell',
        title: 'Proposta risparmio energia coerente con profilo',
        channel: 'whatsapp',
        offerId: energyOffer?.id,
        customerId: event.customerId,
        confidence: 0.74,
        needsApproval: true,
        metadata: { trigger: 'energy-signal', contextFit: 0.82, profileFit: 0.72 },
      });
    }
  }

  if (event.type === 'danea.invoice.ingested') {
    const payload = event.payload as Record<string, unknown>;
    const lines = (payload.lines as Array<{ description: string }>) ?? [];
    const hasHardware = lines.some((l) => /rtx|gpu|notebook|pc|ssd|monitor/i.test(l.description));
    if (hasHardware) {
      const hardwareOffer = offers.find((o) => o.category === 'hardware');
      candidates.push({
        id: id('act'),
        agent: 'content',
        actionType: 'content',
        title: 'Crea task content factory per nuovo stock hardware',
        channel: 'telegram',
        offerId: hardwareOffer?.id,
        customerId: event.customerId,
        confidence: 0.9,
        needsApproval: true,
        metadata: { trigger: 'invoice-hardware', contextFit: 0.9, profileFit: 0.5 },
      });
      candidates.push({
        id: id('act'),
        agent: 'hardware',
        actionType: 'followup',
        title: 'Prepara scheda commerciale hardware per banco e one-to-one',
        channel: 'whatsapp',
        offerId: hardwareOffer?.id,
        customerId: event.customerId,
        confidence: 0.81,
        needsApproval: true,
        metadata: { trigger: 'invoice-hardware-playbook', contextFit: 0.88, profileFit: 0.52 },
      });
    }
  }

  if (event.type === 'offer.promo.ingested') {
    const payload = event.payload as Record<string, unknown>;
    const title = String(payload.title ?? '');
    if (/oppo|samsung|iphone|smartphone/i.test(title)) {
      const promoOffer = offers.find((o) => o.category === 'smartphone');
      candidates.push({
        id: id('act'),
        agent: 'telephony',
        actionType: 'campaign',
        title: 'Lancia campagna promo smartphone bundle',
        channel: 'telegram',
        offerId: promoOffer?.id,
        customerId: event.customerId,
        confidence: 0.88,
        needsApproval: true,
        metadata: { trigger: 'promo-smartphone', contextFit: 0.93, profileFit: 0.75 },
      });
    }
  }

  if (event.type === 'inbound.email.received') {
    const payload = event.payload as Record<string, unknown>;
    const body = `${payload.subject ?? ''} ${payload.body ?? ''}`.toLowerCase();
    if (/(contratto|contratto).*(giorni|4 giorni)|non ho ricevuto|ritardo/.test(body)) {
      candidates.push({
        id: id('act'),
        agent: 'customer-care',
        actionType: 'customer-care',
        title: 'Apri task customer care urgente con risposta suggerita',
        channel: 'email',
        customerId: event.customerId,
        confidence: 0.91,
        needsApproval: false,
        metadata: { trigger: 'post-sale-complaint', contextFit: 0.97, profileFit: 0.6 },
      });
    }
  }

  return candidates;
}
