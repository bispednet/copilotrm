export type UUID = string;

export type Channel = 'whatsapp' | 'email' | 'telegram' | 'facebook' | 'instagram' | 'x' | 'blog';
export type Segment = 'gamer' | 'business' | 'famiglia' | 'risparmio' | 'smartphone-upgrade' | 'fibra' | 'energia';
export type EventType =
  | 'assistance.ticket.created'
  | 'assistance.ticket.closed'
  | 'assistance.ticket.outcome'
  | 'inbound.email.received'
  | 'inbound.whatsapp.received'
  | 'danea.invoice.ingested'
  | 'offer.promo.ingested'
  | 'manager.objective.updated';

export interface AuditRecord {
  id: UUID;
  timestamp: string;
  actor: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface ConsentState {
  whatsapp: boolean;
  email: boolean;
  telegram: boolean;
  updatedAt: string;
}

export interface CustomerProfile {
  id: UUID;
  fullName: string;
  phone?: string;
  email?: string;
  ageHint?: number;
  segments: Segment[];
  interests: string[];
  spendBand?: 'low' | 'mid' | 'high';
  purchaseHistory: string[];
  assistanceHistory: string[];
  conversationNotes: string[];
  consents: ConsentState;
  commercialSaturationScore: number;
}

export interface AssistanceTicket {
  id: UUID;
  customerId?: UUID;
  provisionalCustomer: boolean;
  phoneLookup: string;
  deviceType: string;
  issue: string;
  diagnosis?: string;
  outcome?: 'repair' | 'not-worth-repairing' | 'pending';
  inferredSignals: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductOffer {
  id: UUID;
  sourceType: 'invoice' | 'promo' | 'manual';
  category: 'hardware' | 'smartphone' | 'connectivity' | 'energy' | 'service' | 'accessory';
  title: string;
  conditions?: string;
  cost?: number;
  suggestedPrice?: number;
  marginPct?: number;
  stockQty?: number;
  expiresAt?: string;
  targetSegments: Segment[];
  active: boolean;
}

export interface ManagerObjective {
  id: UUID;
  name: string;
  periodStart: string;
  periodEnd: string;
  categoryWeights: Partial<Record<ProductOffer['category'], number>>;
  preferredOfferIds: UUID[];
  stockClearanceOfferIds: UUID[];
  minMarginPct?: number;
  channelWindows?: Array<{ channel: Channel; fromHour: number; toHour: number }>;
  dailyContactCapacity?: number;
  active: boolean;
}

export interface CommunicationDraft {
  id: UUID;
  customerId?: UUID;
  channel: Channel;
  audience: 'one-to-one' | 'one-to-many';
  subject?: string;
  body: string;
  relatedOfferId?: UUID;
  needsApproval: boolean;
  reason: string;
}

export interface TaskItem {
  id: UUID;
  kind: 'assist' | 'followup' | 'campaign' | 'customer-care' | 'approval' | 'content';
  title: string;
  assigneeRole: string;
  priority: number;
  customerId?: UUID;
  ticketId?: UUID;
  offerId?: UUID;
  status: 'open' | 'done';
  createdAt: string;
}

export interface InboundEmailEvent {
  subject: string;
  body: string;
  from: string;
  customerId?: UUID;
}

export interface DaneaInvoiceLine {
  description: string;
  qty: number;
  unitCost: number;
  tags?: string[];
}

export interface DomainEvent<T = Record<string, unknown>> {
  id: UUID;
  type: EventType;
  occurredAt: string;
  customerId?: UUID;
  payload: T;
}

export interface ActionCandidate {
  id: UUID;
  agent: string;
  actionType: 'quote' | 'cross-sell' | 'customer-care' | 'campaign' | 'content' | 'followup';
  title: string;
  channel?: Channel;
  offerId?: UUID;
  customerId?: UUID;
  scoreBreakdown?: ScoreBreakdown;
  confidence: number;
  needsApproval: boolean;
  metadata: Record<string, unknown>;
}

export interface ScoreBreakdown {
  contextFit: number;
  profileFit: number;
  objectiveBoost: number;
  marginScore: number;
  stockScore: number;
  channelConsentScore: number;
  saturationPenalty: number;
  confidenceScore: number;
  total: number;
}

export interface OrchestratorContext {
  event: DomainEvent;
  customer?: CustomerProfile;
  activeObjectives: ManagerObjective[];
  activeOffers: ProductOffer[];
  now: string;
}

export interface OrchestratorOutput {
  rankedActions: ActionCandidate[];
  tasks: TaskItem[];
  drafts: CommunicationDraft[];
  auditRecords: AuditRecord[];
}

export interface AgentExecutionResult {
  agent: string;
  actions: ActionCandidate[];
  tasks: TaskItem[];
  drafts: CommunicationDraft[];
  notes: string[];
}

export interface BusinessAgent {
  name: string;
  supports(eventType: EventType): boolean;
  execute(ctx: OrchestratorContext): AgentExecutionResult;
}
