import type {
  AssistanceTicket,
  Channel,
  CustomerProfile,
  ManagerObjective,
  ProductOffer,
  Segment,
} from '@bisp/shared-types';

// ─── Tipi locali (evitano import cross-package che violano rootDir) ──────────

/** Subset strutturale compatibile con CopilotRMPersona di @bisp/integrations-eliza */
export interface PersonaConfig {
  name: string;
  role: string;
  tone: string[];
  goals: string[];
  limits: string[];
  channels: string[];
  style: string[];
}

/** Compatibile con LLMMessage di @bisp/integrations-llm */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Utilità ────────────────────────────────────────────────────────────────

function personaSystemPrompt(persona: PersonaConfig): string {
  return [
    `Sei un agente CRM specializzato: ${persona.role}.`,
    `Tono: ${persona.tone.join(', ')}.`,
    persona.goals.length ? `Obiettivi: ${persona.goals.join('; ')}.` : '',
    persona.limits.length ? `Limiti: ${persona.limits.join('; ')}.` : '',
    `Stile: ${persona.style.join(', ')}.`,
    'Rispondi SOLO in italiano. Sii conciso e diretto.',
  ]
    .filter(Boolean)
    .join(' ');
}

function offerSummary(o: ProductOffer): string {
  return `"${o.title}" (${o.category}, target: ${o.targetSegments.join('/')}, prezzo: ${o.suggestedPrice ?? o.cost}€, margine: ${o.marginPct}%, stock: ${o.stockQty ?? '?'})`;
}

function customerSummary(c: CustomerProfile): string {
  return [
    `Cliente: ${c.fullName}`,
    `Segmenti: ${c.segments.join(', ')}`,
    `Interessi: ${c.interests.join(', ')}`,
    `Fascia spesa: ${c.spendBand}`,
    c.conversationNotes.length ? `Note: ${c.conversationNotes.slice(0, 3).join('. ')}` : '',
    `Saturazione commerciale: ${c.commercialSaturationScore}/100`,
  ]
    .filter(Boolean)
    .join(' | ');
}

/**
 * Estrae un blocco JSON dalla risposta LLM (che può contenere markdown code fences).
 * Restituisce null se non trova JSON valido.
 */
export function extractJSON<T>(text: string): T | null {
  // Prova raw parse
  try {
    return JSON.parse(text) as T;
  } catch {
    // Cerca il primo blocco ```json ... ``` o ``` ... ```
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as T;
      } catch {
        // continua
      }
    }
    // Cerca il primo { ... } o [ ... ] nel testo
    const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[1]) as T;
      } catch {
        // nulla
      }
    }
    return null;
  }
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * Prompt per generare le 3 varianti di proposta (economica/bilanciata/top)
 * e gli script WhatsApp/call per il consult agent.
 */
