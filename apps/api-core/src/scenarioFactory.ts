import type { DomainEvent } from '@bisp/shared-types';

function base(type: DomainEvent['type'], payload: Record<string, unknown>, customerId?: string): DomainEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    type,
    occurredAt: new Date().toISOString(),
    customerId,
    payload,
  };
}

export const scenarioFactory = {
  repairNotWorth: (): DomainEvent => base('assistance.ticket.outcome', {
    ticketId: 't_001',
    outcome: 'not-worth-repairing',
    deviceType: 'notebook',
    inferredSignals: ['office'],
  }, 'cust_lucia'),

  gamerLag: (): DomainEvent => base('assistance.ticket.outcome', {
    ticketId: 't_002',
    outcome: 'pending',
    deviceType: 'gaming-pc',
    inferredSignals: ['gamer', 'lag', 'network-issue'],
  }, 'cust_mario'),

  hardwareInvoice: (): DomainEvent => base('danea.invoice.ingested', {
    invoiceId: 'inv_demo_1',
    lines: [{ description: 'RTX 3090 1500€', qty: 1, unitCost: 1500 }],
  }),

  smartphonePromo: (): DomainEvent => base('offer.promo.ingested', {
    offerId: 'offer_oppo_bundle',
    title: 'Oppo 13 Max + smartwatch omaggio',
    conditions: 'promo fino a fine mese'
  }),

  complaintEmail: (): DomainEvent => base('inbound.email.received', {
    from: 'cliente@example.com',
    subject: 'Contratto 4 giorni fa, non ho ricevuto niente',
    body: 'Ho fatto un contratto 4 giorni fa ma non ho ricevuto niente, potete verificare?'
  }, 'cust_lucia'),
};
