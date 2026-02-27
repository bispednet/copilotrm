import { InMemoryRAGStore, toElizaLikeCharacter } from '@bisp/integrations-eliza';
import type { CopilotRMPersona } from '@bisp/integrations-eliza';
import { personas } from '@bisp/personas';
import type { CommunicationDraft, CustomerProfile, ManagerObjective, ProductOffer, Segment, TaskItem } from '@bisp/shared-types';

export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildRagStore(customers: CustomerProfile[], offers: ProductOffer[]): InMemoryRAGStore {
  const rag = new InMemoryRAGStore();
  offers.forEach((o) => {
    rag.add({ id: `offer:${o.id}`, text: `${o.title}. categoria ${o.category}. target ${o.targetSegments.join(', ')}. condizioni ${o.conditions ?? ''}` });
  });
  customers.forEach((c) => {
    rag.add({ id: `cust:${c.id}`, text: `${c.fullName}. segmenti ${c.segments.join(', ')}. interessi ${c.interests.join(', ')}. note ${c.conversationNotes.join(' ')}.` });
  });
  return rag;
}

export function targetCustomersForOffer(params: {
  customers: CustomerProfile[];
  offer: ProductOffer;
  objectives: ManagerObjective[];
  max?: number;
}): Array<{ customer: CustomerProfile; score: number; reasons: string[] }> {
  const { customers, offer, objectives, max = 25 } = params;
  const preferred = objectives.some((o) => o.preferredOfferIds.includes(offer.id));
  return customers
    .map((c) => {
      let score = 0;
      const reasons: string[] = [];
      const overlap = c.segments.filter((s) => offer.targetSegments.includes(s));
      if (overlap.length) {
        score += overlap.length * 2;
        reasons.push(`segmenti compatibili: ${overlap.join(', ')}`);
      }
      if (offer.category === 'connectivity' && c.interests.some((x) => /fibra|rete|gaming/.test(x))) {
        score += 2;
        reasons.push('interessi rete/gaming');
      }
      if (offer.category === 'smartphone' && c.interests.some((x) => /smartphone|bundle/.test(x))) {
        score += 2;
        reasons.push('interesse smartphone/bundle');
      }
      if (preferred) {
        score += 1.5;
        reasons.push('offerta in obiettivo manager attivo');
      }
      score += (100 - c.commercialSaturationScore) / 100;
      if (c.commercialSaturationScore > 80) reasons.push('saturazione alta (rallentare invii)');
      return { customer: c, score: Number(score.toFixed(2)), reasons };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

export function buildOneToOneDraftsForOffer(params: {
  targets: Array<{ customer: CustomerProfile; score: number; reasons: string[] }>;
  offer: ProductOffer;
}): CommunicationDraft[] {
  return params.targets
    .filter((t) => t.customer.consents.whatsapp || t.customer.consents.email)
    .map((t) => ({
      id: makeId('draft'),
      customerId: t.customer.id,
      channel: t.customer.consents.whatsapp ? 'whatsapp' : 'email',
      audience: 'one-to-one',
      body: `Ciao ${t.customer.fullName.split(' ')[0]}, proposta per te: ${params.offer.title}. Motivo: ${t.reasons[0] ?? 'profilo compatibile'}. Vuoi dettagli e alternative?`,
      relatedOfferId: params.offer.id,
      needsApproval: true,
      reason: 'targeting profilato one-to-one',
    }));
}

export function buildOneToManyDraftsForOffer(params: { offer: ProductOffer; segment: Segment }): CommunicationDraft[] {
  const base = `Nuova offerta ${params.offer.title} per target ${params.segment}. Scrivici per condizioni e disponibilità.`;
  return [
    { id: makeId('draft'), channel: 'telegram', audience: 'one-to-many', body: base, relatedOfferId: params.offer.id, needsApproval: true, reason: 'campagna cluster telegram' },
    { id: makeId('draft'), channel: 'facebook', audience: 'one-to-many', body: `${base} #promo`, relatedOfferId: params.offer.id, needsApproval: true, reason: 'campagna cluster facebook' },
    { id: makeId('draft'), channel: 'instagram', audience: 'one-to-many', body: `${params.offer.title} | ${params.segment} | CTA in DM`, relatedOfferId: params.offer.id, needsApproval: true, reason: 'campagna cluster instagram' },
  ];
}

export function buildCampaignTasks(offer: ProductOffer, segment: Segment): TaskItem[] {
  return [
    { id: makeId('task'), kind: 'campaign', title: `Approva campagna ${offer.title} (${segment})`, assigneeRole: 'manager', priority: 8, offerId: offer.id, status: 'open', createdAt: new Date().toISOString() },
    { id: makeId('task'), kind: 'content', title: `Adatta contenuti multicanale per ${offer.title}`, assigneeRole: 'content', priority: 6, offerId: offer.id, status: 'open', createdAt: new Date().toISOString() },
  ];
}

export function consultProposal(params: {
  customer: CustomerProfile;
  objectives: ManagerObjective[];
  offers: ProductOffer[];
  prompt?: string;
  offerId?: string;
  rag: InMemoryRAGStore;
  personaHintsOverride?: Record<string, unknown>;
}) {
  const { customer, objectives, offers, prompt, offerId, rag, personaHintsOverride } = params;
  const candidateOffers = offerId ? offers.filter((o) => o.id === offerId) : offers.filter((o) => o.targetSegments.some((s) => customer.segments.includes(s)));
  const ranked = candidateOffers
    .map((o) => ({
      offer: o,
      score: (o.targetSegments.filter((s) => customer.segments.includes(s)).length * 2) + (objectives.some((ob) => ob.preferredOfferIds.includes(o.id)) ? 1.5 : 0) + ((100 - customer.commercialSaturationScore) / 100),
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0]?.offer;
  const variants = top
    ? [
        { tier: 'economica', text: `${top.title} base con focus prezzo e funzionalità essenziali.` },
        { tier: 'bilanciata', text: `${top.title} + bundle accessori/servizio per miglior valore complessivo.` },
        { tier: 'top', text: `${top.title} configurazione completa con installazione/configurazione e supporto.` },
      ]
    : [];

  const ragHits = rag.search(`${prompt ?? ''} ${customer.interests.join(' ')} ${customer.segments.join(' ')}`, 5);
  const personaHints = personaHintsOverride ?? {
    preventivi: toElizaLikeCharacter(personas.preventivi as CopilotRMPersona),
    telephony: toElizaLikeCharacter(personas.telephony as CopilotRMPersona),
  };

  return {
    customer: { id: customer.id, fullName: customer.fullName, segments: customer.segments, interests: customer.interests },
    topOffer: top ?? null,
    variants,
    scripts: {
      whatsapp: {
        short: top ? `Ciao ${customer.fullName.split(' ')[0]}, ti propongo ${top.title}. Vuoi 3 opzioni rapide?` : 'Posso prepararti una proposta su misura?',
        medium: top ? `Ciao ${customer.fullName.split(' ')[0]}, in base al tuo profilo (${customer.segments.join(', ')}) ti propongo ${top.title}. Posso inviarti opzioni economica/bilanciata/top.` : 'Posso preparare una proposta coerente con il tuo profilo e obiettivi attivi.',
        long: top ? `Ciao ${customer.fullName.split(' ')[0]}, ho visto che il tuo profilo è coerente con ${top.title}. Posso preparare tre varianti (economica, bilanciata, top) e includere eventuali bundle/accessori utili.` : 'Fammi sapere il tuo budget e uso, preparo 3 varianti.',
      },
      call: {
        s30: top ? `Ti chiamo per una proposta rapida su ${top.title}, in linea col tuo profilo. Ti dico 2 opzioni e fissiamo il passaggio.` : 'Ti propongo una soluzione rapida in due opzioni.',
        s90: top ? `Obiettivo: capire budget, urgenza e uso. Proposta principale ${top.title}, alternativa bilanciata e top, con eventuale bundle. Chiusura: appuntamento o invio preventivo.` : 'Script consultivo standard con raccolta bisogni e proposta in 3 fasce.',
      },
    },
    objectiveAlignment: objectives.map((o) => ({ id: o.id, name: o.name, boostsTopOffer: top ? o.preferredOfferIds.includes(top.id) : false })),
    ragHints: ragHits,
    personaHints,
  };
}