export function buildConsultProposalPrompt(params: {
  customer: CustomerProfile;
  topOffer: ProductOffer;
  allOffers: ProductOffer[];
  objectives: ManagerObjective[];
  ragHints: Array<{ text: string; score: number }>;
  persona: PersonaConfig;
  extraPrompt?: string;
}): PromptMessage[] {
  const { customer, topOffer, allOffers, objectives, ragHints, persona, extraPrompt } = params;

  const objectiveSummary = objectives
    .map((o) => `"${o.name}" (preferisce: ${o.preferredOfferIds.join(', ')}, margine min: ${o.minMarginPct}%)`)
    .join('; ');

  const ragContext = ragHints.length
    ? ragHints
        .slice(0, 3)
        .map((h) => h.text)
        .join(' | ')
    : 'nessun contesto RAG';

  const altOffers = allOffers
    .filter((o) => o.id !== topOffer.id)
    .slice(0, 3)
    .map(offerSummary)
    .join(', ');

  const userContent = [
    `## Richiesta proposta consulenza`,
    ``,
    `### Cliente`,
    customerSummary(customer),
    ``,
    `### Offerta principale`,
    offerSummary(topOffer),
    altOffers ? `### Offerte alternative disponibili\n${altOffers}` : '',
    objectiveSummary ? `### Obiettivi manager\n${objectiveSummary}` : '',
    ragContext !== 'nessun contesto RAG' ? `### Contesto RAG\n${ragContext}` : '',
    extraPrompt ? `### Richiesta aggiuntiva operatore\n${extraPrompt}` : '',
    ``,
    `Genera ESATTAMENTE questo JSON (nessun testo fuori dal JSON):`,
    `{`,
    `  "variants": [`,
    `    {"tier": "economica", "text": "...proposta economica 1-2 frasi..."},`,
    `    {"tier": "bilanciata", "text": "...proposta bilanciata 1-2 frasi..."},`,
    `    {"tier": "top", "text": "...proposta top 1-2 frasi..."}`,
    `  ],`,
    `  "scripts": {`,
    `    "whatsapp": {`,
    `      "short": "...WhatsApp breve max 50 parole...",`,
    `      "medium": "...WhatsApp medio max 100 parole...",`,
    `      "long": "...WhatsApp lungo max 150 parole..."`,
    `    },`,
    `    "call": {`,
    `      "s30": "...script telefonico 30 secondi, bullet points...",`,
    `      "s90": "...script telefonico 90 secondi, strutturato..."`,
    `    }`,
    `  }`,
    `}`,
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  return [
    { role: 'system', content: personaSystemPrompt(persona) },
    { role: 'user', content: userContent },
  ];
}

/**
 * Prompt per generare il body di un messaggio one-to-one personalizzato.
 * Restituisce testo plain (il body del draft).
 */
export function buildOneToOneMessagePrompt(params: {
  customer: CustomerProfile;
  offer: ProductOffer;
  channel: Channel;
  reason: string;
  persona: PersonaConfig;
}): PromptMessage[] {
  const { customer, offer, channel, reason, persona } = params;

  const channelInstructions: Record<string, string> = {
    whatsapp: 'Messaggio WhatsApp: massimo 120 parole, tono diretto e personale, usa il nome di battesimo.',
    email: 'Email commerciale: oggetto implicito nel testo, max 150 parole, professionale ma caloroso.',
    telegram: 'Messaggio Telegram: conciso, max 80 parole, puoi usare emoji con moderazione.',
  };
  const channelHint = channelInstructions[channel] ?? 'Messaggio breve e chiaro, max 100 parole.';

  return [
    { role: 'system', content: personaSystemPrompt(persona) },
    {
      role: 'user',
      content: [
        `Scrivi un messaggio ${channel} personalizzato per questo cliente.`,
        ``,
        customerSummary(customer),
        `Offerta da proporre: ${offerSummary(offer)}`,
        `Motivo del contatto: ${reason}`,
        ``,
        channelHint,
        `Restituisci SOLO il testo del messaggio, senza prefissi o spiegazioni.`,
      ].join('\n'),
    },
  ];
}

/**
 * Prompt per generare il testo di un messaggio one-to-many (campagna) per un canale specifico.
 */
export function buildOneToManyMessagePrompt(params: {
  offer: ProductOffer;
  segment: Segment;
  channel: Channel;
  persona: PersonaConfig;
}): PromptMessage[] {
  const { offer, segment, channel, persona } = params;

  const channelInstructions: Record<string, string> = {
    telegram: 'Messaggio canale Telegram: max 200 caratteri, include CTA finale. No hashtag.',
    facebook: 'Post Facebook: max 150 parole, tono amichevole, termina con 1-2 hashtag rilevanti.',
    instagram: 'Caption Instagram: max 80 parole, coinvolgente, termina con 3-5 hashtag rilevanti e CTA in DM.',
    email: 'Subject line + body email newsletter: subject max 60 caratteri, body max 120 parole.',
    blog: 'Intro paragrafo blog: max 80 parole, SEO-friendly, tono informativo.',
    x: 'Tweet: max 280 caratteri, include 1-2 hashtag e CTA.',
  };
  const channelHint = channelInstructions[channel] ?? 'Testo promozionale breve e chiaro.';

  return [
    { role: 'system', content: personaSystemPrompt(persona) },
    {
      role: 'user',
      content: [
        `Crea il testo per una campagna ${channel} rivolta al segmento "${segment}".`,
        ``,
        `Offerta: ${offerSummary(offer)}`,
        ``,
        channelHint,
        `Restituisci SOLO il testo pronto per la pubblicazione, senza spiegazioni.`,
      ].join('\n'),
    },
  ];
}

/**
 * Prompt per generare una risposta customer care a un ticket.
 */
export function buildCustomerCareReplyPrompt(params: {
  ticket: AssistanceTicket;
  customer: CustomerProfile;
  offer?: ProductOffer;
  persona: PersonaConfig;
}): PromptMessage[] {
  const { ticket, customer, offer, persona } = params;

  return [
    { role: 'system', content: personaSystemPrompt(persona) },
    {
      role: 'user',
      content: [
        `Scrivi una risposta al cliente per questo ticket di assistenza.`,
        ``,
        customerSummary(customer),
        `Ticket: ${ticket.issue ?? 'non specificato'} | Dispositivo: ${ticket.deviceType ?? '?'} | Diagnosi: ${ticket.diagnosis ?? 'da definire'}`,
        ticket.outcome ? `Esito: ${ticket.outcome}` : '',
        offer ? `Offerta suggerita: ${offerSummary(offer)}` : '',
        ``,
        `Regole: max 120 parole, tono empatico, non promettere esiti non verificati, sii concreto sull'esito o sui prossimi passi.`,
        `Restituisci SOLO il testo della risposta, senza prefissi.`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

/**
 * Prompt per generare contenuti multicanale da una scheda offerta.
 * Restituisce JSON con testo per ogni canale richiesto.
 */
export function buildContentCardPrompt(params: {
  offer: ProductOffer;
  channels: Channel[];
  persona: PersonaConfig;
}): PromptMessage[] {
  const { offer, channels, persona } = params;

  const channelList = channels.map((ch) => `"${ch}"`).join(', ');

  return [
    { role: 'system', content: personaSystemPrompt(persona) },
    {
      role: 'user',
      content: [
        `Genera contenuti multicanale per questa offerta.`,
        ``,
        `Offerta: ${offerSummary(offer)}`,
        `Canali richiesti: ${channelList}`,
        ``,
        `Genera ESATTAMENTE questo JSON:`,
        `{`,
        ...channels.map((ch) => `  "${ch}": "...testo ottimizzato per ${ch}..."`),
        `}`,
        `Nessun testo fuori dal JSON.`,
      ].join('\n'),
    },
  ];
}

// ─── Legacy system prompts (retrocompatibilità) ──────────────────────────────
export const SYSTEM_PROMPTS = {
  consultProposal:
    'Genera proposte coerenti con profilo cliente, obiettivi manager, stock e policy. Fornisci versione economica/bilanciata/top.',
  customerCareReply: 'Prepara una risposta breve, chiara e tracciabile. Non promettere esiti non verificati.',
  contentOfferCard: 'Trasforma una scheda offerta in contenuti multicanale con CTA e limiti per canale.',
} as const;
