import type { CustomerProfile, ManagerObjective, ProductOffer } from '@bisp/shared-types';

export const demoCustomers: CustomerProfile[] = [
  {
    id: 'cust_mario',
    fullName: 'Mario Rossi',
    phone: '3331112222',
    email: 'mario@example.com',
    ageHint: 31,
    segments: ['gamer'],
    interests: ['gaming', 'pc', 'fibra'],
    spendBand: 'high',
    purchaseHistory: ['Gaming PC 2023', 'Monitor 27"'],
    assistanceHistory: ['PC lag rete'],
    conversationNotes: ['lamenta ping alto la sera'],
    interactions: [],
    consents: { whatsapp: true, email: true, telegram: false, updatedAt: new Date().toISOString() },
    commercialSaturationScore: 35,
  },
  {
    id: 'cust_lucia',
    fullName: 'Lucia Bianchi',
    phone: '3339990000',
    email: 'lucia@example.com',
    segments: ['famiglia', 'smartphone-upgrade'],
    interests: ['smartphone', 'bundle'],
    purchaseHistory: ['Smartphone fascia media 2022'],
    assistanceHistory: [],
    conversationNotes: ['ha chiesto promo con omaggio'],
    interactions: [],
    consents: { whatsapp: true, email: true, telegram: true, updatedAt: new Date().toISOString() },
    commercialSaturationScore: 20,
  },
];

export const demoOffers: ProductOffer[] = [
  { id: 'offer_notebook_x', sourceType: 'promo', category: 'hardware', title: 'Notebook Gamma X', suggestedPrice: 899, marginPct: 22, stockQty: 8, targetSegments: ['business', 'famiglia'], active: true },
  { id: 'offer_gaming_pc', sourceType: 'manual', category: 'hardware', title: 'PC Gaming RTX Ready', suggestedPrice: 1499, marginPct: 18, stockQty: 3, targetSegments: ['gamer'], active: true },
  { id: 'offer_fibra_gaming', sourceType: 'promo', category: 'connectivity', title: 'Fibra Gaming + Router QoS', suggestedPrice: 34, marginPct: 28, stockQty: 50, targetSegments: ['gamer', 'fibra'], active: true },
  { id: 'offer_oppo_bundle', sourceType: 'promo', category: 'smartphone', title: 'Oppo 13 Max + smartwatch omaggio', suggestedPrice: 699, marginPct: 16, stockQty: 20, targetSegments: ['smartphone-upgrade', 'famiglia'], active: true },
  { id: 'offer_rtx_3090', sourceType: 'invoice', category: 'hardware', title: 'RTX 3090', cost: 1500, suggestedPrice: 1799, marginPct: 14, stockQty: 2, targetSegments: ['gamer'], active: true },
];

export const demoObjectives: ManagerObjective[] = [
  {
    id: 'obj_feb_gaming',
    name: 'Spingere fibra gaming + notebook gamma X',
    periodStart: '2026-02-01T00:00:00.000Z',
    periodEnd: '2026-03-15T23:59:59.000Z',
    categoryWeights: { connectivity: 1.3, hardware: 1.1 },
    preferredOfferIds: ['offer_fibra_gaming', 'offer_notebook_x'],
    stockClearanceOfferIds: ['offer_rtx_3090'],
    minMarginPct: 10,
    channelWindows: [{ channel: 'whatsapp', fromHour: 10, toHour: 18 }, { channel: 'telegram', fromHour: 11, toHour: 20 }],
    dailyContactCapacity: 30,
    active: true,
  },
];
